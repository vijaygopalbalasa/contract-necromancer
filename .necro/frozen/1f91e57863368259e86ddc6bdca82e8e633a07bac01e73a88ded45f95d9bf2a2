// Contracts for Requirement 6 (verify): `necro verify <receiptFile>` re-runs a receipt.
// R6.1 to R6.7.
//
// Each test builds a throwaway project in a temp directory, freezes it, makes a receipt with `necro check`, then
// changes things the way a reviewer's checkout or a forger would, and runs `necro verify`. This file carries its own
// helpers, including its own canonical JSON, so a forged receipt can be given a hash that is correct for its content.
//
// The receipt pins the files `necro verify` uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/verify.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-verify-'));
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

function canon(value) {
  const sorted = (v) => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
    return v;
  };
  return JSON.stringify(sorted(value));
}

const REQ_REL = '.kiro/specs/demo/requirements.md';
const REQ = '# Requirements: demo\n';
const A_REL = 'contracts/demo/a.contract.test.js';
const B_REL = 'contracts/demo/b.contract.test.js';
const UTIL_REL = 'src/util.js';
const MORE_REL = 'src/more.js';
const LOCK_REL = '.necro/lock.json';

const HEAD = `import { test } from 'node:test';
import assert from 'node:assert/strict';
`;

// Contract file a: two contracts that use project sources, so the receipt pins those sources.
const A = `${HEAD}import { doubleThenTriple } from '../../src/util.js';
test('R6.7 first contract', () => { assert.equal(doubleThenTriple(2), 12); });
test('R6.7 second contract', () => { assert.ok(true); });
`;
// Contract file b: passes while data.json says 1. data.json is not pinned by the receipt.
const B = `${HEAD}import fs from 'node:fs';
test('R6.7 data contract', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../../data.json', import.meta.url), 'utf8'));
  assert.equal(data.value, 1);
});
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

// A frozen spec with a genuine receipt made by `necro check`. Returns the receipt's path and content.
function setup(cwd) {
  put(cwd, REQ_REL, REQ);
  put(cwd, A_REL, A);
  put(cwd, B_REL, B);
  put(cwd, UTIL_REL, UTIL);
  put(cwd, MORE_REL, MORE);
  put(cwd, 'data.json', '{"value": 1}\n');
  const frozen = necro(cwd, ['freeze', 'demo']);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
  const checked = necro(cwd, ['check', 'demo']);
  assert.equal(checked.status, 0, `check failed: ${checked.stdout}${checked.stderr}`);
  const rel = /Receipt: (\S+)/.exec(checked.stdout)[1];
  return { rel, receipt: JSON.parse(fs.readFileSync(path.join(cwd, rel), 'utf8')) };
}

function verify(cwd, rel) {
  return necro(cwd, ['verify', rel]);
}

// Writes a copy of the receipt with `edit` applied. With rehash, receiptHash is made correct for the new content, so
// only the checks against the lock and the files can catch the change.
function forge(cwd, receipt, edit, { rehash = true } = {}) {
  const copy = structuredClone(receipt);
  edit(copy);
  if (rehash) {
    const { receiptHash: _hash, createdAt: _at, ...rest } = copy;
    copy.receiptHash = sha(canon(rest));
  }
  put(cwd, 'forged.json', `${JSON.stringify(copy, null, 2)}\n`);
  return 'forged.json';
}

function assertMismatch(res, label) {
  assert.equal(res.status, 1, `${label}: expected exit 1, got ${res.status}. ${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /MISMATCH/, label);
  assert.doesNotMatch(res.stdout, /CONFIRMED/, label);
}

test('R6.1 verify prints CONFIRMED and the receipt hash and exits 0 when every hashed file matches and the contracts give the same results', () =>
  temp((cwd) => {
    const { rel, receipt } = setup(cwd);
    const res = verify(cwd, rel);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /CONFIRMED/);
    assert.ok(res.stdout.includes(receipt.receiptHash), `prints the receipt hash: ${res.stdout}`);
    assert.doesNotMatch(res.stdout, /MISMATCH/);
    // An absolute path to the receipt works as well.
    assert.equal(verify(cwd, path.join(cwd, rel)).status, 0);
  }));

