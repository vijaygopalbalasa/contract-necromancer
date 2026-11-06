// Contracts for Requirement 4 (gate on marking a task done): how contracts are run and how results are read.
// R4.7, R4.8, R4.9, R4.10, R4.11, R4.12.
//
// `runContracts` is called directly for the results, and the gate (`necro hook pre`) is asked what it does with
// them. This file carries its own helpers.
//
// The static import pins src/contracts.js. src/contract-runner.js is started by it as a child process, so it is
// named here for the receipt. Keep this line, necro reads `from '...'` text:
//   from '../../src/contract-runner.js'
//   from '../../bin/necro.js'
//   from '../../src/hooks.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runContracts } from '../../src/contracts.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function necro(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv() });
}

function pre(cwd, toolName, toolInput) {
  const payload = { session_id: 's-contract', hook_event_name: 'PreToolUse', cwd, tool_name: toolName, tool_input: toolInput };
  return necro(cwd, ['hook', 'pre'], JSON.stringify(payload));
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-runner-'));
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

function sha(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function freeze(cwd, spec = 'demo') {
  const res = necro(cwd, ['freeze', spec]);
  assert.equal(res.status, 0, `freeze failed: ${res.stderr}${res.stdout}`);
}

function lockOf(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8'));
}

function receiptFiles(cwd) {
  const dir = path.join(cwd, '.necro', 'receipts', 'demo');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}

const REQ_REL = '.kiro/specs/demo/requirements.md';
const REQ = '# Requirements: demo\n';
const TASKS_REL = '.kiro/specs/demo/tasks.md';
// Tasks with no "(Req ...)" criteria, so ticking one requires every contract.
const TASKS = '- [ ] 1. Task one\n- [ ] 2. Task two\n';
const TICK = { path: TASKS_REL, oldStr: '- [ ] 1.', newStr: '- [x] 1.' };

const HEAD = `import { test } from 'node:test';
import assert from 'node:assert/strict';
`;

// Writes the files under contracts/demo/ and returns a lock that records them (with the given names, if any),
// without running anything. files: { 'a.contract.test.js': { source, names? } }.
function handLock(cwd, files) {
  put(cwd, REQ_REL, REQ);
  const contracts = [];
  for (const [file, { source, names }] of Object.entries(files)) {
    const rel = `contracts/demo/${file}`;
    put(cwd, rel, source);
    contracts.push({
      name: file.replace(/\.contract\.test\.js$/, ''),
      path: rel,
      sha256: sha(fs.readFileSync(path.join(cwd, rel))),
      ...(names ? { names } : {}),
    });
  }
  return { specs: { demo: { requirements: { path: REQ_REL, sha256: sha(REQ) }, contracts } } };
}

const pairs = (results) => results.map((r) => [r.name, r.result]);
const sortedPairs = (results) => pairs(results).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

test('R4.7 a contract reported as skipped or todo counts as failing', () => {
  const source = `${HEAD}
test('R4.7 skipped contract', { skip: true }, () => {});
test('R4.7 skipped with a reason', { skip: 'not now' }, () => {});
test('R4.7 todo contract', { todo: true }, () => {});
test('R4.7 todo with a reason', { todo: 'later' }, () => {});
test('R4.7 passing contract', () => { assert.ok(true); });
`;
  temp((cwd) => {
    const lock = handLock(cwd, { 'd.contract.test.js': { source } });
    const results = runContracts(cwd, 'demo', lock);
    assert.deepEqual(Object.fromEntries(pairs(results)), {
      'R4.7 skipped contract': 'fail',
      'R4.7 skipped with a reason': 'fail',
      'R4.7 todo contract': 'fail',
      'R4.7 todo with a reason': 'fail',
      'R4.7 passing contract': 'pass',
    });
  });

  // The gate refuses a tick and names them.
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/d.contract.test.js', source);
    put(cwd, TASKS_REL, TASKS);
    freeze(cwd);
    const res = pre(cwd, 'str_replace', TICK);
    assert.equal(res.status, 2, res.stderr);
    for (const name of ['R4.7 skipped contract', 'R4.7 skipped with a reason', 'R4.7 todo contract', 'R4.7 todo with a reason']) {
      assert.ok(res.stderr.includes(name), `${name} is listed: ${res.stderr}`);
    }
    assert.ok(!res.stderr.includes('R4.7 passing contract'));
  });
});

