import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseRunnersConfig, expandGlobs } from '../src/runners.js';
import { TASK_LINE } from '../src/lock.js';

// The Python example (Req 13.6): examples/leap-age, a small project with pytest contracts and a runners.json.
// A person froze the example and the gate ticked its tasks. These tests also freeze a copy in a temporary folder,
// the way a person would, and check the gate there.

const REPO = path.resolve(import.meta.dirname, '..');
const BIN = path.join(REPO, 'bin', 'necro.js');
const EXAMPLE = path.join(REPO, 'examples', 'leap-age');
const SPEC = 'age';
const TASKS_REL = `.kiro/specs/${SPEC}/tasks.md`;
const HARDENED = 'python3 -P -m pytest {file} --junitxml={report} -q --noconftest -p no:cacheprovider';

// The test runner sets NODE_TEST_* variables. A child process must not see them.
function cleanEnv() {
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

// A plain sentence when python3 -m pytest cannot run here, otherwise null.
function pytestMissing() {
  const res = spawnSync('python3', ['-m', 'pytest', '--version'], { encoding: 'utf8', env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status === 0) return null;
  return 'Skipped: python3 -m pytest is not available here. Install pytest (python3 -m pip install pytest) to run this test.';
}

const SKIP = pytestMissing() ?? false;

function necro(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv(), timeout: 240_000 });
}

// A copy of the example without any lock, receipts or compiled files, frozen the way a person would.
function frozenCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-pyexample-'));
  fs.cpSync(EXAMPLE, dir, {
    recursive: true,
    filter: (src) => !/(^|[\\/])(__pycache__|\.pytest_cache|\.necro)([\\/]|$)/.test(src),
  });
  const frozen = necro(dir, ['freeze', SPEC]);
  assert.equal(frozen.status, 0, `necro freeze: ${frozen.stdout}${frozen.stderr}`);
  return dir;
}

function taskLine(dir, id) {
  for (const line of fs.readFileSync(path.join(dir, TASKS_REL), 'utf8').split('\n')) {
    const m = TASK_LINE.exec(line);
    if (m && m[2].startsWith(`${id}. `)) return m[2].trim();
  }
  throw new Error(`Task ${id} is not in ${TASKS_REL}.`);
}

// The call the Kiro IDE sends when a task completes, as the PreToolUse hook receives it.
function tick(dir, id) {
  const payload = {
    hook_event_name: 'preToolUse',
    tool_name: 'task_update',
    tool_input: { tasksFilePath: TASKS_REL, taskId: taskLine(dir, id), status: 'completed' },
  };
  return necro(dir, ['hook', 'pre'], JSON.stringify(payload));
}

function receiptFor(dir, id) {
  const folder = path.join(dir, '.necro', 'receipts', SPEC);
  const names = fs.existsSync(folder) ? fs.readdirSync(folder).filter((n) => n.endsWith('.json')) : [];
  const hits = names.map((n) => path.join(folder, n)).filter((f) => JSON.parse(fs.readFileSync(f, 'utf8')).task?.id === id);
  return hits.length === 1 ? hits[0] : null;
}

function edit(dir, rel, from, to) {
  const file = path.join(dir, rel);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(from), `${rel} does not hold: ${from}`);
  fs.writeFileSync(file, text.replace(from, () => to));
}

