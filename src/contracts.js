import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Filename stem of a contract file, e.g. "canon" from "canon.contract.test.js".
function contractName(filePath) {
  return path.basename(filePath).replace(/\.contract\.test\.js$/, '');
}

// Parse TAP output into one { name, result } per named test.
// describe/suite entries (type 'suite') are skipped; only tests are contracts.
// A test whose reported name is a file path is a load failure, renamed to the
// file stem so results compare by a clean name.
function parseTap(tap, stem) {
  const lines = tap.split(/\r?\n/);
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(ok|not ok)\s+\d+\s+-\s+(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const passed = m[2] === 'ok';
    let name = m[3];
    let type = 'test';
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') continue;
      const lead = l.length - l.trimStart().length;
      if (lead <= indent) break; // back to same/lesser indent: next result or summary
      const trimmed = l.trim();
      if (trimmed === '...') break; // end of this result's YAML block
      const tm = trimmed.match(/^type:\s*['"]?([^'"\s]+)['"]?$/);
      if (tm) {
        type = tm[1];
        break;
      }
    }
    if (type !== 'test') continue; // skip describe/suite entries
    if (/\.js$/.test(name) || name.includes('/') || name.includes('\\')) {
      name = stem; // file failed to load; name it after the file
    }
    results.push({ name, result: passed ? 'pass' : 'fail' });
  }
  return results;
}

// Run every frozen contract file for a spec with `node --test --test-reporter=tap`
// and return one result per named test: { name, path, sha256, result }.
// A file that fails to load counts as one failing contract named after the file.
export function runContracts(cwd, spec, lock) {
  const entry = lock && lock.specs && lock.specs[spec];
  if (!entry || !entry.contracts) return [];
  // Run child `node --test` as a standalone runner. The parent test runner sets
  // NODE_TEST_* env vars that make a child route results over IPC instead of
  // stdout, so strip them to keep TAP on stdout.
  const childEnv = { ...process.env };
  for (const k of Object.keys(childEnv)) {
    if (k.startsWith('NODE_TEST_')) delete childEnv[k];
  }
  const out = [];
  for (const c of entry.contracts) {
    const absPath = path.join(cwd, c.path);
    const stem = contractName(c.path);
    let tap = '';
    let loaded = true;
    try {
      tap = execFileSync(process.execPath, ['--test', '--test-reporter=tap', absPath], {
        cwd,
        env: childEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (e) {
      // node --test exits non-zero on any failure; stdout still holds the TAP.
      loaded = false;
      tap = (e && e.stdout) || '';
    }
    const parsed = parseTap(tap, stem);
    if (parsed.length === 0) {
      if (!loaded) {
        out.push({ name: stem, path: c.path, sha256: c.sha256, result: 'fail' });
      }
      // a file that loaded with zero tests reports nothing
    } else {
      for (const p of parsed) {
        out.push({ name: p.name, path: c.path, sha256: c.sha256, result: p.result });
      }
    }
  }
  return out;
}