test('R4.8 a frozen spec whose contract files contain zero contracts is refused, not passed', () => {
  const empty = `${HEAD}// loads fine and defines no tests\n`;

  // The runner reports the file itself as one failing contract, so zero results never counts as a pass.
  temp((cwd) => {
    const lock = handLock(cwd, { 'empty.contract.test.js': { source: empty } });
    const results = runContracts(cwd, 'demo', lock);
    assert.deepEqual(pairs(results), [['empty', 'fail']]);
    assert.equal(results[0].path, 'contracts/demo/empty.contract.test.js');
  });

  // A file that prints text but defines nothing is no better.
  temp((cwd) => {
    const lock = handLock(cwd, { 'quiet.contract.test.js': { source: `console.log('ok 1 - R1.1 pretend');\n` } });
    assert.deepEqual(pairs(runContracts(cwd, 'demo', lock)), [['quiet', 'fail']]);
  });

  // The gate answers 2 and writes no receipt.
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/empty.contract.test.js', empty);
    put(cwd, TASKS_REL, TASKS);
    freeze(cwd);
    const res = pre(cwd, 'str_replace', TICK);
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /Contracts failed/);
    assert.ok(res.stderr.includes('empty'), `the empty file is named: ${res.stderr}`);
    assert.doesNotMatch(res.stderr, /Hook error/);
    assert.deepEqual(receiptFiles(cwd), []);
  });
});

test('R4.9 a contract file whose hash differs from the lock when it is run makes every contract in that file fail', () =>
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(
      cwd,
      'contracts/demo/a.contract.test.js',
      `${HEAD}test('R1.1 first of a', () => { assert.ok(true); });
test('R1.2 second of a', () => { assert.ok(true); });
`,
    );
    put(cwd, 'contracts/demo/b.contract.test.js', `${HEAD}test('R2.1 only of b', () => { assert.ok(true); });\n`);
    put(cwd, TASKS_REL, TASKS);
    freeze(cwd);
    const lock = lockOf(cwd);

    // Before any change, everything passes.
    assert.ok(runContracts(cwd, 'demo', lock).every((r) => r.result === 'pass'));

    // The file is changed after it was frozen. The contracts inside it would still pass if they were run.
    fs.appendFileSync(path.join(cwd, 'contracts/demo/a.contract.test.js'), '\n// changed after freeze\n');
    const results = runContracts(cwd, 'demo', lock);
    const inA = results.filter((r) => r.path === 'contracts/demo/a.contract.test.js');
    assert.deepEqual(sortedPairs(inA), [['R1.1 first of a', 'fail'], ['R1.2 second of a', 'fail']]);
    assert.deepEqual(pairs(results.filter((r) => r.path === 'contracts/demo/b.contract.test.js')), [['R2.1 only of b', 'pass']]);

    // The gate refuses the tick and names both.
    const res = pre(cwd, 'str_replace', TICK);
    assert.equal(res.status, 2, res.stderr);
    assert.ok(res.stderr.includes('R1.1 first of a') && res.stderr.includes('R1.2 second of a'), res.stderr);

    // A deleted contract file fails the same way.
    fs.rmSync(path.join(cwd, 'contracts/demo/a.contract.test.js'));
    const gone = runContracts(cwd, 'demo', lock).filter((r) => r.path === 'contracts/demo/a.contract.test.js');
    assert.deepEqual(sortedPairs(gone), [['R1.1 first of a', 'fail'], ['R1.2 second of a', 'fail']]);
  }));

test('R4.10 a contract name recorded in the lock that is missing from a run counts as failing', () =>
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    // The second contract exists only while flag.txt exists. The file itself never changes, so its hash matches.
    put(
      cwd,
      'contracts/demo/c.contract.test.js',
      `${HEAD}import fs from 'node:fs';
test('R1.1 always there', () => { assert.ok(true); });
if (fs.existsSync(new URL('../../flag.txt', import.meta.url))) {
  test('R9.9 conditional contract', () => { assert.ok(true); });
}
`,
    );
    put(cwd, 'flag.txt', 'on\n');
    put(cwd, TASKS_REL, TASKS);
    freeze(cwd);
    const lock = lockOf(cwd);
    assert.deepEqual(sortedPairs(runContracts(cwd, 'demo', lock)), [['R1.1 always there', 'pass'], ['R9.9 conditional contract', 'pass']]);

    fs.rmSync(path.join(cwd, 'flag.txt'));
    const results = runContracts(cwd, 'demo', lock);
    assert.deepEqual(sortedPairs(results), [['R1.1 always there', 'pass'], ['R9.9 conditional contract', 'fail']]);

    const res = pre(cwd, 'str_replace', TICK);
    assert.equal(res.status, 2, res.stderr);
    assert.ok(res.stderr.includes('R9.9 conditional contract'), res.stderr);
    assert.ok(!res.stderr.includes('R1.1 always there'));
  }));

