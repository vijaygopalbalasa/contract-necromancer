import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as lock from '../src/lock.js';
import * as runners from '../src/runners.js';

// Requirement 16: adopting the tool in your own project. These tests run the real command line in throwaway projects.

const REPO = path.resolve(import.meta.dirname, '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function necro(cwd, args, { input, env, bin = BIN } = {}) {
  const res = spawnSync(process.execPath, [bin, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv(env), timeout: 120_000 });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', both: `${res.stdout || ''}${res.stderr || ''}` };
}

function tmp(prefix = 'necro-adopt-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function withProject(fn) {
  const cwd = tmp();
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

const REQ = `# Requirements: demo

## Introduction
A demo.

## Requirement 1: Slugs
**User story:** As a user, I want slugs.
### Acceptance criteria
1. WHEN text is given THE SYSTEM SHALL lowercase it.
2. WHEN text has spaces THE SYSTEM SHALL replace them with dashes.

## Requirement 2: Empty input
#### Acceptance Criteria
1. WHEN the text is empty THE SYSTEM SHALL return an empty string.
`;

const HEAD = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n`;
const TASKS_REL = '.kiro/specs/demo/tasks.md';
const lockOf = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8'));
const hasLock = (cwd) => fs.existsSync(path.join(cwd, '.necro', 'lock.json'));

// ---------------------------------------------------------------------------
// 16.1 Freeze says what it froze and what is missing
// ---------------------------------------------------------------------------

test('16.1 requirementCriteria reads the numbered acceptance criteria of each requirement', () => {
  assert.deepEqual(lock.requirementCriteria(REQ), ['R1.1', 'R1.2', 'R2.1']);
  // Kiro's own layout: "### Requirement 3", a bold story, "#### Acceptance Criteria", then a numbered list.
  const kiro = '### Requirement 3\n\n**User Story:** As a dev, I want x.\n\n#### Acceptance Criteria\n\n1. WHEN a THEN b\n2. WHEN c THEN d\n';
  assert.deepEqual(lock.requirementCriteria(kiro), ['R3.1', 'R3.2']);
  // A numbered list outside the acceptance criteria is not a criterion.
  assert.deepEqual(lock.requirementCriteria('## Requirement 1\n1. A note\n### Acceptance criteria\n1. WHEN a THEN b\n'), ['R1.1']);
  assert.deepEqual(lock.requirementCriteria('# Nothing numbered here\n'), []);
});

test('16.1 criterionOfName takes an ID only at the start of a name, followed by a space or the end', () => {
  assert.equal(lock.criterionOfName('R1.1 rounds down'), 'R1.1');
  assert.equal(lock.criterionOfName('R12.30'), 'R12.30');
  assert.equal(lock.criterionOfName('R1.1x'), null);
  assert.equal(lock.criterionOfName('handles R1.1'), null);
  assert.equal(lock.criterionOfName('test_R1_1_rounds'), null);
});

test('16.1 freeze prints each contract file with its criterion IDs and warns about criteria without a contract and names without an ID', () =>
  withProject((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', REQ);
    put(
      cwd,
      'contracts/demo/slug.contract.test.js',
      `${HEAD}test('R1.1 lowercases', () => { assert.ok(true); });\ntest('R1.2 dashes', () => { assert.ok(true); });\ntest('helper works', () => { assert.ok(true); });\n`,
    );
    put(cwd, 'contracts/demo/other.contract.test.js', `${HEAD}test('R1.1 again', () => { assert.ok(true); });\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 0, res.both);
    const lines = res.both.split('\n');
    const slug = lines.find((l) => l.includes('contracts/demo/slug.contract.test.js') && !/warning/i.test(l));
    assert.ok(slug, `a line for the file: ${res.both}`);
    assert.match(slug, /R1\.1, R1\.2/);
    const other = lines.find((l) => l.includes('contracts/demo/other.contract.test.js') && !/warning/i.test(l));
    assert.match(other, /R1\.1/);
    assert.doesNotMatch(other, /R1\.2/);
    // R2.1 has no contract.
    const uncovered = lines.filter((l) => /warning/i.test(l) && /R2\.1/.test(l));
    assert.equal(uncovered.length, 1, res.both);
    assert.match(uncovered[0], /no contract/i);
    // R1.1 and R1.2 are covered and are not named in a warning about missing contracts.
    assert.equal(lines.filter((l) => /warning/i.test(l) && /no contract/i.test(l)).length, 1, res.both);
    // The contract that starts with no ID is named.
    const unnamed = lines.filter((l) => /warning/i.test(l) && l.includes('helper works'));
    assert.equal(unnamed.length, 1, res.both);
    assert.match(unnamed[0], /criterion ID/i);
    assert.equal(lines.filter((l) => /warning/i.test(l)).length, 2, res.both);
  }));