test('R6.2 verify prints MISMATCH with each differing path and exits 1 when a hashed file differs', () =>
  temp((cwd) => {
    const { rel } = setup(cwd);

    // An imported source file changed.
    fs.appendFileSync(path.join(cwd, UTIL_REL), '// changed\n');
    const one = verify(cwd, rel);
    assertMismatch(one, 'source changed');
    assert.ok(one.stdout.includes(UTIL_REL), one.stdout);
    assert.ok(!one.stdout.includes(MORE_REL), 'an unchanged file is not named');

    // Every differing path is named: a changed requirements file, a changed contract file, a deleted source.
    fs.appendFileSync(path.join(cwd, REQ_REL), 'changed\n');
    fs.appendFileSync(path.join(cwd, B_REL), '// changed\n');
    fs.rmSync(path.join(cwd, MORE_REL));
    const many = verify(cwd, rel);
    assertMismatch(many, 'several files changed');
    for (const p of [UTIL_REL, MORE_REL, REQ_REL, B_REL]) assert.ok(many.stdout.includes(p), `${p} is named: ${many.stdout}`);
    assert.ok(!many.stdout.includes(A_REL), 'an unchanged contract file is not named');
  }));

test('R6.3 verify prints MISMATCH with each differing contract name and exits 1 when a contract result differs', () =>
  temp((cwd) => {
    const { rel, receipt } = setup(cwd);
    assert.ok(receipt.contracts.every((c) => c.result === 'pass'));

    // The unpinned data file changes, so one contract now fails while every pinned file is the same.
    put(cwd, 'data.json', '{"value": 2}\n');
    const res = verify(cwd, rel);
    assertMismatch(res, 'result changed');
    assert.ok(res.stdout.includes('R6.7 data contract'), res.stdout);
    assert.ok(!res.stdout.includes('R6.7 first contract'), 'a contract whose result is the same is not named');
  }));

test('R6.4 verify first recomputes the receiptHash and prints MISMATCH saying the receipt was altered when it differs', () =>
  temp((cwd) => {
    const { rel, receipt } = setup(cwd);
    const edits = {
      'a source hash': (r) => { r.sources[0].sha256 = 'f'.repeat(64); },
      'a result': (r) => { r.contracts[0].result = r.contracts[0].result === 'pass' ? 'fail' : 'pass'; },
      'the spec name': (r) => { r.spec = 'other'; },
      'the receiptHash itself': (r) => { r.receiptHash = '0'.repeat(64); },
    };
    for (const [label, edit] of Object.entries(edits)) {
      const res = verify(cwd, forge(cwd, receipt, edit, { rehash: false }));
      assertMismatch(res, label);
      assert.match(res.stdout, /receipt/i, label);
      assert.match(res.stdout, /altered/i, label);
    }
    // createdAt is not part of the hash, so changing it is not an alteration.
    const fine = verify(cwd, forge(cwd, receipt, (r) => { r.createdAt = '1999-01-01T00:00:00.000Z'; }, { rehash: false }));
    assert.equal(fine.status, 0, `${fine.stdout}${fine.stderr}`);
    assert.ok(fs.existsSync(path.join(cwd, rel)));
  }));

test('R6.5 verify prints MISMATCH and exits 1 for a receipt that pins no requirements file or no contracts', () =>
  temp((cwd) => {
    const { receipt } = setup(cwd);
    // The hash is made correct for each edit, so the receipt is rejected for what it lacks.
    const edits = {
      'no requirements key': (r) => { delete r.requirements; },
      'requirements null': (r) => { r.requirements = null; },
      'empty contracts': (r) => { r.contracts = []; },
      'no contracts key': (r) => { delete r.contracts; },
    };
    for (const [label, edit] of Object.entries(edits)) {
      assertMismatch(verify(cwd, forge(cwd, receipt, edit)), label);
    }

    // The same without a lock, where nothing else could catch it: a receipt with nothing pinned must not be confirmed.
    fs.rmSync(path.join(cwd, '.necro', 'lock.json'));
    assert.equal(verify(cwd, forge(cwd, receipt, () => {})).status, 0, 'the unedited receipt is confirmed without a lock');
    for (const [label, edit] of Object.entries(edits)) {
      assertMismatch(verify(cwd, forge(cwd, receipt, edit)), `${label}, no lock`);
    }
  }));

