// Contracts for Requirement 16 of the necro-core spec: adopting the tool in your own project.
//
// R16.1  WHEN a spec is frozen THE SYSTEM SHALL print each contract file with the criterion IDs its contracts cover, and
//        SHALL print warnings naming each criterion of requirements.md that has no contract and each contract name that
//        does not start with a criterion ID.
// R16.2  IF a contract file fails to load or yields no test when the spec is frozen THEN THE SYSTEM SHALL refuse to freeze,
//        exit 1 and print the file and the first lines of the error.
// R16.3  WHEN a contract that the lock records has no result in a run THE SYSTEM SHALL say that the lock may be stale and
//        that a person should freeze the spec again, next to the failure.
// R16.4  WHEN a runner command fails THE SYSTEM SHALL include the last lines of its standard error in the reason, and IF its
//        program cannot start or reports a missing module THEN `necro check` and `necro audit` SHALL say the contracts
//        cannot run here (naming what is missing) instead of calling the work failing, while still exiting non-zero.
// R16.5  WHEN a runner report's testcase name carries the criterion ID with underscores (`R1_1`, `test_R1_1_rounds`) or
//        inside a parametrize id (`test_x[R1.1 ...]`) THE SYSTEM SHALL map it to that criterion exactly as `R1.1 ...`.
// R16.6  WHEN a user runs `necro help`, `necro --help` or `necro -h` THE SYSTEM SHALL print each command with one line on
//        what it does, and WHEN `necro init` runs from a temporary npx install THE SYSTEM SHALL warn that the hook paths
//        point into a cache and show how to install permanently.
// R16.7  THE package SHALL list its published files so `npx` prints no `.gitignore` fallback warning, and the README SHALL
//        open with a short "Use it in your project" section: five commands and a minimal contract file for Node.js and
//        for Python.
//
// R16.2 covers a file that fails to load. It does not assert the clause "or yields no test": the frozen contract R4.8
// freezes a spec whose contract file defines no test and needs that freeze to succeed, so the tool reports such a file
// with a warning and freezes it, and a person decides whether R4.8 or that clause changes.
//
// Every test runs the real command line in a throwaway project, with a fake test framework written in Node (carried in
// this file) wherever a runner is needed, so nothing here needs Python. This file carries its own helpers.
//
// The receipt pins the files these tests exercise. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/lock.js'
//   from '../../src/contracts.js'
//   from '../../src/runners.js'
//   from '../../src/audit.js'
//   from '../../src/check.js'
//   from '../../src/hooks.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function necro(cwd, args, { input, bin = BIN } = {}) {
  const res = spawnSync(process.execPath, [bin, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv(), timeout: 120_000 });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return { status: res.status, stdout, stderr, both: `${stdout}${stderr}` };
}

function temp(fn, prefix = 'necro-core-adopt-') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

const lockOf = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8'));
const hasLock = (cwd) => fs.existsSync(path.join(cwd, '.necro', 'lock.json'));