test('16.1 freeze prints no warning when every criterion has a contract and every name starts with an ID', () =>
  withProject((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', REQ);
    put(
      cwd,
      'contracts/demo/all.contract.test.js',
      `${HEAD}test('R1.1 a', () => {});\ntest('R1.2 b', () => {});\ntest('R2.1 c', () => {});\n`,
    );
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 0, res.both);
    assert.doesNotMatch(res.both, /warning/i);
    assert.match(res.both, /R1\.1, R1\.2, R2\.1/);
  }));

test('16.1 a requirements.md with no numbered criteria gets one warning instead of silence', () =>
  withProject((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements\nJust prose.\n');
    put(cwd, 'contracts/demo/a.contract.test.js', `${HEAD}test('R1.1 a', () => {});\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 0, res.both);
    assert.match(res.both, /warning/i);
    assert.match(res.both, /no numbered acceptance criteria/i);
  }));

// ---------------------------------------------------------------------------
// 16.2 Refuse to freeze a file that does not load or has no test
// ---------------------------------------------------------------------------

test('16.2 an ES module contract in a CommonJS project is refused at freeze with the file and the error', () =>
  withProject((cwd) => {
    put(cwd, 'package.json', JSON.stringify({ name: 'proj', type: 'commonjs' }));
    put(cwd, '.kiro/specs/demo/requirements.md', REQ);
    put(cwd, 'contracts/demo/esm.contract.test.js', `${HEAD}test('R1.1 a', () => { assert.ok(true); });\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 1, res.both);
    assert.ok(res.stderr.includes('contracts/demo/esm.contract.test.js'), res.both);
    assert.match(res.stderr, /SyntaxError: Cannot use import statement outside a module/);
    assert.match(res.stderr, /load/i);
    assert.equal(hasLock(cwd), false, 'nothing is frozen');
    assert.equal(fs.existsSync(path.join(cwd, '.necro', 'frozen')), false, 'no copy is stored');
    assert.doesNotMatch(res.both, /Spec 'demo' frozen\./);
  }));

