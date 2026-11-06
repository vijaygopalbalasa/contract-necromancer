// Contracts for Requirement 3 (block edits to frozen files): the PreToolUse checks that stop a write.
// R3.1, R3.2, R3.4, R3.5, R3.6, R3.11. The PostToolUse and shell behavior is in shell.contract.test.js.
//
// Each test freezes a throwaway project in a temp directory and calls `necro hook pre` the way Kiro does:
// a JSON payload on stdin, the exit code and stderr read back. This file carries its own helpers.
//
// The receipt pins the files the hooks use. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/hooks.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function necro(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv() });
}

// One hook call, as Kiro makes it. kind is 'pre' or 'post'.
function hook(cwd, kind, toolName, toolInput) {
  const event = { pre: 'PreToolUse', post: 'PostToolUse' }[kind];
  const payload = { session_id: 's-contract', hook_event_name: event, cwd, tool_name: toolName, tool_input: toolInput };
  return necro(cwd, ['hook', kind], JSON.stringify(payload));
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-block-'));
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const REQ_REL = '.kiro/specs/demo/requirements.md';
const CONTRACT_REL = 'contracts/demo/hello.contract.test.js';
const TASKS_REL = '.kiro/specs/demo/tasks.md';

const CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 hello', () => { assert.ok(true); });
`;

// A frozen spec called "demo" with one passing contract.
function frozenProject(cwd) {
  put(cwd, REQ_REL, '# Requirements: demo\n');
  put(cwd, CONTRACT_REL, CONTRACT);
  put(cwd, TASKS_REL, '- [ ] 1. Task one\n- [ ] 2. Task two\n');
  const res = necro(cwd, ['freeze', 'demo']);
  assert.equal(res.status, 0, `freeze failed: ${res.stderr}${res.stdout}`);
}

// A real block: exit code 2 with a reason, and not a crash of the hook.
function assertBlocked(res, label) {
  assert.equal(res.status, 2, `${label}: expected exit 2, got ${res.status}. stderr: ${res.stderr}`);
  assert.notEqual(res.stderr.trim(), '', `${label}: a reason is written to stderr`);
  assert.doesNotMatch(res.stderr, /Hook error/, `${label}: the hook did not crash`);
}

function assertSilentAllow(res, label) {
  assert.equal(res.status, 0, `${label}: expected exit 0, got ${res.status}. stderr: ${res.stderr}`);
  assert.equal(res.stdout, '', `${label}: nothing on stdout`);
  assert.equal(res.stderr, '', `${label}: nothing on stderr`);
}

function writeCall(tool, p) {
  return tool === 'fs_write' ? { path: p, text: 'changed' } : { path: p, oldStr: 'a', newStr: 'b' };
}

test('R3.1 a write tool call to a frozen file exits 2 with a reason on stderr', () =>
  temp((cwd) => {
    frozenProject(cwd);
    const before = fs.readFileSync(path.join(cwd, CONTRACT_REL), 'utf8');
    for (const tool of ['fs_write', 'str_replace']) {
      for (const rel of [REQ_REL, CONTRACT_REL]) {
        for (const p of [rel, path.join(cwd, rel)]) {
          const res = hook(cwd, 'pre', tool, writeCall(tool, p));
          assertBlocked(res, `${tool} ${p}`);
          assert.match(res.stderr, /frozen/);
          assert.ok(res.stderr.includes(rel), `${tool} ${p}: the reason names ${rel}: ${res.stderr}`);
        }
      }
    }
    assert.equal(fs.readFileSync(path.join(cwd, CONTRACT_REL), 'utf8'), before);
  }));

test('R3.2 a write tool call to any path under .necro/ exits 2', () =>
  temp((cwd) => {
    frozenProject(cwd);
    const frozenCopy = fs.readdirSync(path.join(cwd, '.necro', 'frozen'))[0];
    const targets = [
      '.necro/lock.json',
      `.necro/frozen/${frozenCopy}`,
      '.necro/receipts/demo/abc.json', // a file that does not exist yet
      '.necro/state/demo.tasks.md',
      '.necro/anything/new/file.txt',
      '.necro',
    ];
    for (const tool of ['fs_write', 'str_replace']) {
      for (const rel of targets) {
        for (const p of [rel, path.join(cwd, rel)]) {
          const res = hook(cwd, 'pre', tool, writeCall(tool, p));
          assertBlocked(res, `${tool} ${p}`);
          assert.match(res.stderr, /\.necro/);
        }
      }
    }
  }));

test('R3.4 a tool call that touches no frozen file exits 0 and prints nothing', () =>
  temp((cwd) => {
    frozenProject(cwd);
    put(cwd, 'src/notes.md', 'notes\n');
    const calls = [
      ['fs_write', { path: 'src/canon.js', text: 'x' }],
      ['fs_write', { path: path.join(cwd, 'src', 'abs.js'), text: 'x' }],
      ['str_replace', { path: 'src/notes.md', oldStr: 'notes', newStr: 'more notes' }],
      // Paths that only look like protected ones.
      ['fs_write', { path: 'contracts/demo2/hello.contract.test.js', text: 'x' }],
      ['fs_write', { path: `${CONTRACT_REL}.bak`, text: 'x' }],
      ['fs_write', { path: 'contracts/hello.contract.test.js', text: 'x' }],
      ['fs_write', { path: '.necro-notes/a.txt', text: 'x' }],
      ['fs_write', { path: 'necro/lock.json', text: 'x' }],
      // The tasks file is not frozen, and a write that ticks nothing is not gated.
      ['fs_write', { path: TASKS_REL, text: '- [ ] 1. Task one\n- [ ] 2. Task two\nNotes\n' }],
      ['execute_bash', { command: 'ls -la' }],
      // Text that mentions a protected path is content, not a path.
      ['fs_write', { path: 'src/readme.txt', text: 'see .necro/lock.json and contracts/demo/hello.contract.test.js' }],
    ];
    for (const [tool, input] of calls) {
      assertSilentAllow(hook(cwd, 'pre', tool, input), `${tool} ${JSON.stringify(input).slice(0, 60)}`);
    }
    // PostToolUse after a shell command that changed no frozen file also prints nothing.
    assertSilentAllow(hook(cwd, 'post', 'execute_bash', { command: 'ls -la' }), 'post execute_bash');
  }));

test('R3.5 a path is resolved to its real path and compared case-insensitively before the check', () =>
  temp((cwd) => {
    frozenProject(cwd);
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    const absContract = path.join(cwd, CONTRACT_REL);

    // Letter case.
    for (const p of ['Contracts/demo/hello.contract.test.js', 'contracts/DEMO/HELLO.contract.test.js', '.KIRO/specs/demo/Requirements.md']) {
      const res = hook(cwd, 'pre', 'fs_write', writeCall('fs_write', p));
      assertBlocked(res, p);
      assert.match(res.stderr, /frozen/);
    }
    for (const p of ['.NECRO/lock.json', '.Necro/receipts/demo/a.json', '.necro', '.NeCrO']) {
      const res = hook(cwd, 'pre', 'str_replace', writeCall('str_replace', p));
      assertBlocked(res, p);
      assert.match(res.stderr, /\.necro/);
    }

    // A symbolic link to a frozen file, with an absolute and with a relative target.
    fs.symlinkSync(absContract, path.join(cwd, 'src', 'alias.js'));
    fs.symlinkSync(`../${CONTRACT_REL}`, path.join(cwd, 'src', 'alias2.js'));
    for (const p of ['src/alias.js', 'src/alias2.js']) {
      const res = hook(cwd, 'pre', 'fs_write', writeCall('fs_write', p));
      assertBlocked(res, p);
      assert.ok(res.stderr.includes(CONTRACT_REL), `${p}: names the real frozen file: ${res.stderr}`);
    }

    // A link in the middle of the path.
    fs.symlinkSync(path.join(cwd, 'contracts'), path.join(cwd, 'alias-dir'), 'dir');
    assertBlocked(hook(cwd, 'pre', 'fs_write', writeCall('fs_write', 'alias-dir/demo/hello.contract.test.js')), 'alias-dir');

    // A new file under a link to .necro/ uses the nearest existing parent.
    fs.symlinkSync(path.join(cwd, '.necro'), path.join(cwd, 'shortcut'), 'dir');
    const viaDir = hook(cwd, 'pre', 'fs_write', writeCall('fs_write', 'shortcut/receipts/demo/new.json'));
    assertBlocked(viaDir, 'shortcut');
    assert.match(viaDir.stderr, /\.necro/);

    // A link to a file that does not exist yet.
    fs.symlinkSync(path.join(cwd, '.necro', 'ghost.json'), path.join(cwd, 'src', 'ghost.json'));
    assertBlocked(hook(cwd, 'pre', 'fs_write', writeCall('fs_write', 'src/ghost.json')), 'ghost link');

    // ".." segments are applied.
    assertBlocked(hook(cwd, 'pre', 'fs_write', writeCall('fs_write', `src/../${CONTRACT_REL}`)), 'dot dot');
    assertBlocked(hook(cwd, 'pre', 'fs_write', writeCall('fs_write', 'nothing-here/../.necro/lock.json')), 'dot dot necro');

    // A link to a file that is not protected is still allowed.
    fs.writeFileSync(path.join(cwd, 'src', 'a.js'), '');
    fs.symlinkSync(path.join(cwd, 'src', 'a.js'), path.join(cwd, 'src', 'b.js'));
    assertSilentAllow(hook(cwd, 'pre', 'fs_write', writeCall('fs_write', 'src/b.js')), 'link to an unprotected file');
  }));

test('R3.6 a tool that is not known to be read-only is blocked when its input names a protected path', () =>
  temp((cwd) => {
    frozenProject(cwd);
    const absContract = path.join(cwd, CONTRACT_REL);

    // Unknown tools, and Kiro's other write tools, with the path in any field, nested or not.
    const blocked = [
      ['custom_write_tool', { path: CONTRACT_REL, text: 'x' }],
      ['custom_write_tool', { somewhere: { deeper: [absContract] } }],
      ['delete_file', { explanation: 'tidy', targetFile: absContract }],
      ['delete_file', { explanation: 'tidy', targetFile: '.necro/lock.json' }],
      ['fs_append', { path: CONTRACT_REL, text: 'x' }],
      ['fs_append', { path: '.necro/lock.json', text: 'x' }],
      ['multi_edit', { edits: [{ file: 'src/ok.js' }, { file: '.necro/lock.json' }] }],
      ['move_files', { paths: ['src/a.js', CONTRACT_REL] }],
      ['rename', { from: 'src/a.js', to: 'Contracts/demo/HELLO.contract.test.js' }],
      // Names that sound read-only but are not on the list.
      ['code', { operation: 'format_code', file_path: CONTRACT_REL }],
      ['code', { operation: 'rename_symbol', file_path: absContract, row: 1, column: 1, new_name: 'x' }],
      ['view_file', { path: CONTRACT_REL }],
      ['search_files', { path: '.necro/lock.json' }],
    ];
    for (const [tool, input] of blocked) {
      assertBlocked(hook(cwd, 'pre', tool, input), `${tool} ${JSON.stringify(input).slice(0, 70)}`);
    }

    // The documented read tools may name protected paths.
    for (const tool of ['read_file', 'list_directory', 'file_search', 'grep_search', 'grep', 'glob']) {
      const input = { path: CONTRACT_REL, query: '.necro/lock.json', pattern: CONTRACT_REL, includePattern: '.necro/**' };
      assertSilentAllow(hook(cwd, 'pre', tool, input), tool);
    }

    // An unknown tool that names no protected path is allowed, and a call with no input does not crash.
    assertSilentAllow(hook(cwd, 'pre', 'custom_write_tool', { path: 'src/ok.js', other: ['a', { b: 'c' }], n: 3 }), 'unknown, unprotected');
    assertSilentAllow(hook(cwd, 'pre', 'custom_write_tool', undefined), 'no input');
  }));

test('R3.11 a non-read-only tool call with a too long or NUL-containing input string is blocked', () =>
  temp((cwd) => {
    frozenProject(cwd);
    const LONG = 'a'.repeat(5000);
    const blocked = [
      ['fs_write', { path: `src/${LONG}.js`, text: 'x' }],
      ['str_replace', { path: `src/${LONG}.js`, oldStr: 'a', newStr: 'b' }],
      ['fs_write', { path: 'src/ok.js\u0000.txt', text: 'x' }],
      ['fs_write', { path: `${CONTRACT_REL}\u0000`, text: 'x' }],
      ['str_replace', { path: '\u0000', oldStr: 'a', newStr: 'b' }],
      ['custom_write_tool', { target: LONG }],
      ['custom_write_tool', { target: 'src/a\u0000b.js' }],
      ['custom_write_tool', { text: LONG, path: 'src/ok.js' }],
      ['custom_write_tool', { edits: [{ file: 'src/ok.js' }, { file: LONG }] }],
      ['custom_write_tool', { paths: ['src/ok.js', 'x\u0000y'] }],
    ];
    for (const [tool, input] of blocked) {
      assertBlocked(hook(cwd, 'pre', tool, input), `${tool} ${JSON.stringify(input).slice(0, 50)}`);
    }

    // Read-only tools are never blocked for this.
    for (const [tool, input] of [
      ['read_file', { path: 'src/ok.js', note: LONG }],
      ['grep', { pattern: 'a\u0000b' }],
      ['glob', { pattern: LONG }],
      ['list_directory', { path: 'src\u0000' }],
    ]) {
      assertSilentAllow(hook(cwd, 'pre', tool, input), tool);
    }

    // File content and shell commands are not paths, so a large file or a long command still goes through.
    const big = 'line\n'.repeat(50000);
    for (const [tool, input] of [
      ['fs_write', { path: 'src/big.js', text: big }],
      ['fs_write', { path: 'src/bin.dat', text: 'a\u0000b' }],
      ['str_replace', { path: 'src/ok.js', oldStr: big, newStr: `${big}\u0000` }],
      ['execute_bash', { command: `echo ${LONG}` }],
    ]) {
      assertSilentAllow(hook(cwd, 'pre', tool, input), `${tool} content`);
    }
  }));
