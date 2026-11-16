// Contracts for Requirement 16.7 of the receipt-viewer spec: a browser contract that finds no Chrome or Chromium skips with a
// reason that starts with "cannot run:" and names the missing browser and CHROME_PATH, so necro verify reports it as not run
// (necro-core 6.17) while the gate still counts it as failing (necro-core 4.7 and 6.16). A layout that was not measured
// never passes. When CHROME_PATH is set only that path is tried; otherwise the usual macOS, Linux and Windows install paths,
// then PATH.
//
// This file needs no browser. It finds the browser contract files by scanning contracts/receipt-viewer (it keeps no list of
// them, and leaves itself out): a file is a browser contract file when its code, comments left out, reads process.env.CHROME_PATH
// or starts a browser with --remote-debugging-port. That covers the files with their own lookup and the files that run
// another contract file or a receipt whose page contracts start a browser. Each such file is run in a child process with
// CHROME_PATH set to a path that does not exist. One contract per file passes only if
//   - every test the child skipped has a reason that starts with "cannot run:" and names the browser and CHROME_PATH,
//   - the file shows at least one such skip (a file that found a browser anyway, or did not skip, shows none), and
//   - no test failed with the missing-browser error (the lookup threw, or a program that is not there was started).
// Tests of those files that need no browser run too and are ignored, whatever they report.
//
// The child output is read from the TAP reporter of node --test. There is no shared helper file (it would not be frozen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SELF = path.basename(fileURLToPath(import.meta.url));
const MISSING = path.join(os.tmpdir(), 'necro-no-such-browser', 'chrome');

const codeOf = (file) =>
  fs
    .readFileSync(path.join(HERE, file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

// The browser contract files, found by what they do.
const BROWSER_FILES = fs
  .readdirSync(HERE)
  .filter((f) => f.endsWith('.contract.test.js') && f !== SELF)
  .filter((f) => /process\.env\.CHROME_PATH|--remote-debugging-port/.test(codeOf(f)))
  .sort();

// What a lookup that did not skip looks like: the old throw, a program that is not there, a browser that never answered.
const MISSING_BROWSER_ERROR = /No Chrome or Chromium found|Could not connect to the browser|spawn [^\n]*necro-no-such-browser[^\n]* ENOENT|ENOENT[^\n]*necro-no-such-browser/;

const runs = new Map();
function runWithoutBrowser(file) {
  if (!runs.has(file)) {
    assert.ok(!fs.existsSync(MISSING), 'the path used as a missing browser must not exist');
    const env = { ...process.env, CHROME_PATH: MISSING };
    for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join('contracts', 'receipt-viewer', file)], {
      cwd: ROOT,
      encoding: 'utf8',
      env,
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    runs.set(file, run);
  }
  return runs.get(file);
}

// One entry per test line of the TAP output: { ok, name, skip } with skip the reason, '' for a bare SKIP, or null.
function tests(output) {
  const found = [];
  for (const line of output.split('\n')) {
    const m = /^\s*(not ok|ok) \d+ - (.*?)(?: # SKIP(?: (.*))?)?\s*$/.exec(line);
    if (m) found.push({ ok: m[1] === 'ok', name: m[2], skip: / # SKIP(?: |$)/.test(line) ? (m[3] ?? '') : null });
  }
  return found;
}

test('R16.7 the browser contract files are found by scanning contracts/receipt-viewer, and there are some', () => {
  assert.ok(BROWSER_FILES.length > 0, 'no contract file in contracts/receipt-viewer reads CHROME_PATH or starts a browser');
  assert.ok(!BROWSER_FILES.includes(SELF), 'this file leaves itself out');
  assert.ok(!fs.existsSync(MISSING), 'the path used as a missing browser does not exist');
});

for (const file of BROWSER_FILES) {
  test(`R16.7 ${file} with CHROME_PATH set to a path that does not exist skips its browser tests with a reason that starts with "cannot run:" and names the browser and CHROME_PATH, and none fails with the missing-browser error`, () => {
    const run = runWithoutBrowser(file);
    assert.ok(!run.error, `the child run of ${file} did not finish (${run.error ? run.error.message : ''}); it was probably running a real browser`);
    const output = `${run.stdout}\n${run.stderr}`;
    const results = tests(run.stdout);
    assert.ok(results.length > 0, `${file} reported no test:\n${output.slice(-1500)}`);

    const skipped = results.filter((r) => r.skip !== null);
    for (const r of skipped) {
      assert.ok(r.skip.startsWith('cannot run:'), `${file}: "${r.name}" skipped with "${r.skip}", which does not start with "cannot run:"`);
      assert.match(r.skip, /Chrome|Chromium|browser/i, `${file}: the skip reason of "${r.name}" does not name the missing browser: "${r.skip}"`);
      assert.match(r.skip, /CHROME_PATH/, `${file}: the skip reason of "${r.name}" does not name CHROME_PATH: "${r.skip}"`);
    }
    assert.ok(skipped.length > 0, `${file} shows no skip with CHROME_PATH=${MISSING}: it found a browser anyway, or it ran without one`);

    // A failed test whose report holds the missing-browser error. Only the failure blocks are read: lines after a "not ok".
    const failures = output.split('\n').reduce(
      (state, line) => {
        if (/^\s*not ok \d+ - /.test(line)) state.open = line;
        else if (/^\s*ok \d+ - /.test(line)) state.open = null;
        if (state.open && MISSING_BROWSER_ERROR.test(line)) state.hits.add(state.open.trim());
        return state;
      },
      { open: null, hits: new Set() },
    ).hits;
    assert.deepEqual([...failures], [], `${file}: a test failed with the missing-browser error instead of skipping`);
  });
}