test('16.2 a file that throws while loading is refused with the first lines of the error', () =>
  withProject((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', REQ);
    put(cwd, 'contracts/demo/boom.contract.test.js', `${HEAD}test('R1.1 a', () => {});\nthrow new Error('top-level boom');\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 1, res.both);
    assert.ok(res.stderr.includes('contracts/demo/boom.contract.test.js'), res.both);
    assert.match(res.stderr, /top-level boom/);
    assert.equal(hasLock(cwd), false);
  }));

test('16.2 a file that loads and defines no test is frozen with a warning that names it (frozen contract R4.8 needs such a freeze to succeed)', () =>
  withProject((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', REQ);
    put(cwd, 'contracts/demo/good.contract.test.js', `${HEAD}test('R1.1 a', () => {});\n`);
    put(cwd, 'contracts/demo/empty.contract.test.js', `${HEAD}// no tests\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 0, res.both);
    const warnings = res.both.split('\n').filter((l) => /warning/i.test(l) && l.includes('empty.contract.test.js'));
    assert.equal(warnings.length, 1, res.both);
    assert.match(warnings[0], /defines no test/);
    assert.doesNotMatch(res.both, /does not start with a criterion ID/, 'the stand-in contract is not also reported as an unnamed one');
  }));

test('16.2 a refused re-freeze leaves the earlier lock as it was', () =>
  withProject((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', REQ);
    put(cwd, 'contracts/demo/good.contract.test.js', `${HEAD}test('R1.1 a', () => {});\n`);
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    const before = fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8');
    put(cwd, 'contracts/demo/boom.contract.test.js', `${HEAD}throw new Error('boom');\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 1, res.both);
    assert.equal(fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8'), before);
  }));

test('16.2 a file that loads and has a failing test still freezes', () =>
  withProject((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', REQ);
    put(cwd, 'contracts/demo/red.contract.test.js', `${HEAD}test('R1.1 not yet', () => { assert.fail('not built yet'); });\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 0, res.both);
    assert.deepEqual(lockOf(cwd).specs.demo.contracts[0].names, ['R1.1 not yet']);
  }));

// ---------------------------------------------------------------------------
// A fake test framework for 16.3 to 16.5. It reads a contract file with one line per testcase ("pass <name>" or
// "fail <name>") and writes a JUnit XML report. A third argument names a file that can change how it behaves:
//   missing   print the error python prints when pytest is not installed, and exit 1 (no report)
//   noise     print twelve lines on stderr, and exit 3 (no report)
// ---------------------------------------------------------------------------

const FAKE_RUNNER = `'use strict';
const fs = require('node:fs');
const [file, report, flag] = process.argv.slice(2);
const mode = flag && fs.existsSync(flag) ? fs.readFileSync(flag, 'utf8').trim() : '';
if (mode === 'missing') {
  process.stderr.write('/usr/bin/python3: No module named pytest\\n');
  process.exit(1);
}
if (mode === 'noise') {
  for (let i = 1; i <= 12; i++) process.stderr.write('err-' + String(i).padStart(2, '0') + '\\n');
  process.exit(3);
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let cases = '';
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  if (line.trim() === '') continue;
  const space = line.indexOf(' ');
  const kind = line.slice(0, space);
  const name = esc(line.slice(space + 1));
  cases += kind === 'pass' ? '<testcase name="' + name + '"/>' : '<testcase name="' + name + '"><failure message="failed">x</failure></testcase>';
}
fs.writeFileSync(report, '<?xml version="1.0"?><testsuites><testsuite name="fake">' + cases + '</testsuite></testsuites>');
`;

function fakeProject(cwd, files, { tasks, flag = 'flag.txt' } = {}) {
  put(cwd, '.kiro/specs/demo/requirements.md', REQ);
  put(cwd, 'tools/fake-runner.cjs', FAKE_RUNNER);
  put(
    cwd,
    '.kiro/specs/demo/runners.json',
    JSON.stringify({ '*_contract.fake': `"${process.execPath}" "${path.join(cwd, 'tools/fake-runner.cjs')}" {file} {report} "${path.join(cwd, flag)}"` }) + '\n',
  );
  for (const [name, text] of Object.entries(files)) put(cwd, `contracts/demo/${name}`, text);
  if (tasks) put(cwd, TASKS_REL, tasks);
  return path.join(cwd, flag);
}

const tickPayload = (cwd, oldStr, newStr) =>
  JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', cwd, tool_name: 'str_replace', tool_input: { path: TASKS_REL, oldStr, newStr } });

// ---------------------------------------------------------------------------
// 16.3 A recorded contract with no result says the lock may be stale
// ---------------------------------------------------------------------------

test('16.3 a recorded contract that a run no longer reports is failing with a note that the lock may be stale, in check and in the gate', () =>
  withProject((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', REQ);
    put(
      cwd,
      'contracts/demo/dyn.contract.test.js',
      `${HEAD}import fs from 'node:fs';\ntest('R1.1 always', () => {});\nif (fs.existsSync(new URL('./extra.flag', import.meta.url))) test('R1.2 extra', () => {});\n`,
    );
    put(cwd, 'contracts/demo/extra.flag', 'on\n');
    put(cwd, TASKS_REL, '- [ ] 1. First (Req 1.1, 1.2)\n- [ ] 2. Second (Req 1.1)\n');
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    assert.deepEqual(lockOf(cwd).specs.demo.contracts[0].names, ['R1.1 always', 'R1.2 extra']);
    fs.rmSync(path.join(cwd, 'contracts/demo/extra.flag'));

    const check = necro(cwd, ['check', 'demo']);
    assert.equal(check.status, 1, check.both);
    assert.match(check.stdout, /fail R1\.2 extra/);
    assert.match(check.stdout, /lock may be stale/i);
    assert.match(check.stdout, /freeze the spec again/i);

    const gate = necro(cwd, ['hook', 'pre'], { input: tickPayload(cwd, '- [ ] 1.', '- [x] 1.') });
    assert.equal(gate.status, 2, gate.both);
    assert.match(gate.stderr, /Contracts failed: R1\.2 extra\./);
    assert.match(gate.stderr, /lock may be stale/i);
    assert.match(gate.stderr, /freeze the spec again/i);
  }));

test('16.3 a plain failing contract does not carry the stale note', () =>
  withProject((cwd) => {
    put(cwd, '.kiro/specs/demo/requirements.md', REQ);
    put(cwd, 'contracts/demo/red.contract.test.js', `${HEAD}test('R1.1 red', () => { assert.fail('no'); });\n`);
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    const check = necro(cwd, ['check', 'demo']);
    assert.equal(check.status, 1);
    assert.doesNotMatch(check.both, /stale/i);
  }));

// ---------------------------------------------------------------------------
// 16.4 A runner that fails says why; a runner that cannot run says so
// ---------------------------------------------------------------------------

test('16.4 a runner command that fails puts the last lines of its standard error in the reason', () =>
  withProject((cwd) => {
    const flag = fakeProject(cwd, { 'a_contract.fake': 'pass R1.1 right\n' });
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    fs.writeFileSync(flag, 'noise');
    const check = necro(cwd, ['check', 'demo']);
    assert.equal(check.status, 1, check.both);
    assert.match(check.stdout, /exited with status 3/);
    assert.match(check.stdout, /err-12/);
    assert.match(check.stdout, /err-08/);
    assert.doesNotMatch(check.stdout, /err-01/);
    // A run that failed for its own reasons is a failure of the work, not a missing tool.
    assert.doesNotMatch(check.stdout, /cannot run here/i);
  }));

test('16.4 a missing module is reported as contracts that cannot run here, in check and in audit, and both still exit non-zero', () =>
  withProject((cwd) => {
    const flag = fakeProject(cwd, { 'a_contract.fake': 'pass R1.1 right\n' }, { tasks: '- [x] 1. First (Req 1.1)\n- [ ] 2. Second (Req 1.2)\n' });
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    fs.writeFileSync(flag, 'missing');

    const check = necro(cwd, ['check', 'demo']);
    assert.equal(check.status, 1, check.both);
    assert.match(check.stdout, /cannot run here/i);
    assert.match(check.stdout, /pytest/);
    assert.doesNotMatch(check.stdout, /Fix the code/);
    assert.doesNotMatch(check.stdout, /contracts failed/i);

    const audit = necro(cwd, ['audit']);
    assert.equal(audit.status, 1, audit.both);
    assert.match(audit.stdout, /cannot run here/i);
    assert.match(audit.stdout, /pytest/);
    assert.doesNotMatch(audit.stdout, /failing/);
  }));

test('16.4 freezing while the framework is missing still freezes, with a warning that the contracts cannot run here', () =>
  withProject((cwd) => {
    const flag = fakeProject(cwd, { 'a_contract.fake': 'pass R1.1 right\n' });
    fs.writeFileSync(flag, 'missing');
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 0, res.both);
    const warning = res.both.split('\n').find((l) => /warning/i.test(l) && l.includes('a_contract.fake'));
    assert.ok(warning, res.both);
    assert.match(warning, /cannot run here/i);
    assert.match(warning, /pytest/);
  }));

