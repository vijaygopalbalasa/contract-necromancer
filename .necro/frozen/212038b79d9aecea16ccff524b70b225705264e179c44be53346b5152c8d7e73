// Contract for Requirement 13.11 of the necro-core spec: a contract and the command that runs it never receive the
// variables that redirect an interpreter or test framework to other code (PYTHONPATH, PYTHONHOME, PYTHONSTARTUP,
// PYTHONUSERBASE, PYTEST_ADDOPTS, PYTEST_PLUGINS, NODE_OPTIONS, NODE_PATH), and the same holds for JavaScript contract
// files.
//
// The test sets every one of those variables in this process, with NODE_OPTIONS naming a file that marks every check
// passing (it turns assert.equal, assert.ok and assert.strictEqual into no-ops, and makes a fake test framework exit 0
// with a report that says everything passed). It then runs the frozen contracts of a throwaway project through the
// tool: a fake framework written in Node and carried in this file, and a JavaScript contract file. Each holds one
// contract that is right and one that is wrong. The right ones pass, the wrong ones still fail, the file named in
// NODE_OPTIONS never ran, and each process wrote down that it saw none of the eight variables.
//
// This file carries its own helpers, so it does not depend on any file that is not frozen.
//
// The receipt pins the files this test exercises. Keep these lines, necro reads `from '...'` text:
//   from '../../src/runners.js'
//   from '../../src/contracts.js'
//   from '../../src/lock.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runContracts } from '../../src/contracts.js';
import { freezeSpec, readLock } from '../../src/lock.js';

const REDIRECTS = ['PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'PYTHONUSERBASE', 'PYTEST_ADDOPTS', 'PYTEST_PLUGINS', 'NODE_OPTIONS', 'NODE_PATH'];

// A fake test framework. It reads a contract file with one line per testcase ("pass <name>" or "fail <name>"), writes
// down which of the eight variables it can see, and writes a JUnit XML report to the path it is given.
const FAKE_RUNNER = `'use strict';
const fs = require('node:fs');
const [file, report, seen] = process.argv.slice(2);
const names = ${JSON.stringify(REDIRECTS)};
fs.writeFileSync(seen, JSON.stringify(Object.fromEntries(names.map((n) => [n, process.env[n] ?? null]))));
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

// The file NODE_OPTIONS names. If it runs in any process, it writes a line to `mark` and turns checks into no-ops.
// In the fake framework it also rewrites the report so that the wrong contract passes, and exits 0.
function leakPreload(dir, mark) {
  const file = path.join(dir, 'leak.cjs');
  fs.writeFileSync(
    file,
    `const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(mark)}, 'loaded\\n');
const a = require('node:assert/strict');
a.equal = () => {};
a.strictEqual = () => {};
a.ok = () => {};
process.on('exit', () => {
  const [contract, report] = process.argv.slice(2);
  if (contract && /_contract\\.fake$/.test(contract) && report) {
    fs.writeFileSync(report, '<testsuite><testcase name="R1.2 wrong"/></testsuite>');
    process.exitCode = 0;
  }
});
`,
  );
  return file;
}

// Run fn with all eight variables set in this process, then put the old values back.
function withLeakedEnv(preload, fn) {
  const saved = Object.fromEntries(REDIRECTS.map((name) => [name, process.env[name]]));
  for (const name of REDIRECTS) process.env[name] = `leak-${name}`;
  process.env.NODE_OPTIONS = `--require ${preload}`;
  try {
    return fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('R13.11 none of PYTHONPATH, PYTHONHOME, PYTHONSTARTUP, PYTHONUSERBASE, PYTEST_ADDOPTS, PYTEST_PLUGINS, NODE_OPTIONS and NODE_PATH set in the parent reaches a runner command or a JavaScript contract file, and a wrong implementation still fails', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-clean-env-'));
  const aside = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-clean-env-aside-'));
  try {
    const mark = path.join(aside, 'mark');
    const seenByCommand = path.join(aside, 'command.json');
    const seenByContract = path.join(aside, 'contract.json');
    const preload = leakPreload(aside, mark);
    const none = Object.fromEntries(REDIRECTS.map((name) => [name, null]));

    put(cwd, '.kiro/specs/demo/requirements.md', '# Demo\n');
    put(cwd, 'tools/fake-runner.cjs', FAKE_RUNNER);
    put(
      cwd,
      '.kiro/specs/demo/runners.json',
      JSON.stringify({ '*_contract.fake': `"${process.execPath}" "${path.join(cwd, 'tools/fake-runner.cjs')}" {file} {report} ${seenByCommand}` }) + '\n',
    );
    put(cwd, 'contracts/demo/a_contract.fake', 'pass R1.1 right\nfail R1.2 wrong\n');
    put(
      cwd,
      'contracts/demo/js.contract.test.js',
      `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('R2.1 right', () => {
  fs.writeFileSync(${JSON.stringify(seenByContract)}, JSON.stringify(Object.fromEntries(${JSON.stringify(REDIRECTS)}.map((n) => [n, process.env[n] ?? null]))));
  assert.equal(1, 1);
});
test('R2.2 wrong', () => {
  assert.equal(1, 2);
});
`,
    );

    // Freeze with a clean environment, then run the frozen contracts with all eight variables set.
    freezeSpec(cwd, 'demo');
    fs.rmSync(seenByCommand, { force: true });
    fs.rmSync(seenByContract, { force: true });
    fs.rmSync(mark, { force: true });
    const results = withLeakedEnv(preload, () => runContracts(cwd, 'demo', readLock(cwd)));

    const byName = Object.fromEntries(results.map((r) => [r.name, r.result]));
    assert.deepEqual(byName, { 'R1.1 right': 'pass', 'R1.2 wrong': 'fail', 'R2.1 right': 'pass', 'R2.2 wrong': 'fail' });
    assert.deepEqual(JSON.parse(fs.readFileSync(seenByCommand, 'utf8')), none, 'the runner command saw none of the variables');
    assert.deepEqual(JSON.parse(fs.readFileSync(seenByContract, 'utf8')), none, 'the contract file saw none of the variables');
    assert.ok(!fs.existsSync(mark), 'the file named in NODE_OPTIONS ran in neither process');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(aside, { recursive: true, force: true });
  }
});
