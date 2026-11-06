// Contracts for Requirement 5 (receipts): what a receipt pins, how its hash is made, what it says about git and the task.
// R5.1 to R5.5.
//
// Receipts are made the two ways the tool makes them: `necro check <spec>` (every contract required, no task) and the
// gate (`necro hook pre` on a tick, which records the task). Each test builds a throwaway project in a temp
// directory. This file carries its own helpers, including its own canonical JSON, so the hash is checked against an
// independent implementation.
//
// The receipt pins the files these commands use. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/receipts.js'
//   from '../../src/check.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

// The test runner that runs this file sets NODE_TEST_* variables, and a git hook may set GIT_* variables.
// A nested run must see neither.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_') || k.startsWith('GIT_')) delete env[k];
  return env;
}

function necro(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv() });
}

function pre(cwd, toolName, toolInput) {
  const payload = { session_id: 's-contract', hook_event_name: 'PreToolUse', cwd, tool_name: toolName, tool_input: toolInput };
  return necro(cwd, ['hook', 'pre'], JSON.stringify(payload));
}

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=Contract', '-c', 'user.email=contract@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() },
  );
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-receipts-'));
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

// Canonical JSON written independently of src/canon.js: keys sorted recursively, no whitespace.
function canon(value) {
  const sorted = (v) => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
    return v;
  };
  return JSON.stringify(sorted(value));
}

function expectedHash(receipt) {
  const { receiptHash: _hash, createdAt: _at, ...rest } = receipt;
  return sha(canon(rest));
}

function freeze(cwd, spec = 'demo') {
  const res = necro(cwd, ['freeze', spec]);
  assert.equal(res.status, 0, `freeze failed: ${res.stderr}${res.stdout}`);
}

// Runs `necro check demo` and returns the receipt it wrote.
function check(cwd) {
  const res = necro(cwd, ['check', 'demo']);
  const m = /Receipt: (\S+)/.exec(res.stdout);
  assert.ok(m, `check printed no receipt path. status ${res.status}. stdout: ${res.stdout} stderr: ${res.stderr}`);
  const file = path.join(cwd, m[1]);
  return { rel: m[1], file, receipt: JSON.parse(fs.readFileSync(file, 'utf8')), status: res.status };
}

const REQ_REL = '.kiro/specs/demo/requirements.md';
const REQ = '# Requirements: demo\n';
const A_REL = 'contracts/demo/a.contract.test.js';
const B_REL = 'contracts/demo/b.contract.test.js';
const UTIL_REL = 'src/util.js';
const MORE_REL = 'src/more.js';

const HEAD = `import { test } from 'node:test';
import assert from 'node:assert/strict';
`;

// Contract a imports src/util.js, which imports src/more.js. Contract b imports both. Neither module is a contract.
const A = `${HEAD}import { doubleThenTriple } from '../../src/util.js';
test('R5.1 util contract', () => { assert.equal(doubleThenTriple(2), 12); });
`;
const B = `${HEAD}import { doubleThenTriple } from '../../src/util.js';
import { triple } from '../../src/more.js';
test('R5.1 second file contract', () => { assert.equal(triple(doubleThenTriple(1)), 18); });
`;
const UTIL = `import { triple } from './more.js';
export function doubleThenTriple(x) {
  return triple(x * 2);
}
`;
const MORE = `export function triple(x) {
  return x * 3;
}
`;

function files(cwd) {
  put(cwd, REQ_REL, REQ);
  put(cwd, A_REL, A);
  put(cwd, B_REL, B);
  put(cwd, UTIL_REL, UTIL);
  put(cwd, MORE_REL, MORE);
}

function commitAll(cwd) {
  git(cwd, 'init', '-q');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'initial');
}