test('16.4 the Stop hook unticks a task whose contracts cannot run here and says so, and leaves a task that was ticked at the freeze alone', () =>
  withProject((cwd) => {
    const flag = fakeProject(cwd, { 'a_contract.fake': 'pass R1.1 right\npass R1.2 also right\n' }, { tasks: '- [x] 1. First (Req 1.1)\n- [ ] 2. Second (Req 1.2)\n' });
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    // Task 2 is ticked behind the gate's back, then the framework goes missing.
    put(cwd, TASKS_REL, '- [x] 1. First (Req 1.1)\n- [x] 2. Second (Req 1.2)\n');
    fs.writeFileSync(flag, 'missing');
    const res = necro(cwd, ['hook', 'stop'], { input: '' });
    assert.equal(res.status, 0, res.both);
    assert.match(res.stderr, /Unticked "2\. Second \(Req 1\.2\)"/);
    assert.match(res.stderr, /cannot run here/);
    assert.match(res.stderr, /pytest/);
    assert.equal(fs.readFileSync(path.join(cwd, TASKS_REL), 'utf8'), '- [x] 1. First (Req 1.1)\n- [ ] 2. Second (Req 1.2)\n');
  }));

test('16.4 a program that cannot start is reported as one that cannot run here, naming the program', () =>
  withProject((cwd) => {
    put(cwd, 'c_contract.fake', 'pass R1.1 x\n');
    const res = runners.runReport(cwd, path.join(cwd, 'c_contract.fake'), 'no-such-program-xyz {file} {report}', process.env);
    assert.equal(res.cases, undefined);
    assert.match(res.reason, /could not start/);
    assert.match(res.cannotRun, /no-such-program-xyz/);
  }));

