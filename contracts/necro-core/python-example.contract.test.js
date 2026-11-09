// Contract for Requirement 13.6 of the necro-core spec: the Python example.
//
// R13.6  THE SYSTEM SHALL ship an example under `examples/` with a small Python project whose spec has pytest contracts
//        and a `runners.json` running `python3 -m pytest {file} --junitxml={report} -q`, frozen, with at least one
//        receipt written by the gate, and its README SHALL say pytest must be installed.
//
// The example is `examples/leap-age` (spec `age`). It is shipped as a draft for a person to freeze, so the repository
// holds no lock and no receipt for it. This contract checks the example and then does what a person and the gate do, in a
// copy under the temporary directory: freeze the spec, plant a bug in the code, show the gate refusing the tick of a task,
// fix the bug, show the gate accepting it and writing a receipt, and re-run that receipt with `necro verify`.
//
// It needs `python3 -m pytest`. When that is not available it skips, with a plain message. (A skipped contract does not
// pass, but the contract is the same one that runs wherever pytest is installed.)
//
// This file carries its own helpers, so it does not depend on any file that is not frozen.
//
// The receipt pins the files this test exercises. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/runners.js'
//   from '../../src/junit.js'
//   from '../../src/contracts.js'
//   from '../../src/lock.js'
//   from '../../src/hooks.js'
//   from '../../src/check.js'
//   from '../../src/verify.js'
//   from '../../src/receipts.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');
const EXAMPLE = path.join(REPO, 'examples', 'leap-age');
const SPEC = 'age';
const TASKS_REL = `.kiro/specs/${SPEC}/tasks.md`;

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv() {
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

// A plain sentence when python3 -m pytest cannot run here, otherwise false.
function skipReason() {
  const res = spawnSync('python3', ['-m', 'pytest', '--version'], { encoding: 'utf8', env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status === 0) return false;
  return 'Skipped: python3 -m pytest is not available here. Install pytest (python3 -m pip install pytest) to run this contract.';
}

function necro(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv(), timeout: 240_000 });
}

// The text after the checkbox of task `id` in tasks.md, as the Kiro IDE sends it.
function taskLine(dir, id) {
  for (const line of fs.readFileSync(path.join(dir, TASKS_REL), 'utf8').split('\n')) {
    const m = /^\s*[-*+]\s*\[[ xX]\]\s?(.*)$/.exec(line);
    if (m && m[1].startsWith(`${id}. `)) return m[1].trim();
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

test('R13.6 a Python example has pytest contracts and a runners.json, and the gate refuses a planted bug, accepts the fix and writes a receipt', { skip: skipReason() }, () => {
  // The example: a small Python project with its spec, pytest contracts and a README.
  for (const rel of ['requirements.md', 'design.md', 'tasks.md', 'runners.json']) {
    assert.ok(fs.statSync(path.join(EXAMPLE, '.kiro', 'specs', SPEC, rel)).isFile(), `${rel} is missing`);
  }
  assert.match(fs.readFileSync(path.join(EXAMPLE, '.kiro', 'specs', SPEC, 'requirements.md'), 'utf8'), /THE SYSTEM SHALL/);
  assert.ok(fs.readdirSync(path.join(EXAMPLE, 'leapage')).some((n) => n.endsWith('.py')), 'Python code');
  const contracts = fs.readdirSync(path.join(EXAMPLE, 'contracts', SPEC)).filter((n) => /^test_.*_contract\.py$/.test(n));
  assert.ok(contracts.length > 0, 'pytest contracts');
  assert.match(fs.readFileSync(path.join(EXAMPLE, 'README.md'), 'utf8'), /pytest must be installed/);

  // runners.json: a pattern that runs python3 -m pytest with the file and the report, and the sources and frozen keys.
  const runners = JSON.parse(fs.readFileSync(path.join(EXAMPLE, '.kiro', 'specs', SPEC, 'runners.json'), 'utf8'));
  const patterns = Object.entries(runners).filter(([key]) => key !== 'sources' && key !== 'frozen');
  assert.equal(patterns.length, 1);
  assert.ok(contracts.every((n) => new RegExp(`^${patterns[0][0].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(n)), 'the pattern matches every contract file');
  assert.match(patterns[0][1], /^python3 .*-m pytest \{file\} --junitxml=\{report\} -q( |$)/);
  assert.ok(Array.isArray(runners.sources) && runners.sources.length > 0, 'sources');
  assert.ok(Array.isArray(runners.frozen) && runners.frozen.length > 0, 'frozen');

  // A copy, frozen the way a person freezes it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-pyexample-'));
  try {
    fs.cpSync(EXAMPLE, dir, {
      recursive: true,
      filter: (src) => !/(^|[\\/])(__pycache__|\.pytest_cache|\.necro)([\\/]|$)/.test(src),
    });
    const frozen = necro(dir, ['freeze', SPEC]);
    assert.equal(frozen.status, 0, `${frozen.stdout}${frozen.stderr}`);
    const entry = JSON.parse(fs.readFileSync(path.join(dir, '.necro', 'lock.json'), 'utf8')).specs[SPEC];
    assert.equal(entry.runners.path, `.kiro/specs/${SPEC}/runners.json`);
    assert.ok((entry.frozen || []).length > 0, 'the frozen files are locked with the spec');
    const names = entry.contracts.flatMap((c) => c.names);
    assert.ok(names.length >= 2 && names.every((n) => /^R\d+\.\d+ /.test(n)), `contract names start with a criterion ID: ${names.join(' | ')}`);

    // The bug the contracts exist for: the century rule missing, so 1900 and 2100 count as leap years.
    edit(dir, 'leapage/years.py', ' and (year % 100 != 0 or year % 400 == 0)', '');
    const refused = tick(dir, '1');
    assert.equal(refused.status, 2, `the gate should refuse the tick: ${refused.stderr}`);
    assert.match(refused.stderr, /Contracts failed: .*R1\.1/);
    assert.equal(receiptFor(dir, '1'), null, 'a refused tick leaves no receipt');

    // The fix: the gate accepts the tick and writes a receipt that necro verify confirms.
    edit(dir, 'leapage/years.py', 'return year % 4 == 0', 'return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)');
    const accepted = tick(dir, '1');
    assert.equal(accepted.status, 0, `the gate should accept the tick: ${accepted.stderr}`);
    const receipt = receiptFor(dir, '1');
    assert.ok(receipt, 'the gate wrote a receipt for the task');
    const verified = necro(dir, ['verify', receipt]);
    assert.equal(verified.status, 0, `${verified.stdout}${verified.stderr}`);
    assert.match(verified.stdout, /^CONFIRMED /m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