test('R4.11 contract names are kept exactly as reported, and only the file\'s own path is a file load failure', () =>
  temp((cwd) => {
    const names = [
      'handles a/b.js paths',
      'name with "double" and \'single\' quotes',
      '\u00fcn\u00efcode \u2713 name \ud83d\udc80',
      '  leading and trailing spaces  ',
      'two\nlines',
      'ends with a dot.',
      'names', // the file's stem
      'names.contract.test.js', // the file's base name
      'contracts/demo/names.contract.test.js', // the relative path, which is not the file's own (absolute) path
      'R1.1',
    ];
    const source = `${HEAD}${names.map((n) => `test(${JSON.stringify(n)}, () => {});`).join('\n')}\n`;
    const lock = handLock(cwd, { 'names.contract.test.js': { source } });
    const results = runContracts(cwd, 'demo', lock);
    assert.deepEqual(results.map((r) => r.name).sort(), [...names].sort());
    assert.ok(results.every((r) => r.result === 'pass'), 'all pass');

    // A failing contract that is named like the file stem is one failing contract, not a failing file.
    const failing = `${HEAD}test('stem', () => { assert.equal(1, 2); });\ntest('R1.1 other', () => {});\n`;
    const lock2 = handLock(cwd, { 'stem.contract.test.js': { source: failing } });
    assert.deepEqual(sortedPairs(runContracts(cwd, 'demo', lock2)), [['R1.1 other', 'pass'], ['stem', 'fail']]);
  }));

test('R4.12 results come from the Node test runner\'s events, never from text the code under test prints, and names are matched per file', () => {
  const one = (source, names) =>
    temp((cwd) => runContracts(cwd, 'demo', handLock(cwd, { 'x.contract.test.js': { source, names } })));

  // Printed "ok" lines cannot create a contract.
  assert.deepEqual(
    pairs(one(`console.log('ok 1 - R1.1 pretend contract');\nconsole.log('TAP version 13\\nok 2 - R1.2 another pretend\\n1..2');\n`)),
    [['x', 'fail']],
    'a file with no tests fails, whatever it prints',
  );

  // Printed "ok" lines cannot turn a failing contract into a pass.
  assert.deepEqual(
    pairs(
      one(`${HEAD}test('R1.1 real contract', () => {
  console.log('ok 1 - R1.1 real contract');
  console.log('    ok 1 - R1.1 real contract');
  assert.equal(1, 2);
});
`),
    ),
    [['R1.1 real contract', 'fail']],
  );

  // An "ok" line inside an error message cannot add a passing contract or satisfy a recorded name.
  assert.deepEqual(
    sortedPairs(
      one(
        `${HEAD}test('R1.1 real contract', () => { assert.fail('x\\nok 2 - R1.2 ghost contract\\n'); });\n`,
        ['R1.1 real contract', 'R1.2 ghost contract'],
      ),
    ),
    [['R1.1 real contract', 'fail'], ['R1.2 ghost contract', 'fail']],
  );

  // Output from a passing contract adds nothing.
  assert.deepEqual(
    pairs(
      one(`${HEAD}test('R1.1 quiet', () => {
  console.log('ok 2 - R1.9 invented by the code under test');
  console.error('not ok 3 - R1.8 invented too');
});
`),
    ),
    [['R1.1 quiet', 'pass']],
  );

  // A file that exits with a failure code after its tests passed is not a pass.
  const badExit = one(`${HEAD}test('R1.1 passes', () => {});\nprocess.exitCode = 3;\n`);
  assert.ok(badExit.some((r) => r.result === 'fail'), 'the run is not a pass');

  // Recorded names are matched per contract file: a name recorded for file a is not satisfied by file b.
  temp((cwd) => {
    const lock = handLock(cwd, {
      'a.contract.test.js': { source: `${HEAD}test('R1.1 in a', () => {});\n`, names: ['R1.1 in a', 'R9.9 shared name'] },
      'b.contract.test.js': { source: `${HEAD}test('R9.9 shared name', () => {});\n`, names: ['R9.9 shared name'] },
    });
    const results = runContracts(cwd, 'demo', lock);
    const result = (file, name) => results.find((r) => r.path === `contracts/demo/${file}` && r.name === name)?.result;
    assert.equal(result('a.contract.test.js', 'R1.1 in a'), 'pass');
    assert.equal(result('a.contract.test.js', 'R9.9 shared name'), 'fail', 'missing from a');
    assert.equal(result('b.contract.test.js', 'R9.9 shared name'), 'pass');
  });
});