test('16.4 a work failure that happens to mention a module is not called a missing tool when the report shows failing tests', () =>
  withProject((cwd) => {
    fakeProject(cwd, { 'a_contract.fake': 'fail R1.1 wrong\n' });
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    const check = necro(cwd, ['check', 'demo']);
    assert.equal(check.status, 1);
    assert.match(check.stdout, /Fix the code/);
    assert.doesNotMatch(check.stdout, /cannot run here/i);
  }));

// ---------------------------------------------------------------------------
// 16.5 Criterion IDs written the way test frameworks allow
// ---------------------------------------------------------------------------

test('16.5 mapCaseName maps underscores and parametrize ids to the criterion, and leaves other names alone', () => {
  assert.equal(runners.mapCaseName('R1_1'), 'R1.1 R1_1');
  assert.equal(runners.mapCaseName('test_R1_1_rounds'), 'R1.1 test_R1_1_rounds');
  assert.equal(runners.mapCaseName('test_x[R1.1 rounds down]'), 'R1.1 test_x[R1.1 rounds down]');
  assert.equal(runners.mapCaseName('test_x[R12.30]'), 'R12.30 test_x[R12.30]');
  assert.equal(runners.mapCaseName('test_R12_30_big'), 'R12.30 test_R12_30_big');
  assert.equal(runners.mapCaseName('R1.1 already right'), 'R1.1 already right');
  assert.equal(runners.mapCaseName('R2.3'), 'R2.3');
  assert.equal(runners.mapCaseName('test_plain'), 'test_plain');
  assert.equal(runners.mapCaseName('test_R1_1x'), 'test_R1_1x');
  assert.equal(runners.mapCaseName('testR1_1_glued'), 'testR1_1_glued');
});

test('16.5 a runner report with underscore and parametrize IDs gives contracts that start R1.1, and the gate requires them by criterion', () =>
  withProject((cwd) => {
    fakeProject(
      cwd,
      { 'a_contract.fake': 'pass R1_1\nfail test_R1_2_dashes\npass test_x[R2.1 empty]\npass test_plain\n' },
      { tasks: '- [ ] 1. First (Req 1.1)\n- [ ] 2. Second (Req 1.2)\n- [ ] 3. Third (Req 2.1)\n' },
    );
    const frozen = necro(cwd, ['freeze', 'demo']);
    assert.equal(frozen.status, 0, frozen.both);
    assert.deepEqual(lockOf(cwd).specs.demo.contracts[0].names.sort(), [
      'R1.1 R1_1',
      'R1.2 test_R1_2_dashes',
      'R2.1 test_x[R2.1 empty]',
      'test_plain',
    ]);
    // The freeze report counts them as covering R1.1, R1.2 and R2.1.
    assert.match(frozen.both, /R1\.1, R1\.2, R2\.1/);
    assert.doesNotMatch(frozen.both, /no contract covers/i);

    // Task 1 needs R1.1 only, which passes; task 2 needs R1.2, which fails.
    const ok = necro(cwd, ['hook', 'pre'], { input: tickPayload(cwd, '- [ ] 1.', '- [x] 1.') });
    assert.equal(ok.status, 0, ok.both);
    const refused = necro(cwd, ['hook', 'pre'], { input: tickPayload(cwd, '- [ ] 2.', '- [x] 2.') });
    assert.equal(refused.status, 2, refused.both);
    assert.match(refused.stderr, /R1\.2 test_R1_2_dashes/);
  }));

// ---------------------------------------------------------------------------
// 16.6 help, and init from an npx cache
// ---------------------------------------------------------------------------

test('16.6 necro help, --help and -h print every command with one line on what it does, and exit 0', () =>
  withProject((cwd) => {
    const outputs = ['help', '--help', '-h'].map((flag) => {
      const res = necro(cwd, [flag]);
      assert.equal(res.status, 0, `${flag}: ${res.both}`);
      return res.stdout;
    });
    assert.equal(outputs[1], outputs[0]);
    assert.equal(outputs[2], outputs[0]);
    for (const command of ['init', 'freeze', 'check', 'audit', 'verify', 'mcp', 'demo', 'help']) {
      const line = outputs[0].split('\n').find((l) => new RegExp(`^\\s+necro ${command}\\b`).test(l));
      assert.ok(line, `a line for ${command}:\n${outputs[0]}`);
      assert.ok(line.replace(/^\s+necro \S+(\s+<[^>]+>|\s+\[[^\]]+\])*\s*/, '').length >= 20, `a description for ${command}: ${line}`);
    }
  }));

