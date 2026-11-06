import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile } from './canon.js';

const RUNNER = fileURLToPath(new URL('./contract-runner.js', import.meta.url));

// Filename stem of a contract file, e.g. "canon" from "canon.contract.test.js".
function contractName(filePath) {
  return path.basename(filePath).replace(/\.contract\.test\.js$/, '');
}

// Environment for the runner. The parent test runner sets NODE_TEST_* variables
// that would make a nested run behave as a child of it, so they are removed.
function runnerEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('NODE_TEST_')) delete env[k];
  }
  return env;
}

// Run one contract file through src/contract-runner.js, which uses the node:test
// run() API. Returns { file, events } or null when the runner itself failed.
function runFile(cwd, absPath) {
  const res = spawnSync(process.execPath, [RUNNER, absPath, cwd], {
    cwd,
    env: runnerEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    if (parsed && typeof parsed.file === 'string' && Array.isArray(parsed.events)) return parsed;
  } catch {
    // fall through: unreadable runner output counts as a failed run
  }
  return null;
}

// Turn the run() events of one contract file into [{ name, result }].
// - Each named test is a contract. Names are kept exactly as reported (Req 4.11).
// - A skipped or todo test, or suite, counts as failing (Req 4.7).
// - A suite is a contract only when it failed for its own reasons (its body
//   threw, a hook failed) or was skipped; a suite that failed only because a
//   child failed is already represented by that child.
// - An entry at nesting 0 whose name is the contract file's own path is the
//   runner's report about the file, not a contract. When it failed, the file
//   failed to load or exited badly, and the file counts as failing (Req 4.11).
//   When it passed, the file had no tests.
// - A file with no contracts is one failing contract named after the file (Req 4.8).
function interpret(run, stem) {
  const contracts = [];
  let fileFailed = run === null;
  for (const e of run ? run.events : []) {
    if (e.kind === 'suite') {
      if ((e.ok && (e.skip || e.todo)) || (!e.ok && e.failureType !== 'subtestsFailed')) {
        contracts.push({ name: e.name, result: 'fail' });
      }
      continue;
    }
    if (e.nesting === 0 && e.name === run.file) {
      // The runner's own entry for the file: a failure here is a load failure or
      // a bad exit code. A pass is reported for a file with zero tests.
      if (!e.ok) fileFailed = true;
      continue;
    }
    contracts.push({ name: e.name, result: e.ok && !e.skip && !e.todo ? 'pass' : 'fail' });
  }
  if (fileFailed || contracts.length === 0) contracts.push({ name: stem, result: 'fail' });
  return contracts;
}

// Run every frozen contract file for a spec through the node:test run() API and
// return one result per named test: { name, path, sha256, result } (Req 4.4, 4.12).
// Req 4.8: a file that fails to load, or loads but defines zero tests, counts as
// exactly one failing contract named after the file.
// Req 4.9: each contract file is hashed immediately before running; if the hash
// differs from the lock, every contract in that file counts as failing.
// Req 4.10: a contract name recorded in the lock that is missing from its file's
// run counts as failing. Names are matched per contract file, never across files.
export function runContracts(cwd, spec, lock) {
  const entry = lock && lock.specs && lock.specs[spec];
  if (!entry || !entry.contracts) return [];

  // One run per file, even if the lock lists a file more than once (verify does
  // that, one entry per contract); recorded names are merged.
  const files = new Map();
  for (const c of entry.contracts) {
    const known = files.get(c.path);
    if (known) {
      for (const n of c.names || []) if (!known.names.includes(n)) known.names.push(n);
    } else {
      files.set(c.path, { path: c.path, sha256: c.sha256, names: [...(c.names || [])] });
    }
  }

  const out = [];
  for (const c of files.values()) {
    const absPath = path.resolve(cwd, c.path);
    const stem = contractName(c.path);
    const push = (name, result) => out.push({ name, path: c.path, sha256: c.sha256, result });

    // Req 4.9: if the hash differs from the lock (or the file is gone or
    // unreadable), the file moved during the task, so everything in it fails.
    let tampered = false;
    try {
      if (hashFile(absPath) !== c.sha256) tampered = true;
    } catch {
      tampered = true;
    }
    if (tampered) {
      for (const name of c.names.length ? c.names : [stem]) push(name, 'fail');
      continue;
    }

    const contracts = interpret(runFile(cwd, absPath), stem);
    for (const r of contracts) push(r.name, r.result);

    // Req 4.10, per file.
    const seen = new Set(contracts.map((r) => r.name));
    for (const name of c.names) {
      if (!seen.has(name)) {
        seen.add(name);
        push(name, 'fail');
      }
    }
  }
  return out;
}
