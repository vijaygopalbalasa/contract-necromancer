import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hashFile } from './canon.js';

// Filename stem of a contract file, e.g. "canon" from "canon.contract.test.js".
function contractName(filePath) {
  return path.basename(filePath).replace(/\.contract\.test\.js$/, '');
}

// Parse TAP output into one { name, result, isFile } per named test.
// - describe/suite entries (type 'suite') are skipped; only tests are contracts.
// - A TAP directive (# SKIP or # TODO) forces the result to "fail" (Req 4.7), so a
//   skipped or todo contract can never let a spec pass vacuously.
// - A "test" whose reported name is a file path is a synthetic "file loaded"
//   entry (a file with zero real tests, or a file that failed to load), flagged
//   isFile so the caller can turn a file with zero real contracts into one
//   failing contract named after the file (Req 4.8).
function parseTap(tap) {
  const lines = tap.split(/\r?\n/);
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(ok|not ok)\s+\d+\s+-\s+(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const ok = m[2] === 'ok';
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
    // TAP directives # SKIP / # TODO mean the contract did not actually run;
    // count it as failing and strip the directive from the name (Req 4.7).
    let result = ok ? 'pass' : 'fail';
    const dm = name.match(/^(.*?)\s+#\s+(SKIP|TODO)\b/i);
    if (dm) {
      name = dm[1];
      result = 'fail';
    }
    const isFile = name.includes('/') || name.includes('\\') || /\.[mc]?js$/i.test(name);
    results.push({ name, result, isFile });
  }
  return results;
}

// Run every frozen contract file for a spec with `node --test --test-reporter=tap`
// and return one result per named test: { name, path, sha256, result }.
// A file that fails to load, or loads but defines zero real tests, counts as
// exactly one failing contract named after the file, so a spec can never pass
// with zero contracts (Req 4.8). Skipped or todo contracts count as failing (Req 4.7).
// Req 4.9: each contract file is hashed immediately before running; if the hash
// differs from the lock, every contract in that file is counted as failing.
// Req 4.10: a contract name recorded in the lock that is missing from the run is
// counted as failing.
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

    // Req 4.9: hash the contract file immediately before running it. If the hash
    // differs from the lock (or the file is gone/unreadable), the file moved
    // during the task, so every contract in it counts as failing.
    let tampered = false;
    try {
      if (hashFile(absPath) !== c.sha256) tampered = true;
    } catch {
      tampered = true; // file missing or unreadable
    }
    if (tampered) {
      const names = Array.isArray(c.names) && c.names.length ? c.names : [stem];
      for (const name of names) {
        out.push({ name, path: c.path, sha256: c.sha256, result: 'fail' });
      }
      continue;
    }

    let tap = '';
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
      tap = (e && e.stdout) || '';
    }
    const parsed = parseTap(tap);
    const real = parsed.filter((p) => !p.isFile);
    if (real.length === 0) {
      // No real contracts ran: a load failure or a file with zero tests. This
      // is one failing contract named after the file (Req 4.8).
      out.push({ name: stem, path: c.path, sha256: c.sha256, result: 'fail' });
    } else {
      for (const p of real) {
        out.push({ name: p.name, path: c.path, sha256: c.sha256, result: p.result });
      }
    }
  }

  // Req 4.10: a contract name recorded in the lock that is missing from the run
  // is failing. This guards against a contract quietly disappearing.
  const seen = new Set(out.map((r) => r.name));
  for (const c of entry.contracts) {
    for (const name of c.names || []) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push({ name, path: c.path, sha256: c.sha256, result: 'fail' });
      }
    }
  }
  return out;
}