test('16.6 necro with no command still exits 1 and shows the commands', () =>
  withProject((cwd) => {
    const res = necro(cwd, []);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /necro freeze/);
  }));

function installCopy(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of ['bin', 'src', 'templates', 'package.json']) fs.cpSync(path.join(REPO, entry), path.join(dest, entry), { recursive: true });
  return path.join(dest, 'bin', 'necro.js');
}

test('16.6 init run from an npx cache warns that the hook paths point into a cache and shows how to install permanently', () => {
  const root = tmp('necro-npx-');
  const project = tmp('necro-npx-project-');
  try {
    const bin = installCopy(path.join(root, '.npm', '_npx', 'abc123', 'node_modules', 'contract-necromancer'));
    const res = necro(project, ['init'], { bin });
    assert.equal(res.status, 0, res.both);
    assert.match(res.both, /npx cache/i);
    assert.match(res.both, /npm install -g github:vijaygopalbalasa\/contract-necromancer/);
    assert.match(res.both, /necro init/);
    assert.ok(fs.existsSync(path.join(project, '.kiro', 'hooks', 'necromancer.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('16.6 init run from a permanent install prints no cache warning', () => {
  const root = tmp('necro-perm-');
  const project = tmp('necro-perm-project-');
  try {
    const bin = installCopy(path.join(root, 'lib', 'node_modules', 'contract-necromancer'));
    const res = necro(project, ['init'], { bin });
    assert.equal(res.status, 0, res.both);
    assert.doesNotMatch(res.both, /npx cache/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 16.7 Published files, and the README opening
// ---------------------------------------------------------------------------

test('16.7 package.json lists its files, and npm pack prints no .gitignore fallback warning', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, 'package.json has a files list');
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: REPO, encoding: 'utf8', env: cleanEnv() });
  assert.equal(packed.status, 0, packed.stderr);
  assert.doesNotMatch(packed.stderr, /gitignore/i);
  const listed = new Set(JSON.parse(packed.stdout)[0].files.map((f) => f.path));
  for (const rel of [
    'package.json',
    'README.md',
    'bin/necro.js',
    'src/hooks.js',
    'src/lock.js',
    'src/runners.js',
    'src/mcp.js',
    'templates/necromancer.hooks.json',
    'templates/necromancer.steering.md',
    'templates/necromancer.agent.json',
    'power/plugin.json',
    'power/mcp.json',
    'examples/pumpkin-ledger/package.json',
    'examples/pumpkin-ledger/.necro/lock.json',
    'examples/pumpkin-ledger/.kiro/specs/ledger/tasks.md',
  ]) {
    assert.ok(listed.has(rel), `npm pack leaves out ${rel}`);
  }
  for (const rel of listed) {
    assert.ok(!/^(test|site|case-studies|experiments|tools)\//.test(rel), `npm pack should not publish ${rel}`);
    assert.ok(!/^(\.kiro|\.necro|\.github|contracts)\//.test(rel), `npm pack should not publish ${rel}`);
  }
});

test('16.7 the README opens with a short "Use it in your project" section: five commands and a minimal contract for Node.js and for Python', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  const headings = [...readme.matchAll(/^## (.+)$/gm)];
  assert.equal(headings[0][1], 'Use it in your project', 'it is the first section');
  assert.equal(headings.filter((h) => h[1] === 'Use it in your project').length, 1, 'the heading appears once');
  const start = headings[0].index;
  const section = readme.slice(start, headings[1].index);
  assert.ok(section.split('\n').length <= 90, 'it stays short');
  for (const command of ['necro init', 'necro freeze <spec>', 'necro check <spec>', 'necro audit', 'necro verify <receipt>']) {
    assert.ok(section.includes(command), `the section shows ${command}`);
  }
  const blocks = [...section.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], body: m[2] }));
  const js = blocks.find((b) => b.lang === 'js' && b.body.includes("from 'node:test'") && /R1\.1/.test(b.body));
  assert.ok(js, 'a minimal Node.js contract file');
  const py = blocks.find((b) => b.lang === 'python' && /def test_R1_1/.test(b.body));
  assert.ok(py, 'a minimal Python contract file');
  assert.ok(blocks.some((b) => b.lang === 'json' && b.body.includes('--junitxml={report}')), 'the runners.json for Python');
});
