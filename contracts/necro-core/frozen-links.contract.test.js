// Contract for Requirement 13.13 of the necro-core spec: when the "frozen" globs of the locked runners.json are
// expanded again, a symbolic link whose path matches a glob counts as a matching file that was not locked at the
// freeze, whatever it points to. So a link to a file, a link to a folder and a dangling link each make every runner
// file of the spec fail, and `necro verify` print MISMATCH naming the link.
//
// The test builds a throwaway project with two runner files for a fake test framework written in Node and carried in
// this file, and a "frozen" glob that matches two files. It freezes the project and checks, in this order:
//   - nothing moved: both contracts pass and verify says CONFIRMED;
//   - a link outside every glob (to a file, and dangling): nothing changes;
//   - for each of a link to a file, a link to a folder and a dangling link, placed where the glob matches: both runner
//     files fail with a reason that names the link, the fake framework is never started, verify prints MISMATCH naming
//     the link, and with the link removed all is well again;
//   - a locked file replaced by a link to a copy with the same bytes: both runner files fail and verify prints MISMATCH.
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

test('R13.13 a symbolic link under a frozen glob, to a file, to a folder or dangling, counts as an added file: every runner file fails and verify prints MISMATCH naming the link, while a link outside every glob changes nothing', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-frozen-links-'));
  const aside = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-frozen-links-aside-'));
  try {
    const log = path.join(aside, 'started.log');
    const started = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
    const names = (results) => Object.fromEntries(results.map((r) => [r.name, r.result]));
    const PASS = { 'R1.1 right': 'pass', 'R1.2 also right': 'pass' };
    const FAIL = { 'R1.1 right': 'fail', 'R1.2 also right': 'fail' };

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
    put(cwd, 'elsewhere/target.txt', 'a file outside the glob\n');
    fs.mkdirSync(path.join(cwd, 'elsewhere/folder'), { recursive: true });
    freezeSpec(cwd, 'demo');
    const { receipt } = runCheck(cwd, 'demo');

    // Nothing moved: the contracts pass and the receipt is confirmed.
    assert.deepEqual(names(runContracts(cwd, 'demo', readLock(cwd))), PASS);
    assert.equal(printed(() => verify(cwd, receipt)).code, 0);

    // Links that no frozen glob matches change nothing.
    fs.symlinkSync(path.join(cwd, 'elsewhere/target.txt'), path.join(cwd, 'elsewhere/link.txt'));
    fs.symlinkSync(path.join(cwd, 'elsewhere/nothing'), path.join(cwd, 'elsewhere/dangling.txt'));
    fs.symlinkSync(path.join(cwd, 'elsewhere/target.txt'), path.join(cwd, 'plug/link.md'));
    assert.deepEqual(names(runContracts(cwd, 'demo', readLock(cwd))), PASS);
    const unrelated = printed(() => verify(cwd, receipt));
    assert.equal(unrelated.code, 0, unrelated.out);
    assert.match(unrelated.out, /CONFIRMED/);

    // A link where the glob matches, of each kind: every runner file fails with a reason naming it, and the framework
    // never starts. Verify prints MISMATCH naming it. With the link removed, all is well again.
    const kinds = [
      ['plug/to-file.txt', path.join(cwd, 'elsewhere/target.txt')],
      ['plug/to-folder.txt', path.join(cwd, 'elsewhere/folder')],
      ['plug/dangling.txt', path.join(cwd, 'elsewhere/does-not-exist')],
    ];
    for (const [rel, target] of kinds) {
      fs.symlinkSync(target, path.join(cwd, rel));
      const before = started();
      const results = runContracts(cwd, 'demo', readLock(cwd));
      assert.deepEqual(names(results), FAIL, rel);
      for (const r of results) assert.ok(r.reason.includes(rel), `${rel}: ${r.reason}`);
      assert.equal(started(), before, `${rel}: the fake framework did not start`);
      const out = printed(() => verify(cwd, receipt));
      assert.equal(out.code, 1, rel);
      assert.match(out.out, /MISMATCH/);
      assert.ok(out.out.includes(rel), `${rel}: ${out.out}`);
      fs.rmSync(path.join(cwd, rel));
      assert.deepEqual(names(runContracts(cwd, 'demo', readLock(cwd))), PASS, `${rel} removed`);
      assert.equal(printed(() => verify(cwd, receipt)).code, 0, `${rel} removed`);
    }

    // A locked file replaced by a link to a copy with the same bytes is still caught.
    put(cwd, 'elsewhere/copy.txt', 'one\n');
    fs.rmSync(path.join(cwd, 'plug/one.txt'));
    fs.symlinkSync(path.join(cwd, 'elsewhere/copy.txt'), path.join(cwd, 'plug/one.txt'));
    const swapped = runContracts(cwd, 'demo', readLock(cwd));
    assert.deepEqual(names(swapped), FAIL);
    for (const r of swapped) assert.match(r.reason, /plug\/one\.txt/);
    const swappedVerify = printed(() => verify(cwd, receipt));
    assert.equal(swappedVerify.code, 1);
    assert.match(swappedVerify.out, /MISMATCH/);
    assert.match(swappedVerify.out, /plug\/one\.txt/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(aside, { recursive: true, force: true });
  }
});