test('R5.1 a receipt records the spec, the git commit if available, and the hashes of the requirements, the contracts and the imported sources, with each result by name', () => {
  temp((cwd) => {
    files(cwd);
    freeze(cwd);
    const { receipt, status } = check(cwd);
    assert.equal(status, 0);

    assert.equal(receipt.spec, 'demo');
    assert.equal(receipt.gitCommit, null, 'not a git repository');
    assert.deepEqual(receipt.requirements, { path: REQ_REL, sha256: sha(REQ) });

    // One entry per contract, with the file it is in, that file's hash, and its result.
    const byName = Object.fromEntries(receipt.contracts.map((c) => [c.name, c]));
    assert.deepEqual(Object.keys(byName).sort(), ['R5.1 second file contract', 'R5.1 util contract']);
    assert.deepEqual(byName['R5.1 util contract'], { name: 'R5.1 util contract', path: A_REL, sha256: sha(A), result: 'pass' });
    assert.deepEqual(byName['R5.1 second file contract'], { name: 'R5.1 second file contract', path: B_REL, sha256: sha(B), result: 'pass' });

    // Every project file the contracts import, found through the imports of imports, once each, and nothing else:
    // not the contract files and not node: modules.
    assert.deepEqual(receipt.sources, [
      { path: MORE_REL, sha256: sha(MORE) },
      { path: UTIL_REL, sha256: sha(UTIL) },
    ]);
  });

  // A failing contract is recorded as a failure, by name.
  temp((cwd) => {
    files(cwd);
    put(cwd, B_REL, `${HEAD}test('R5.1 broken contract', () => { assert.equal(1, 2); });\n`);
    freeze(cwd);
    const { receipt, status } = check(cwd);
    assert.equal(status, 1);
    assert.equal(receipt.contracts.find((c) => c.name === 'R5.1 broken contract').result, 'fail');
    assert.equal(receipt.contracts.find((c) => c.name === 'R5.1 util contract').result, 'pass');
  });

  // In a git repository the commit is recorded.
  temp((cwd) => {
    files(cwd);
    commitAll(cwd);
    freeze(cwd);
    const { receipt } = check(cwd);
    assert.equal(receipt.gitCommit, git(cwd, 'rev-parse', 'HEAD').trim());
    assert.match(receipt.gitCommit, /^[0-9a-f]{40}$/);
  });
});

test('R5.2 receiptHash is the SHA-256 of the canonical JSON of the receipt without receiptHash and createdAt', () =>
  temp((cwd) => {
    files(cwd);
    freeze(cwd);
    const { receipt, rel } = check(cwd);

    assert.match(receipt.receiptHash, /^[0-9a-f]{64}$/);
    assert.equal(receipt.receiptHash, expectedHash(receipt));
    assert.equal(path.basename(rel), `${receipt.receiptHash}.json`);
    assert.equal(rel, `.necro/receipts/demo/${receipt.receiptHash}.json`);

    // createdAt is not an input: changing it leaves the hash alone. Every other field is an input.
    assert.equal(expectedHash({ ...receipt, createdAt: '1999-01-01T00:00:00.000Z' }), receipt.receiptHash);
    assert.notEqual(expectedHash({ ...receipt, spec: 'other' }), receipt.receiptHash);
    assert.notEqual(
      expectedHash({ ...receipt, contracts: receipt.contracts.map((c) => ({ ...c, result: 'fail' })) }),
      receipt.receiptHash,
    );
    assert.equal(typeof receipt.createdAt, 'string');
  }));

test('R5.3 receipts made from identical inputs have the same receiptHash', () =>
  temp((cwd) => {
    files(cwd);
    freeze(cwd);
    const first = check(cwd);
    const second = check(cwd);
    assert.equal(second.receipt.receiptHash, first.receipt.receiptHash);
    assert.equal(second.rel, first.rel);

    // The hash follows the inputs: a pinned source that changes gives another receipt.
    fs.appendFileSync(path.join(cwd, MORE_REL), '// changed\n');
    const third = check(cwd);
    assert.notEqual(third.receipt.receiptHash, first.receipt.receiptHash);
    assert.equal(third.receipt.receiptHash, expectedHash(third.receipt));
  }));

