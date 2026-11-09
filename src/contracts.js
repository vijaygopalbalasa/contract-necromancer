import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile } from './canon.js';
import { lockedRunners, findRunner, runReport, spawnLimited, timeoutReason, withoutRedirects, frozenGlobDrift } from './runners.js';

const RUNNER = fileURLToPath(new URL('./contract-runner.js', import.meta.url));

// Filename stem of a contract file, e.g. "canon" from "canon.contract.test.js".
export function contractName(filePath) {
  return path.basename(filePath).replace(/\.contract\.test\.js$/, '');
}

// Environment for the runner and for runner commands. The parent test runner sets
// NODE_TEST_* variables that would make a nested run behave as a child of it, so they
// are removed. So are the variables that redirect an interpreter or test framework to
// other code (Req 13.11); the contract process inherits this environment from the runner.
function runnerEnv() {
  const env = withoutRedirects(process.env);
  for (const k of Object.keys(env)) {
    if (k.startsWith('NODE_TEST_')) delete env[k];
  }
  return env;
}

// Run one contract file through src/contract-runner.js, which uses the node:test
// run() API. Returns { file, events }, { reason } when the file ran past the time
// limit (Req 13.7; the runner and everything it started are killed), or null when
// the runner itself failed.
function runFile(cwd, absPath) {
  const { res, timedOut, limitMs } = spawnLimited(process.execPath, [RUNNER, absPath, cwd], {
    cwd,
    env: runnerEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (timedOut) return { reason: timeoutReason(path.basename(absPath), limitMs) };
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

// Req 13.2, 13.3, 13.4, 13.7: turn the report of a runner file into [{ name, result, reason? }].
// Each testcase is a contract named by its `name` attribute; one that holds a failure
// or error, or is skipped, does not pass. A run that gave no usable report is one
// failing contract named after the file, with a plain reason. A run that exited with a
// non-zero status or ran too long fails the file: the names of its report are kept
// when it has one, but none of them passes.
function interpretReport(run, stem) {
  if (run.cases === undefined) return [{ name: stem, result: 'fail', reason: run.reason }];
  if (run.reason !== undefined) return run.cases.map((t) => ({ name: t.name, result: 'fail', reason: run.reason }));
  return run.cases.map((t) => ({ name: t.name, result: t.outcome === 'passed' ? 'pass' : 'fail' }));
}

// A file that runs on node:test; every other contract file runs with a command from runners.json.
function isNodeContract(filePath) {
  return filePath.endsWith('.contract.test.js');
}

// Run every frozen contract file for a spec through the node:test run() API (or,
// for files other than *.contract.test.js, the command of runners.json) and
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

  // Req 13.1: the patterns of the spec's frozen runners.json, read lazily. null
  // means the file is missing, differs from the lock, or cannot be parsed.
  let patterns;
  const frozenPatterns = () => {
    if (patterns === undefined) patterns = lockedRunners(cwd, entry.runners);
    return patterns;
  };

  // Req 13.9: the files locked with the spec next to runners.json (a conftest.py, a
  // pytest.ini). The paths of those that changed or are gone, read lazily.
  let moved;
  const movedFrozen = () => {
    if (moved === undefined) {
      moved = (entry.frozen || [])
        .filter((f) => {
          try {
            return hashFile(path.resolve(cwd, f.path)) !== f.sha256;
          } catch {
            return true;
          }
        })
        .map((f) => f.path);
    }
    return moved;
  };

  // Req 13.12: the "frozen" globs of the locked runners.json expanded again. The paths that
  // match now and were not locked, read lazily. (A locked file that is gone is in movedFrozen.)
  let added;
  const addedFrozen = () => {
    if (added === undefined) added = frozenGlobDrift(cwd, entry).added;
    return added;
  };

  const out = [];
  for (const c of files.values()) {
    const absPath = path.resolve(cwd, c.path);
    const stem = contractName(c.path);
    const push = (name, result, reason) => {
      const r = { name, path: c.path, sha256: c.sha256, result };
      if (reason !== undefined) r.reason = reason;
      out.push(r);
    };

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

    let contracts;
    if (isNodeContract(c.path)) {
      const ran = runFile(cwd, absPath);
      contracts = ran && ran.reason !== undefined ? [{ name: stem, result: 'fail', reason: ran.reason }] : interpret(ran, stem);
    } else {
      // Req 13.1, 13.5: a contract file of another language runs with the command of
      // the frozen runners.json. When that file moved, or no pattern matches, the
      // file counts as failing in the same way as a changed contract file (Req 4.9).
      const known = frozenPatterns();
      const command = known === null ? null : findRunner(known, path.basename(c.path));
      if (command === null) {
        const reason =
          known === null
            ? `Cannot run ${stem}: the frozen runners.json is missing or has changed. Restore it, or freeze the spec again.`
            : `Cannot run ${stem}: no pattern in runners.json matches this file. Restore runners.json, or freeze the spec again.`;
        for (const name of c.names.length ? c.names : [stem]) push(name, 'fail', reason);
        continue;
      }
      const changed = movedFrozen();
      if (changed.length > 0) {
        const reason = `Cannot run ${stem}: the frozen file ${changed.join(', ')} changed or is missing. Restore it, or freeze the spec again.`;
        for (const name of c.names.length ? c.names : [stem]) push(name, 'fail', reason);
        continue;
      }
      // Req 13.12: a file that matches a "frozen" glob now but was not locked at the freeze.
      const added = addedFrozen();
      if (added.length > 0) {
        const reason = `Cannot run ${stem}: ${added.join(', ')} matches a "frozen" glob of runners.json but was not locked at the freeze. Remove it, or ask a person to freeze the spec again.`;
        for (const name of c.names.length ? c.names : [stem]) push(name, 'fail', reason);
        continue;
      }
      contracts = interpretReport(runReport(cwd, absPath, command, runnerEnv()), stem);
    }
    for (const r of contracts) push(r.name, r.result, r.reason);

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