test('R6.6 when the spec is frozen in the local lock verify also checks the receipt\'s requirements and contract hashes against it', () =>
  temp((cwd) => {
    const { rel } = setup(cwd);
    const lockFile = path.join(cwd, LOCK_REL);
    const original = fs.readFileSync(lockFile, 'utf8');
    const bogus = `deadbeef${'0'.repeat(56)}`;

    // The lock has another requirements hash than the receipt. The files on disk still match the receipt.
    const lock = JSON.parse(original);
    lock.specs.demo.requirements.sha256 = bogus;
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
    const req = verify(cwd, rel);
    assertMismatch(req, 'requirements hash');
    assert.ok(req.stdout.includes(REQ_REL), req.stdout);

    // The lock has another hash for one contract file.
    const lock2 = JSON.parse(original);
    lock2.specs.demo.contracts.find((c) => c.path === A_REL).sha256 = bogus;
    fs.writeFileSync(lockFile, JSON.stringify(lock2, null, 2));
    const contract = verify(cwd, rel);
    assertMismatch(contract, 'contract hash');
    assert.ok(contract.stdout.includes(A_REL), contract.stdout);
    assert.ok(!contract.stdout.includes(B_REL), 'the contract file that agrees is not named');

    // With the lock as it was, the receipt is confirmed.
    fs.writeFileSync(lockFile, original);
    assert.equal(verify(cwd, rel).status, 0);
  }));

test('R6.7 when a lock exists verify requires the receipt to equal the lock exactly and runs the lock\'s contracts, so a receipt that leaves out a failing contract is a MISMATCH', () =>
  temp((cwd) => {
    const { rel, receipt } = setup(cwd);
    const lockFile = path.join(cwd, LOCK_REL);
    const lockText = fs.readFileSync(lockFile, 'utf8');
    const forged = (edit) => verify(cwd, forge(cwd, receipt, edit));
    const firstOfA = (r) => r.contracts.find((c) => c.path === A_REL);

    assert.equal(verify(cwd, rel).status, 0, 'the genuine receipt is confirmed');

    // A receipt that leaves out one of the lock's contract files.
    const noFile = forged((r) => { r.contracts = r.contracts.filter((c) => c.path !== B_REL); });
    assertMismatch(noFile, 'file left out');
    assert.ok(noFile.stdout.includes(B_REL), noFile.stdout);

    // A receipt that leaves out one contract of a file.
    const noContract = forged((r) => { r.contracts = r.contracts.filter((c) => c.name !== 'R6.7 second contract'); });
    assertMismatch(noContract, 'contract left out');
    assert.ok(noContract.stdout.includes('R6.7 second contract'), noContract.stdout);

    // A receipt that adds a contract the lock lacks, even when it records a failure.
    const added = forged((r) => { r.contracts.push({ ...firstOfA(r), name: 'R6.7 invented contract', result: 'fail' }); });
    assertMismatch(added, 'contract added');
    assert.ok(added.stdout.includes('R6.7 invented contract'), added.stdout);

    // A receipt that adds a contract file the lock lacks.
    put(cwd, 'contracts/demo/extra.contract.test.js', `${HEAD}test('R6.7 extra file contract', () => {});\n`);
    const extra = forged((r) => {
      r.contracts.push({
        name: 'R6.7 extra file contract',
        path: 'contracts/demo/extra.contract.test.js',
        sha256: sha(fs.readFileSync(path.join(cwd, 'contracts/demo/extra.contract.test.js'))),
        result: 'pass',
      });
    });
    assertMismatch(extra, 'file added');
    assert.ok(extra.stdout.includes('contracts/demo/extra.contract.test.js'), extra.stdout);

    // A receipt that changes a recorded name.
    const renamed = forged((r) => { r.contracts.find((c) => c.name === 'R6.7 first contract').name = 'R6.7 first contract (renamed)'; });
    assertMismatch(renamed, 'name changed');
    assert.ok(renamed.stdout.includes('R6.7 first contract'), renamed.stdout);

    // A receipt for a spec that is not in the lock.
    const otherSpec = forged((r) => { r.spec = 'other'; });
    assertMismatch(otherSpec, 'spec not in the lock');
    assert.ok(otherSpec.stdout.includes('other'), otherSpec.stdout);

    // A lock with no specs at all is still a lock.
    fs.writeFileSync(lockFile, JSON.stringify({ specs: {} }));
    assertMismatch(verify(cwd, rel), 'empty lock');
    fs.writeFileSync(lockFile, lockText);

    // The lock's contracts are run, not the receipt's list: a contract file now fails, and a receipt that hides it is refused.
    put(cwd, 'data.json', '{"value": 2}\n');
    const hidden = forged((r) => { r.contracts = r.contracts.filter((c) => c.path !== B_REL); });
    assertMismatch(hidden, 'failing file hidden');
    assert.ok(hidden.stdout.includes(B_REL), hidden.stdout);
    const honest = verify(cwd, rel);
    assertMismatch(honest, 'honest receipt, contract fails now');
    assert.ok(honest.stdout.includes('R6.7 data contract'), honest.stdout);
  }));