test('R5.4 in a git repository a receipt records in uncommitted the sorted pinned paths that differ from the recorded commit, or [] when none do', () => {
  // Everything pinned is committed: an empty list.
  temp((cwd) => {
    files(cwd);
    commitAll(cwd);
    freeze(cwd);
    assert.deepEqual(check(cwd).receipt.uncommitted, []);
  });

  // A pinned source edited after the commit is listed; once it is committed the list is empty again.
  temp((cwd) => {
    files(cwd);
    commitAll(cwd);
    freeze(cwd);
    fs.appendFileSync(path.join(cwd, MORE_REL), '// edited\n');
    const dirty = check(cwd).receipt;
    assert.deepEqual(dirty.uncommitted, [MORE_REL]);
    assert.equal(dirty.receiptHash, expectedHash(dirty));
    assert.notEqual(expectedHash({ ...dirty, uncommitted: [] }), dirty.receiptHash, 'uncommitted is part of the hash');
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'edit more');
    assert.deepEqual(check(cwd).receipt.uncommitted, []);
  });

  // A pinned file the commit lacks is listed.
  temp((cwd) => {
    files(cwd);
    git(cwd, 'init', '-q');
    git(cwd, 'add', '-A');
    git(cwd, 'rm', '-q', '--cached', MORE_REL);
    git(cwd, 'commit', '-q', '-m', 'initial without more.js');
    freeze(cwd);
    assert.deepEqual(check(cwd).receipt.uncommitted, [MORE_REL]);
  });

  // Requirements, contracts and sources are all pinned paths. The list is sorted.
  temp((cwd) => {
    files(cwd);
    commitAll(cwd);
    fs.appendFileSync(path.join(cwd, UTIL_REL), '// edited\n');
    fs.appendFileSync(path.join(cwd, MORE_REL), '// edited\n');
    fs.appendFileSync(path.join(cwd, REQ_REL), 'edited\n');
    fs.appendFileSync(path.join(cwd, A_REL), '// edited\n');
    freeze(cwd); // freezes the edited files, so the contracts still run
    assert.deepEqual(check(cwd).receipt.uncommitted, [REQ_REL, A_REL, MORE_REL, UTIL_REL]);
  });

  // The project root may be a folder inside the repository.
  temp((repo) => {
    const cwd = path.join(repo, 'proj');
    fs.mkdirSync(cwd);
    files(cwd);
    commitAll(repo);
    freeze(cwd);
    assert.deepEqual(check(cwd).receipt.uncommitted, []);
    fs.appendFileSync(path.join(cwd, MORE_REL), '// edited\n');
    assert.deepEqual(check(cwd).receipt.uncommitted, [MORE_REL]);
  });
});

test('R5.5 a receipt records task (the ticked task id and its line) and required (the sorted required contract names), and still every result', () => {
  const MIXED = `${HEAD}test('R1.3 other passing contract', () => { assert.ok(true); });
test('R1.1 passing contract', () => { assert.ok(true); });
test('R1.2 failing contract', () => { assert.equal(1, 2); });
`;
  const TASKS = ['- [ ] 1. Task one (Req 1.1, 1.3)', '- [ ] 2. Task two (Req 1.2)', ''].join('\n');
  const TASKS_REL = '.kiro/specs/demo/tasks.md';

  // A tick through the gate.
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/m.contract.test.js', MIXED);
    put(cwd, TASKS_REL, TASKS);
    freeze(cwd);
    const res = pre(cwd, 'str_replace', {
      path: TASKS_REL,
      oldStr: '- [ ] 1. Task one (Req 1.1, 1.3)',
      newStr: '- [x] 1. Task one (Req 1.1, 1.3)',
    });
    assert.equal(res.status, 0, res.stderr);
    const dir = path.join(cwd, '.necro', 'receipts', 'demo');
    const [file] = fs.readdirSync(dir);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

    assert.deepEqual(receipt.task, { id: '1', line: '1. Task one (Req 1.1, 1.3)' });
    assert.deepEqual(receipt.required, ['R1.1 passing contract', 'R1.3 other passing contract'], 'sorted');
    assert.deepEqual(
      Object.fromEntries(receipt.contracts.map((c) => [c.name, c.result])),
      { 'R1.1 passing contract': 'pass', 'R1.2 failing contract': 'fail', 'R1.3 other passing contract': 'pass' },
      'every contract that ran is recorded, not only the required ones',
    );
    assert.equal(receipt.receiptHash, expectedHash(receipt), 'task and required are part of the hash');
  });

  // A receipt from `necro check` has no task and requires every contract.
  temp((cwd) => {
    put(cwd, REQ_REL, REQ);
    put(cwd, 'contracts/demo/m.contract.test.js', MIXED);
    freeze(cwd);
    const { receipt } = check(cwd);
    assert.equal(receipt.task, null);
    assert.deepEqual(receipt.required, ['R1.1 passing contract', 'R1.2 failing contract', 'R1.3 other passing contract']);
    assert.equal(receipt.receiptHash, expectedHash(receipt));
  });
});