function done(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// The criteria of requirements.md as IDs such as "1.1".
function criteriaOf(markdown) {
  const ids = [];
  let req = null;
  for (const line of markdown.split('\n')) {
    const r = /^## Requirement (\d+):/.exec(line);
    if (r) req = r[1];
    const c = /^(\d+)\. (?:WHEN|IF|WHERE|THE) /.exec(line);
    if (req && c) ids.push(`${req}.${c[1]}`);
  }
  return ids;
}

test('R13.6 the example has the spec files, a hardened runners.json with real sources and frozen files, and a README that says pytest must be installed', () => {
  for (const rel of ['requirements.md', 'design.md', 'tasks.md', 'runners.json']) {
    assert.ok(fs.statSync(path.join(EXAMPLE, '.kiro', 'specs', SPEC, rel)).isFile(), `${rel} is missing`);
  }
  const config = parseRunnersConfig(fs.readFileSync(path.join(EXAMPLE, '.kiro', 'specs', SPEC, 'runners.json'), 'utf8'));
  assert.deepEqual(config.patterns, [{ pattern: 'test_*_contract.py', command: HARDENED }]);
  assert.ok(config.sources.length > 0 && config.frozen.length > 0, 'runners.json lists sources and frozen files');
  for (const glob of [...config.sources, ...config.frozen]) {
    assert.ok(expandGlobs(EXAMPLE, [glob]).length > 0, `${glob} matches no file`);
  }
  assert.match(fs.readFileSync(path.join(EXAMPLE, 'README.md'), 'utf8'), /pytest must be installed/);
});

test('R13.6 the example was frozen by a person and the gate ticked its tasks and wrote a receipt for each', () => {
  assert.equal(fs.existsSync(path.join(EXAMPLE, '.necro', 'lock.json')), true, 'examples/leap-age/.necro/lock.json is missing');
  const tasks = fs.readFileSync(path.join(EXAMPLE, TASKS_REL), 'utf8').split('\n').filter((l) => TASK_LINE.test(l));
  assert.ok(tasks.length > 0);
  for (const line of tasks) assert.match(line, /\[x\]/, `not ticked: ${line}`);
  const folder = path.join(EXAMPLE, '.necro', 'receipts', SPEC);
  assert.ok(fs.readdirSync(folder).some((n) => n.endsWith('.json')), 'no receipt in examples/leap-age/.necro/receipts/age');
});

test('R13.6 every criterion has one contract named with its ID, the contracts pass on the code, and check writes a receipt that verify confirms', { skip: SKIP }, () => {
  const dir = frozenCopy();
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, '.necro', 'lock.json'), 'utf8'));
    const names = lock.specs[SPEC].contracts.flatMap((c) => c.names);
    const ids = criteriaOf(fs.readFileSync(path.join(dir, '.kiro', 'specs', SPEC, 'requirements.md'), 'utf8'));
    assert.equal(ids.length, 8);
    for (const id of ids) {
      assert.equal(names.filter((n) => n.startsWith(`R${id} `)).length, 1, `one contract named R${id} ...`);
    }
    assert.equal(names.length, ids.length, 'no contract without a criterion');
    // Every task names criteria, and together the tasks name every criterion once.
    const tasks = lock.specs[SPEC].tasks;
    assert.deepEqual(Object.keys(tasks).sort(), ['1', '2', '3']);
    assert.deepEqual(Object.values(tasks).flatMap((t) => t.criteria).sort(), [...ids].sort());

    const checked = necro(dir, ['check', SPEC]);
    assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
    assert.equal((checked.stdout.match(/^pass /gm) || []).length, 8, checked.stdout);
    const folder = path.join(dir, '.necro', 'receipts', SPEC);
    const [file] = fs.readdirSync(folder);
    const verified = necro(dir, ['verify', path.join(folder, file)]);
    assert.equal(verified.status, 0, `${verified.stdout}${verified.stderr}`);
    assert.match(verified.stdout, /^CONFIRMED /m);
  } finally {
    done(dir);
  }
});

test('R13.6 the gate refuses a tick with a planted bug and accepts it fixed, for the century rule (task 1) and the leap-day birthday (task 2)', { skip: SKIP }, () => {
  const dir = frozenCopy();
  try {
    // Task 1: the century rule missing.
    edit(dir, 'leapage/years.py', ' and (year % 100 != 0 or year % 400 == 0)', '');
    const refused = tick(dir, '1');
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /Contracts failed: .*R1\.1/);
    assert.equal(receiptFor(dir, '1'), null, 'no receipt for a refused tick');

    edit(dir, 'leapage/years.py', 'return year % 4 == 0', 'return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)');
    const accepted = tick(dir, '1');
    assert.equal(accepted.status, 0, accepted.stderr);
    const receipt = receiptFor(dir, '1');
    assert.ok(receipt, 'a receipt for task 1');
    const verified = necro(dir, ['verify', receipt]);
    assert.equal(verified.status, 0, `${verified.stdout}${verified.stderr}`);
    assert.match(verified.stdout, /^CONFIRMED /m);

    // Task 2: the leap-day birthday on 28 February.
    edit(dir, 'leapage/age.py', 'return date(year, 3, 1)', 'return date(year, 2, 28)');
    const refused2 = tick(dir, '2');
    assert.equal(refused2.status, 2, refused2.stderr);
    assert.match(refused2.stderr, /Contracts failed: .*R2\.2/);
    assert.equal(receiptFor(dir, '2'), null, 'no receipt for a refused tick');

    edit(dir, 'leapage/age.py', 'return date(year, 2, 28)', 'return date(year, 3, 1)');
    const accepted2 = tick(dir, '2');
    assert.equal(accepted2.status, 0, accepted2.stderr);
    assert.ok(receiptFor(dir, '2'), 'a receipt for task 2');

    // A change to the code after a receipt shows up in verify, because "sources" pins leapage/*.py.
    fs.appendFileSync(path.join(dir, 'leapage', 'years.py'), '# changed after the receipt\n');
    const changed = necro(dir, ['verify', receipt]);
    assert.equal(changed.status, 1);
    assert.match(changed.stdout, /^MISMATCH/m);
    assert.match(changed.stdout, /leapage\/years\.py/);
  } finally {
    done(dir);
  }
});

test('R13.6 a pytest.ini added after the freeze, where pytest would read it first, fails the contracts of a copy', { skip: SKIP }, () => {
  const dir = frozenCopy();
  try {
    fs.writeFileSync(path.join(dir, 'contracts', SPEC, 'pytest.ini'), '[pytest]\naddopts = -k nothing\n');
    const refused = tick(dir, '1');
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /R1\.1/);
    const check = necro(dir, ['check', SPEC]);
    assert.equal(check.status, 1, `${check.stdout}${check.stderr}`);
    assert.match(`${check.stdout}${check.stderr}`, /pytest\.ini/);
  } finally {
    done(dir);
  }
});
