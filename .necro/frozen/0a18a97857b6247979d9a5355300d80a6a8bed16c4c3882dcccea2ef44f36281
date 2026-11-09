// Contract for Requirement 13.12 of the necro-core spec: when runner contracts run, and when `necro verify` runs, the
// "frozen" globs of the locked runners.json are expanded again, and every runner file of the spec counts as failing
// (verify: MISMATCH) if the set of matching files differs from the locked set. A matching file added after the freeze
// (for example a new conftest.py) is caught as well as a changed one.
//
// The test builds a throwaway project with two runner files for a fake test framework written in Node and carried in
// this file, and a "frozen" glob that matches two files. It freezes the project and checks, in this order:
//   - nothing moved: both contracts pass and verify says CONFIRMED;
//   - a new file outside the glob: nothing changes;
//   - a new file inside the glob: both runner files fail with a reason that names the new file, the fake framework is
//     never started, and verify prints MISMATCH naming the new file;
//   - a locked file removed: both runner files fail, and verify prints MISMATCH naming it.
//
// This file carries its own helpers, so it does not depend on any file that is not frozen.
//
// The receipt pins the files this test exercises. Keep these lines, necro reads `from '...'` text:
//   from '../../src/runners.js'
//   from '../../src/contracts.js'
//   from '../../src/lock.js'
//   from '../../src/check.js'
//   from '../../src/verify.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runContracts } from '../../src/contracts.js';
import { freezeSpec, readLock } from '../../src/lock.js';
import { runCheck } from '../../src/check.js';
import { verify } from '../../src/verify.js';

// A fake test framework. It reads a contract file with one line per testcase ("pass <name>" or "fail <name>"), appends
// a line to a log file each time it is started, and writes a JUnit XML report to the path it is given.
const FAKE_RUNNER = `'use strict';
const fs = require('node:fs');
const [file, report, log] = process.argv.slice(2);
fs.appendFileSync(log, file + '\\n');
let cases = '';
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  if (line.trim() === '') continue;
  const space = line.indexOf(' ');
  const kind = line.slice(0, space);
  const name = line.slice(space + 1);
  cases += kind === 'pass'
    ? '<testcase classname="fake" name="' + name + '"/>'
    : '<testcase classname="fake" name="' + name + '"><failure message="failed">x</failure></testcase>';
}
fs.writeFileSync(report, '<?xml version="1.0"?><testsuites><testsuite name="fake">' + cases + '</testsuite></testsuites>');
`;

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

// Run fn and return what it printed with console.log, with its return value.
function printed(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const code = fn();
    return { code, out: lines.join('\n') };
  } finally {
    console.log = original;
  }
}

test('R13.12 a file that matches a frozen glob now and was not locked at the freeze, or a locked file that is gone, makes every runner file fail and verify print MISMATCH naming it, while an unrelated new file changes nothing', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-frozen-globs-'));
  const aside = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-frozen-globs-aside-'));
  try {
    const log = path.join(aside, 'started.log');
    const started = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
    const names = (results) => Object.fromEntries(results.map((r) => [r.name, r.result]));

    put(cwd, '.kiro/specs/demo/requirements.md', '# Demo\n');
    put(cwd, 'tools/fake-runner.cjs', FAKE_RUNNER);
    put(
      cwd,
      '.kiro/specs/demo/runners.json',
      JSON.stringify({
        '*_contract.fake': `"${process.execPath}" "${path.join(cwd, 'tools/fake-runner.cjs')}" {file} {report} ${log}`,
        frozen: ['plug/*.txt'],
      }) + '\n',
    );
    put(cwd, 'contracts/demo/a_contract.fake', 'pass R1.1 right\n');
    put(cwd, 'contracts/demo/b_contract.fake', 'pass R1.2 also right\n');
    put(cwd, 'plug/one.txt', 'one\n');
    put(cwd, 'plug/two.txt', 'two\n');
    freezeSpec(cwd, 'demo');
    const { receipt } = runCheck(cwd, 'demo');

    // Nothing moved: the contracts pass and the receipt is confirmed.
    assert.deepEqual(names(runContracts(cwd, 'demo', readLock(cwd))), { 'R1.1 right': 'pass', 'R1.2 also right': 'pass' });
    assert.equal(printed(() => verify(cwd, receipt)).code, 0);

    // A new file that no frozen glob matches changes nothing.
    put(cwd, 'other/free.txt', 'unrelated\n');
    put(cwd, 'plug/deeper/free.txt', 'one folder deeper than the glob\n');
    put(cwd, 'plug/free.md', 'another extension\n');
    assert.deepEqual(names(runContracts(cwd, 'demo', readLock(cwd))), { 'R1.1 right': 'pass', 'R1.2 also right': 'pass' });
    const unrelated = printed(() => verify(cwd, receipt));
    assert.equal(unrelated.code, 0, unrelated.out);
    assert.match(unrelated.out, /CONFIRMED/);

    // A new file that matches the glob: every runner file fails with a reason that names it, and the framework never starts.
    put(cwd, 'plug/conftest.txt', 'planted\n');
    const before = started();
    const added = runContracts(cwd, 'demo', readLock(cwd));
    assert.deepEqual(names(added), { 'R1.1 right': 'fail', 'R1.2 also right': 'fail' });
    for (const r of added) assert.match(r.reason, /plug\/conftest\.txt/);
    assert.equal(started(), before, 'the fake framework did not start');
    const addedVerify = printed(() => verify(cwd, receipt));
    assert.equal(addedVerify.code, 1);
    assert.match(addedVerify.out, /MISMATCH/);
    assert.match(addedVerify.out, /plug\/conftest\.txt/);

    // With the new file gone, all is well again.
    fs.rmSync(path.join(cwd, 'plug/conftest.txt'));
    assert.deepEqual(names(runContracts(cwd, 'demo', readLock(cwd))), { 'R1.1 right': 'pass', 'R1.2 also right': 'pass' });
    assert.equal(printed(() => verify(cwd, receipt)).code, 0);

    // A locked file that is removed: every runner file fails, and verify names the file.
    fs.rmSync(path.join(cwd, 'plug/two.txt'));
    const removed = runContracts(cwd, 'demo', readLock(cwd));
    assert.deepEqual(names(removed), { 'R1.1 right': 'fail', 'R1.2 also right': 'fail' });
    for (const r of removed) assert.match(r.reason, /plug\/two\.txt/);
    const removedVerify = printed(() => verify(cwd, receipt));
    assert.equal(removedVerify.code, 1);
    assert.match(removedVerify.out, /MISMATCH/);
    assert.match(removedVerify.out, /plug\/two\.txt/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(aside, { recursive: true, force: true });
  }
});