const REQ = `# Requirements: demo

## Requirement 1: Slugs
**User story:** As a user, I want slugs.
### Acceptance criteria
1. WHEN text is given THE SYSTEM SHALL lowercase it.
2. WHEN text has spaces THE SYSTEM SHALL replace them with dashes.

## Requirement 2: Empty input
#### Acceptance Criteria
1. WHEN the text is empty THE SYSTEM SHALL return an empty string.
`;
const REQ_REL = '.kiro/specs/demo/requirements.md';
const TASKS_REL = '.kiro/specs/demo/tasks.md';
const HEAD = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n`;

const tickPayload = (cwd, oldStr, newStr) =>
  JSON.stringify({ session_id: 's-adopt', hook_event_name: 'PreToolUse', cwd, tool_name: 'str_replace', tool_input: { path: TASKS_REL, oldStr, newStr } });

// A fake test framework. It reads a contract file with one line per testcase ("pass <name>" or "fail <name>") and writes a
// JUnit XML report to the path it is given. A third argument names a file that can change how it behaves: "missing" makes
// it print what python prints when pytest is not installed and exit 1, "noise" makes it print twelve lines on stderr and
// exit 3. Neither writes a report.
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

// A project whose spec has contracts for the fake framework. `program` is what starts the framework; it is the Node
// binary unless a test passes its own. Returns the path of the flag file that changes the framework's behaviour.
function fakeProject(cwd, files, { tasks, program = process.execPath } = {}) {
  const flag = path.join(cwd, 'flag.txt');
  put(cwd, REQ_REL, REQ);
  put(cwd, 'tools/fake-runner.cjs', FAKE_RUNNER);
  put(
    cwd,
    '.kiro/specs/demo/runners.json',
    JSON.stringify({ '*_contract.fake': `"${program}" "${path.join(cwd, 'tools/fake-runner.cjs')}" {file} {report} "${flag}"` }) + '\n',
  );
  for (const [name, text] of Object.entries(files)) put(cwd, `contracts/demo/${name}`, text);
  if (tasks) put(cwd, TASKS_REL, tasks);
  return flag;
}

const warningLines = (text) => text.split('\n').filter((l) => /warning/i.test(l));

test('R16.1 freeze prints each contract file with the criterion IDs it covers, and warns about each criterion with no contract and each contract name with no criterion ID', () =>
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(
      cwd,
      'contracts/demo/slug.contract.test.js',
      `${HEAD}test('R1.1 lowercases', () => {});\ntest('R1.2 dashes', () => {});\ntest('helper works', () => {});\n`,
    );
    put(cwd, 'contracts/demo/other.contract.test.js', `${HEAD}test('R1.1 again', () => {});\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 0, res.both);
    const lines = res.both.split('\n').filter((l) => !/warning/i.test(l));
    const slug = lines.find((l) => l.includes('contracts/demo/slug.contract.test.js'));
    assert.ok(slug, `a line for slug.contract.test.js: ${res.both}`);
    assert.match(slug, /R1\.1, R1\.2/);
    const other = lines.find((l) => l.includes('contracts/demo/other.contract.test.js'));
    assert.match(other, /R1\.1/);
    assert.doesNotMatch(other, /R1\.2/);

    const warnings = warningLines(res.both);
    assert.equal(warnings.length, 2, res.both);
    assert.ok(warnings.some((w) => /R2\.1/.test(w) && /no contract/i.test(w)), `R2.1 has no contract: ${res.both}`);
    assert.ok(warnings.some((w) => w.includes('helper works') && /criterion ID/i.test(w)), `a name with no ID: ${res.both}`);
    assert.ok(!warnings.some((w) => /no contract/i.test(w) && /R1\.[12]/.test(w)), 'covered criteria are not warned about');

    // Everything covered and named: no warning at all.
    put(cwd, 'contracts/demo/slug.contract.test.js', `${HEAD}test('R1.1 lowercases', () => {});\ntest('R1.2 dashes', () => {});\ntest('R2.1 empty', () => {});\n`);
    const clean = necro(cwd, ['freeze', 'demo']);
    assert.equal(clean.status, 0, clean.both);
    assert.deepEqual(warningLines(clean.both), []);
  }));

