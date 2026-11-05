import fs from 'node:fs';
import path from 'node:path';
import { hashFile } from './canon.js';
import { isFrozenPath, readLock, isSpecFrozen, frozenFiles } from './lock.js';
import { runContracts } from './contracts.js';
import { buildReceipt, writeReceipt } from './receipts.js';

// Normalize a path to forward slashes.
function toRel(p) {
  return p.split(path.sep).join('/');
}

// Resolve a tool call's target path to a project-relative path (forward slashes).
// Absolute paths are used as-is; relative paths are joined to cwd. A path
// outside the project root keeps its leading "../" so it cannot match a frozen
// entry (which is always inside the root).
function resolveProjectRelative(cwd, p) {
  if (typeof p !== 'string') return null;
  const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
  return toRel(path.relative(cwd, abs));
}

// Count [x] task-done marks (case-insensitive) in a string (Req 4.1, 4.2).
export function countTaskMarks(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const matches = text.match(/\[x\]/gi);
  return matches ? matches.length : 0;
}

// Detect whether a tool call on tasks.md is marking a task done (Req 4.1, 4.2).
// - str_replace: more [x] in newStr than oldStr.
// - fs_write: more [x] in the new text than the file currently on disk.
export function detectTaskDone(cwd, toolName, toolInput) {
  const p = toolInput && toolInput.path;
  if (typeof p !== 'string') return false;
  const rel = resolveProjectRelative(cwd, p);
  if (!rel) return false;
  // Only an edit to .kiro/specs/<spec>/tasks.md can mark a task done.
  if (!/^\.kiro\/specs\/([^/]+)\/tasks\.md$/.test(rel)) return false;
  if (toolName === 'str_replace') {
    return countTaskMarks(toolInput.newStr) > countTaskMarks(toolInput.oldStr);
  }
  if (toolName === 'fs_write') {
    const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
    let disk = '';
    try {
      disk = fs.readFileSync(abs, 'utf8');
    } catch {
      disk = ''; // file does not exist yet -> 0 marks on disk
    }
    return countTaskMarks(toolInput.text) > countTaskMarks(disk);
  }
  return false;
}

// PreToolUse: block edits to frozen files (Req 3) and gate marking a task done
// on the frozen contracts passing (Req 4).
//
// Returns { exitCode, stdout, stderr }. Exit 2 blocks the tool call and shows
// stderr to the agent; exit 0 allows it silently.
export function handlePreToolUse(payload) {
  const cwd = payload.cwd;
  const toolName = payload.tool_name;
  const toolInput = payload.tool_input || {};
  const p = toolInput.path;

  // Only the write tools carry a file path to protect.
  if (!cwd || typeof p !== 'string' || (toolName !== 'fs_write' && toolName !== 'str_replace')) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const rel = resolveProjectRelative(cwd, p);

  // Req 3.2: nothing under .necro/ is editable.
  if (rel === '.necro' || rel.startsWith('.necro/')) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: 'Cannot edit files under .necro/. These are managed by necro.',
    };
  }

  // Req 3.1: frozen files cannot be edited.
  if (isFrozenPath(cwd, rel)) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Cannot edit frozen file ${rel}. Fix the code, not the contract.`,
    };
  }

  // Req 4: if this edit marks a task done, gate it on the frozen contracts.
  if (detectTaskDone(cwd, toolName, toolInput)) {
    return runGate(cwd, rel);
  }

  // Req 3.4: not a frozen file, not under .necro/, not marking a task done.
  return { exitCode: 0, stdout: '', stderr: '' };
}

// Derive the spec name from a project-relative tasks.md path.
function specFromTasksPath(rel) {
  const m = rel.match(/^\.kiro\/specs\/([^/]+)\/tasks\.md$/);
  return m ? m[1] : null;
}

// Gate: run the spec's frozen contracts; block unless they all pass. On
// success, write a receipt and allow the edit (Req 4.3-4.6).
function runGate(cwd, rel) {
  const spec = specFromTasksPath(rel);
  if (!spec) return { exitCode: 0, stdout: '', stderr: '' };

  // Req 4.3: the spec must be frozen first.
  if (!isSpecFrozen(cwd, spec)) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Spec '${spec}' is not frozen. Run 'necro freeze <spec>' first.`,
    };
  }

  const lock = readLock(cwd);
  // Req 4.4: run the frozen contracts with node --test.
  const results = runContracts(cwd, spec, lock);

  // Req 4.5: any failing contract blocks the edit, listing each by name.
  const failing = results.filter((r) => r.result === 'fail').map((r) => r.name);
  if (failing.length > 0) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Contracts failed: ${failing.sort().join(', ')}.`,
    };
  }

  // Req 4.6: all pass -> write a receipt and allow the edit.
  const receipt = buildReceipt(cwd, spec, lock, results);
  writeReceipt(cwd, spec, receipt);
  return { exitCode: 0, stdout: '', stderr: '' };
}

// PostToolUse: after execute_bash, restore any frozen file whose SHA-256 changed
// back from its content-addressed copy in .necro/frozen/<hash> (Req 3.3).
export function handlePostToolUse(payload) {
  const cwd = payload.cwd;
  const toolName = payload.tool_name;
  if (!cwd || toolName !== 'execute_bash') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  const lock = readLock(cwd);
  if (!lock.specs) return { exitCode: 0, stdout: '', stderr: '' };

  const restored = [];
  for (const spec of Object.keys(lock.specs)) {
    for (const f of frozenFiles(cwd, spec)) {
      const abs = path.join(cwd, f.path);
      let current = null;
      try {
        current = hashFile(abs);
      } catch {
        current = null; // file missing or unreadable
      }
      if (current !== f.sha256) {
        // Restore the exact frozen bytes from the content-addressed copy.
        const frozenCopy = path.join(cwd, '.necro', 'frozen', f.sha256);
        try {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.copyFileSync(frozenCopy, abs);
          restored.push(f.path);
        } catch {
          // frozen copy missing -> cannot restore, leave the file as-is
        }
      }
    }
  }

  if (restored.length === 0) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  return {
    exitCode: 0,
    stdout: '',
    stderr: restored
      .map((p) => `Restored frozen file ${p} after shell command.`)
      .join('\n'),
  };
}