test('R16.2 a contract file that fails to load is refused at freeze, with the file and the first lines of the error', () => {
  // An ES module contract in a CommonJS project.
  temp((cwd) => {
    put(cwd, 'package.json', JSON.stringify({ name: 'proj', type: 'commonjs' }));
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/esm.contract.test.js', `${HEAD}test('R1.1 a', () => {});\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 1, res.both);
    assert.ok(res.stderr.includes('contracts/demo/esm.contract.test.js'), res.both);
    assert.match(res.stderr, /SyntaxError: Cannot use import statement outside a module/);
    assert.equal(hasLock(cwd), false, 'nothing is frozen');
  });
  // A file that throws while it loads.
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/boom.contract.test.js', `${HEAD}test('R1.1 a', () => {});\nthrow new Error('top-level boom');\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 1, res.both);
    assert.ok(res.stderr.includes('contracts/demo/boom.contract.test.js'), res.both);
    assert.match(res.stderr, /top-level boom/);
    assert.equal(hasLock(cwd), false);
  });
  // A second file that throws, next to a good one: only the throwing file is named, and the earlier lock stays.
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/good.contract.test.js', `${HEAD}test('R1.1 a', () => {});\n`);
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    const before = fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8');
    put(cwd, 'contracts/demo/broken.contract.test.js', `${HEAD}throw new Error('cannot start');\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 1, res.both);
    assert.ok(res.stderr.includes('contracts/demo/broken.contract.test.js'), res.both);
    assert.match(res.stderr, /cannot start/);
    assert.doesNotMatch(res.stderr, /good\.contract/);
    assert.equal(fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8'), before);
  });
  // A file that loads and has a failing test is not a load failure: it still freezes.
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/red.contract.test.js', `${HEAD}test('R1.1 not yet', () => { assert.fail('not built yet'); });\n`);
    const res = necro(cwd, ['freeze', 'demo']);
    assert.equal(res.status, 0, res.both);
    assert.deepEqual(lockOf(cwd).specs.demo.contracts[0].names, ['R1.1 not yet']);
  });
});

test('R16.3 a contract the lock records that a run no longer reports fails with a note that the lock may be stale and a person should freeze the spec again, in check and in the gate', () =>
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(
      cwd,
      'contracts/demo/dyn.contract.test.js',
      `${HEAD}import fs from 'node:fs';\ntest('R1.1 always', () => {});\nif (fs.existsSync(new URL('./extra.flag', import.meta.url))) test('R1.2 extra', () => {});\n`,
    );
    put(cwd, 'contracts/demo/extra.flag', 'on\n');
    put(cwd, TASKS_REL, '- [ ] 1. First (Req 1.1, 1.2)\n- [ ] 2. Second (Req 1.1)\n');
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
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

    // A contract that fails for its own reasons carries no such note.
    temp((other) => {
      put(other, REQ_REL, REQ);
      put(other, 'contracts/demo/red.contract.test.js', `${HEAD}test('R1.1 red', () => { assert.fail('no'); });\n`);
      assert.equal(necro(other, ['freeze', 'demo']).status, 0);
      const plain = necro(other, ['check', 'demo']);
      assert.equal(plain.status, 1);
      assert.doesNotMatch(plain.both, /stale/i);
    });
  }));

test('R16.4 a failing runner command shows the last lines of its standard error, and a missing module or program is reported as contracts that cannot run here, by check and by audit, with a non-zero exit', () => {
  const tasks = '- [x] 1. First (Req 1.1)\n- [ ] 2. Second (Req 1.2)\n';

  // The command fails: the reason carries the last lines of stderr and the work is not called a missing tool.
  temp((cwd) => {
    const flag = fakeProject(cwd, { 'a_contract.fake': 'pass R1.1 right\n' });
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    fs.writeFileSync(flag, 'noise');
    const check = necro(cwd, ['check', 'demo']);
    assert.equal(check.status, 1, check.both);
    assert.match(check.stdout, /exited with status 3/);
    assert.match(check.stdout, /err-12/);
    assert.match(check.stdout, /err-08/);
    assert.doesNotMatch(check.stdout, /err-01/);
    assert.doesNotMatch(check.stdout, /cannot run here/i);
  });

  // A missing module.
  temp((cwd) => {
    const flag = fakeProject(cwd, { 'a_contract.fake': 'pass R1.1 right\n' }, { tasks });
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    fs.writeFileSync(flag, 'missing');
    const check = necro(cwd, ['check', 'demo']);
    assert.equal(check.status, 1, check.both);
    assert.match(check.stdout, /cannot run here/i);
    assert.match(check.stdout, /pytest/);
    assert.doesNotMatch(check.stdout, /Fix the code/);
    const audit = necro(cwd, ['audit']);
    assert.equal(audit.status, 1, audit.both);
    assert.match(audit.stdout, /cannot run here/i);
    assert.match(audit.stdout, /pytest/);
    assert.doesNotMatch(audit.stdout, /failing/);
  });

  // A program that cannot start: the framework's program is a link that is removed after the freeze.
  temp((cwd) => {
    const program = path.join(cwd, 'tools', 'vanishing-framework');
    fs.mkdirSync(path.dirname(program), { recursive: true });
    fs.symlinkSync(process.execPath, program);
    fakeProject(cwd, { 'a_contract.fake': 'pass R1.1 right\n' }, { tasks, program });
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    fs.rmSync(program);
    const check = necro(cwd, ['check', 'demo']);
    assert.equal(check.status, 1, check.both);
    assert.match(check.stdout, /cannot run here/i);
    assert.match(check.stdout, /vanishing-framework/);
    const audit = necro(cwd, ['audit']);
    assert.equal(audit.status, 1, audit.both);
    assert.match(audit.stdout, /cannot run here/i);
    assert.match(audit.stdout, /vanishing-framework/);
  });

  // Tests that fail in a report are the work failing: no "cannot run here".
  temp((cwd) => {
    fakeProject(cwd, { 'a_contract.fake': 'fail R1.1 wrong\n' });
    assert.equal(necro(cwd, ['freeze', 'demo']).status, 0);
    const check = necro(cwd, ['check', 'demo']);
    assert.equal(check.status, 1);
    assert.match(check.stdout, /Fix the code/);
    assert.doesNotMatch(check.stdout, /cannot run here/i);
  });
});

test('R16.5 a runner testcase name with the criterion ID in underscores or in a parametrize id maps to that criterion as "R1.1 ...", and the gate requires it by criterion', () =>
  temp((cwd) => {
    fakeProject(
      cwd,
      { 'a_contract.fake': 'pass R1_1\nfail test_R1_2_dashes\npass test_x[R2.1 empty]\npass test_R1_1_rounds\npass test_plain\n' },
      { tasks: '- [ ] 1. First (Req 1.1)\n- [ ] 2. Second (Req 1.2)\n- [ ] 3. Third (Req 2.1)\n' },
    );
    const frozen = necro(cwd, ['freeze', 'demo']);
    assert.equal(frozen.status, 0, frozen.both);
    assert.deepEqual(lockOf(cwd).specs.demo.contracts[0].names.sort(), [
      'R1.1 R1_1',
      'R1.1 test_R1_1_rounds',
      'R1.2 test_R1_2_dashes',
      'R2.1 test_x[R2.1 empty]',
      'test_plain',
    ]);
    // The freeze report counts them as covering the three criteria.
    assert.match(frozen.both, /R1\.1, R1\.2, R2\.1/);
    assert.doesNotMatch(frozen.both, /no contract covers/i);

    // Task 1 requires R1.1 contracts, which pass; task 2 requires R1.2, which fails.
    const ok = necro(cwd, ['hook', 'pre'], { input: tickPayload(cwd, '- [ ] 1.', '- [x] 1.') });
    assert.equal(ok.status, 0, ok.both);
    const refused = necro(cwd, ['hook', 'pre'], { input: tickPayload(cwd, '- [ ] 2.', '- [x] 2.') });
    assert.equal(refused.status, 2, refused.both);
    assert.match(refused.stderr, /R1\.2 test_R1_2_dashes/);
  }));

test('R16.6 necro help, --help and -h print each command with one line on what it does, and init from an npx cache warns and shows how to install permanently', () => {
  temp((cwd) => {
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
  });

  const install = (dest) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of ['bin', 'src', 'templates', 'package.json']) fs.cpSync(path.join(REPO, entry), path.join(dest, entry), { recursive: true });
    return path.join(dest, 'bin', 'necro.js');
  };
  temp((root) => {
    temp((project) => {
      const bin = install(path.join(root, '.npm', '_npx', 'abc123', 'node_modules', 'contract-necromancer'));
      const res = necro(project, ['init'], { bin });
      assert.equal(res.status, 0, res.both);
      assert.match(res.both, /npx cache/i);
      assert.match(res.both, /npm install -g github:vijaygopalbalasa\/contract-necromancer/);
      assert.ok(fs.existsSync(path.join(project, '.kiro', 'hooks', 'necromancer.json')));
    }, 'necro-core-adopt-project-');
    // A permanent install gets no such warning.
    temp((project) => {
      const bin = install(path.join(root, 'lib', 'node_modules', 'contract-necromancer'));
      const res = necro(project, ['init'], { bin });
      assert.equal(res.status, 0, res.both);
      assert.doesNotMatch(res.both, /npx cache/i);
    }, 'necro-core-adopt-project-');
  }, 'necro-core-adopt-npx-');
});

test('R16.7 package.json lists the published files so npm pack prints no .gitignore fallback warning, and the README opens with "Use it in your project": five commands and a minimal contract for Node.js and for Python', () => {
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
    assert.ok(!/^(test|site|case-studies|experiments|tools|contracts|\.kiro|\.necro|\.github)\//.test(rel), `npm pack should not publish ${rel}`);
  }

  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  const headings = [...readme.matchAll(/^## (.+)$/gm)];
  assert.equal(headings[0][1], 'Use it in your project', 'it is the first section');
  assert.equal(headings.filter((h) => h[1] === 'Use it in your project').length, 1, 'the heading appears once');
  const section = readme.slice(headings[0].index, headings[1].index);
  assert.ok(section.split('\n').length <= 90, 'it stays short');
  for (const command of ['necro init', 'necro freeze <spec>', 'necro check <spec>', 'necro audit', 'necro verify <receipt>']) {
    assert.ok(section.includes(command), `the section shows ${command}`);
  }
  const blocks = [...section.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], body: m[2] }));
  assert.ok(blocks.some((b) => b.lang === 'js' && b.body.includes("from 'node:test'") && /R1\.1/.test(b.body)), 'a minimal Node.js contract file');
  assert.ok(blocks.some((b) => b.lang === 'python' && /def test_R1_1/.test(b.body)), 'a minimal Python contract file');
  assert.ok(blocks.some((b) => b.lang === 'json' && b.body.includes('--junitxml={report}')), 'the runners.json for Python');
});
