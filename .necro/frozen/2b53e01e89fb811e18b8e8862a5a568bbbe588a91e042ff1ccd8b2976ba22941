// Contracts for Requirements 13.17, 13.18 and 15.11 of the necro-core spec: freeze the assertions, copy the results.
//
// R13.17  WHEN a JavaScript contract file runs THE SYSTEM SHALL, before any contract or source module loads, freeze the
//         exports of `node:assert`, `node:assert/strict` and `node:test` (the module objects and their function
//         properties), so code under test cannot replace an assertion to make a contract pass; an attempt SHALL make the
//         contract fail.
// R13.18  WHEN `plain()` meets an `Error` or a `RegExp` THE SYSTEM SHALL return a fresh built-in copy (message and name, or
//         source and flags, read through built-in getters), never the caller's object.
// R15.11  WHEN a guarded function returns THE SYSTEM SHALL take one copy of the result (`structuredClone`), run every check
//         on that copy and return that same copy to the caller, so a result with accessors or a Proxy cannot show the check
//         one value and the caller another; a result that cannot be copied SHALL fail the check with a plain reason.
//
// They come from an automated security review of task 39. Every test uses the real modules and the real contract runner, on
// projects in temporary folders; the one test that needs the Pumpkin Ledger runs it from a copy and never freezes it. This
// file carries its own helpers.
//
// The receipt pins the files this test exercises. Keep these lines, necro reads `from '...'` text:
//   from '../../src/contracts.js'
//   from '../../src/contract-runner.js'
//   from '../../src/plain.js'
//   from '../../src/runtime.js'
//   from '../../src/lock.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { freezeSpec, readLock } from '../../src/lock.js';
import { runContracts } from '../../src/contracts.js';
import { plain } from '../../src/plain.js';
import { guard, ContractViolation } from '../../src/runtime.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const EXAMPLE = path.join(REPO, 'examples', 'pumpkin-ledger');
const PLAIN_URL = pathToFileURL(path.join(REPO, 'src', 'plain.js')).href;

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  delete env.NO_COLOR;
  return env;
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: cleanEnv(), timeout: 280_000 });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

const made = [];
function temp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function put(dir, rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// A project with one spec called "cheat": files under src/ and one contract file, frozen with the contract as a person
// freezes it, in a temporary folder. `before` are the sources as they are when the spec is frozen, `sources` the sources the
// agent writes afterwards, while it works on the task.
function project({ before = {}, sources = {}, contract }) {
  const dir = temp('necro-cheats2-contract-');
  put(dir, '.kiro/specs/cheat/requirements.md', '# Cheat\n\n## Requirement 1\n### Acceptance criteria\n1. THE SYSTEM SHALL do the impossible.\n');
  put(dir, 'package.json', '{"type":"module"}\n');
  put(dir, 'contracts/cheat/cheat.contract.test.js', contract);
  for (const [rel, text] of Object.entries(before)) put(dir, rel, text);
  freezeSpec(dir, 'cheat');
  for (const [rel, text] of Object.entries(sources)) put(dir, rel, text);
  return dir;
}

// What necro reports for the contract file: the results of runContracts, which every check, gate and verify uses.
function necroResults(dir) {
  return runContracts(dir, 'cheat', readLock(dir));
}

// What the same contract file does when a plain `node --test` runs it, without the flag and the preload, as the cheating
// agent saw it.
function bareRun(dir) {
  return run(process.execPath, ['--test', 'contracts/cheat/cheat.contract.test.js'], dir);
}

// ---------------------------------------------------------------------------------------------------------------------
// R13.17: the assertion modules are frozen before any contract or source module loads
// ---------------------------------------------------------------------------------------------------------------------

test('R13.17 the exports of node:assert, node:assert/strict and node:test are frozen, with their function properties, when a contract file runs', () => {
  const probe = `import { test } from 'node:test';
import testDefault from 'node:test';
import legacy from 'node:assert';
import strict from 'node:assert/strict';
import assert from 'node:assert/strict';

test('R1.1 the module objects and the assertions are frozen', () => {
  for (const mod of [legacy, strict, testDefault]) assert.ok(Object.isFrozen(mod));
  for (const mod of [legacy, strict]) {
    for (const name of ['ok', 'equal', 'strictEqual', 'deepStrictEqual', 'notEqual', 'throws', 'rejects', 'match']) {
      assert.ok(Object.isFrozen(mod[name]), name);
    }
  }
  for (const name of ['test', 'describe', 'it', 'before', 'after']) assert.ok(Object.isFrozen(testDefault[name]), name);
});

test('R1.2 an assertion cannot be replaced', () => {
  for (const mod of [legacy, strict]) {
    assert.throws(() => { mod.ok = () => {}; }, TypeError);
    assert.throws(() => { mod.equal = () => {}; }, TypeError);
    assert.throws(() => { mod.strictEqual = () => {}; }, TypeError);
    assert.throws(() => Object.defineProperty(mod, 'ok', { value: () => {} }), TypeError);
  }
});
`;
  const dir = project({ contract: probe });
  const bare = bareRun(dir);
  assert.notEqual(bare.status, 0, 'a plain node --test must not freeze the modules, or this probe proves nothing');
  const results = necroResults(dir);
  assert.deepEqual(results.map((r) => [r.name, r.result]), [
    ['R1.1 the module objects and the assertions are frozen', 'pass'],
    ['R1.2 an assertion cannot be replaced', 'pass'],
  ]);
});

// An impossible contract: one equals two. Only code that makes the assertions do nothing can pass it.
const IMPOSSIBLE = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import legacy from 'node:assert';
import '../../src/patch.PATCH_EXT';

test('R1.1 one equals two', () => {
  assert.equal(1, 2);
  assert.strictEqual(1, 2);
  assert.ok(false);
  legacy.equal(1, 2);
  legacy.ok(false);
});
`;

const NO_OP_PATCHES = {
  'a plain assignment': ['js', `import assert from 'node:assert';
import strict from 'node:assert/strict';
for (const a of [assert, strict]) {
  a.ok = () => {};
  a.equal = () => {};
  a.strictEqual = () => {};
}
export const x = 1;
`],
  'Object.defineProperty': ['js', `import assert from 'node:assert';
import strict from 'node:assert/strict';
for (const a of [assert, strict]) {
  for (const name of ['ok', 'equal', 'strictEqual']) Object.defineProperty(a, name, { value: () => {}, configurable: true, writable: true });
}
export const x = 1;
`],
  'Object.assign on the module a require returns': ['js', `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
Object.assign(require('assert'), { ok() {}, equal() {}, strictEqual() {} });
Object.assign(require('node:assert/strict'), { ok() {}, equal() {}, strictEqual() {} });
export const x = 1;
`],
  'a CommonJS file in sloppy mode, where the write fails without an error': ['cjs', `const assert = require('node:assert');
const strict = require('node:assert/strict');
for (const a of [assert, strict]) {
  a.ok = function () {};
  a.equal = function () {};
  a.strictEqual = function () {};
}
module.exports = { x: 1 };
`],
};

for (const [label, [ext, source]] of Object.entries(NO_OP_PATCHES)) {
  test(`R13.17 source code that sets assert.ok, assert.equal and assert.strictEqual to a no-op makes its contract fail, not pass (${label})`, () => {
    const before = { [`src/patch.${ext}`]: ext === 'cjs' ? 'module.exports = { x: 1 };\n' : 'export const x = 1;\n' };
    const dir = project({ before, sources: { [`src/patch.${ext}`]: source }, contract: IMPOSSIBLE.replace('PATCH_EXT', ext) });
    // As the cheating agent saw it: the impossible contract passes.
    const bare = bareRun(dir);
    assert.equal(bare.status, 0, `${bare.stdout}${bare.stderr}`);
    // Under necro the assertions stay what they are, so the contract fails.
    const results = necroResults(dir);
    assert.ok(results.length > 0);
    assert.ok(results.every((r) => r.result === 'fail'), JSON.stringify(results));
  });
}

test('R13.17 source code that replaces a function of node:test makes its contract fail, not pass', () => {
  const contract = `import { test } from 'node:test';
import '../../src/patch.js';
test('R1.1 fine', () => {});
`;
  const dir = project({
    before: { 'src/patch.js': 'export const x = 1;\n' },
    sources: { 'src/patch.js': "import t from 'node:test';\nt.it = () => {};\nt.describe = () => {};\nexport const x = 1;\n" },
    contract,
  });
  assert.equal(bareRun(dir).status, 0, 'the patch works without necro');
  const results = necroResults(dir);
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.result === 'fail'), JSON.stringify(results));
});

test('R13.17 an honest contract that uses describe, it, hooks, mock and the assertions still passes, and a wrong value still fails', () => {
  const contract = `import { test, describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import legacy from 'node:assert';

describe('R1.1 a suite', () => {
  const log = [];
  before(() => log.push('before'));
  beforeEach(() => log.push('each'));
  it('R1.1 first', () => { assert.deepStrictEqual(log, ['before', 'each']); });
});

test('R1.2 rejects, throws, match and mock work', async (t) => {
  await assert.rejects(Promise.reject(new Error('x')), /x/);
  assert.throws(() => { throw new RangeError('y'); }, RangeError);
  assert.match('abc', /b/);
  legacy.equal(1, 1);
  const fn = t.mock.fn(() => 2);
  assert.equal(fn(), 2);
  assert.equal(mock.fn(() => 3)(), 3);
});

test('R1.3 a wrong value fails', () => {
  assert.equal(1, 2);
});
`;
  const dir = project({ contract });
  const results = necroResults(dir);
  assert.deepEqual(results.map((r) => [r.name, r.result]), [
    ['R1.1 first', 'pass'],
    ['R1.2 rejects, throws, match and mock work', 'pass'],
    ['R1.3 a wrong value fails', 'fail'],
  ]);
});

// ---------------------------------------------------------------------------------------------------------------------
// R13.18: plain() returns a fresh built-in copy of an Error or a RegExp
// ---------------------------------------------------------------------------------------------------------------------

test('R13.18 plain() returns a new built-in Error with the message and name of the one given, never that object', () => {
  const trap = () => {
    throw new Error('a method of the error ran');
  };
  const e = new TypeError('disk full');
  e.toString = trap;
  const copy = plain(e);
  assert.notEqual(copy, e);
  assert.equal(Object.getPrototypeOf(copy), TypeError.prototype);
  assert.equal(copy.message, 'disk full');
  assert.equal(copy.name, 'TypeError');
  assert.equal(String(copy), 'TypeError: disk full');

  // A getter is read once, so the copy cannot show a second value later.
  let reads = 0;
  const shifty = new Error('x');
  Object.defineProperty(shifty, 'message', { get() { return reads++ === 0 ? 'first' : 'later'; } });
  const fixed = plain(shifty);
  assert.equal(fixed.message, 'first');
  assert.equal(fixed.message, 'first');
  assert.equal(reads, 1);
});

test('R13.18 plain() returns a new built-in RegExp with the source and flags of the one given, never that object', () => {
  class Lying extends RegExp {
    test() { return false; }
    exec() { return null; }
    get source() { return 'evil'; }
    get flags() { return 'm'; }
  }
  const lying = new Lying('danger', 'gi');
  const copy = plain(lying);
  assert.notEqual(copy, lying);
  assert.equal(Object.getPrototypeOf(copy), RegExp.prototype);
  assert.equal(copy.source, 'danger');
  assert.equal(copy.flags, 'gi');
  assert.equal(copy.test('DANGER'), true);

  const plainRe = /a+/y;
  assert.notEqual(plain(plainRe), plainRe);
});

// Two cheats that fool a contract which asks the object to describe itself, and a contract that compares plain(result).
// The honest version is what the spec is frozen with; the lying one replaces it.
const HONEST_SOURCES = {
  'src/pattern.js': `export function dangerPattern() {
  return /danger/;
}
export function failure() {
  return new Error('disk full');
}
`,
};
const LYING_SOURCES = {
  'src/pattern.js': `// The pattern is meant to catch the word danger. It does not, but its test() says it matches.
export function dangerPattern() {
  const re = /safe/;
  re.test = () => true;
  return re;
}
// The error says disk full. Its toString says all is well.
export function failure() {
  const e = new Error('all is well');
  e.toString = () => 'Error: disk full';
  return e;
}
`,
};

function lyingContract({ usePlain }) {
  const wrap = (expr) => (usePlain ? `plain(${expr})` : expr);
  return `import { test } from 'node:test';
import assert from 'node:assert/strict';
${usePlain ? `import { plain } from ${JSON.stringify(PLAIN_URL)};\n` : ''}import { dangerPattern, failure } from '../../src/pattern.js';

test('R1.1 the pattern matches danger', () => {
  assert.equal(${wrap('dangerPattern()')}.test('danger'), true);
});

test('R1.2 the error reads disk full', () => {
  assert.equal(String(${wrap('failure()')}), 'Error: disk full');
});
`;
}

test('R13.18 a contract that asks a lying RegExp or Error to describe itself passes; one that compares plain(result) fails', () => {
  const fooled = project({ before: HONEST_SOURCES, sources: LYING_SOURCES, contract: lyingContract({ usePlain: false }) });
  assert.deepEqual(necroResults(fooled).map((r) => r.result), ['pass', 'pass'], 'the cheats should pass without plain()');

  const checked = project({ before: HONEST_SOURCES, sources: LYING_SOURCES, contract: lyingContract({ usePlain: true }) });
  assert.deepEqual(necroResults(checked).map((r) => r.result), ['fail', 'fail']);
});

// ---------------------------------------------------------------------------------------------------------------------
// R15.11: the check and the caller get one and the same copy of the result
// ---------------------------------------------------------------------------------------------------------------------

test('R15.11 a result with a getter cannot show the check one value and the caller another', () => {
  let reads = 0;
  const guarded = guard(
    { total: () => ({ get n() { return reads++ === 0 ? 6 : 7; } }) },
    { total: { criterion: 'R11.1', check: (args, result) => result.n === 6 || `n is ${result.n}` } },
  );
  const out = guarded.total();
  assert.equal(out.n, 6);
  assert.equal(out.n, 6, 'the second read gives what the check saw');
});

test('R15.11 every check and the caller get the same copy of the result, which is not the object the function returned', () => {
  const original = { rows: [{ n: 1 }], when: new Date(9), by: new Map([['k', [1]]]) };
  const seen = [];
  const guarded = guard(
    { f: () => original },
    { f: [{ criterion: 'R11.2', check: (a, r) => { seen.push(r); return true; } }, { criterion: 'R11.3', check: (a, r) => { seen.push(r); return true; } }] },
  );
  const out = guarded.f();
  assert.equal(seen.length, 2);
  assert.ok(seen[0] === out && seen[1] === out);
  assert.notEqual(out, original);
  assert.notEqual(out.rows[0], original.rows[0]);
  assert.deepEqual(out, original);
  original.rows[0].n = 2;
  assert.equal(out.rows[0].n, 1, 'a change to the original after the check does not reach the caller');
});

test('R15.11 a Proxy result or a result that cannot be copied fails the check with a plain reason, and no check runs on it', () => {
  let ran = 0;
  const check = { criterion: 'R11.4', check: () => { ran++; return true; } };
  const proxy = guard({ f: () => new Proxy({ n: 1 }, {}) }, { f: check });
  const holder = guard({ f: () => ({ run() { return 1; } }) }, { f: check });
  for (const call of [() => proxy.f(), () => holder.f()]) {
    assert.throws(call, (e) => e instanceof ContractViolation && e.criterion === 'R11.4' && /R11\.4 f: /.test(e.message) && /cannot be copied/.test(e.reason) && !/DataCloneError/.test(e.message));
  }
  assert.equal(ran, 0);
});

// A computeBalances whose rows show the true balance to anything called from postconditions.js and a wrong one to everyone
// else: Dee's balance is 1.00 too high and Cy's 1.00 too low, so the balances still add up to zero.
function liedBalances(dir) {
  const file = path.join(dir, 'src', 'balances.js');
  const text = fs.readFileSync(file, 'utf8');
  const from = 'return { name: p.name, paid: paidCents, share: shareCents, balance: paidCents - shareCents };';
  assert.ok(text.includes(from));
  const to = `const row = { name: p.name, paid: paidCents, share: shareCents };
    const lie = p.name === 'Dee' ? 100 : p.name === 'Cy' ? -100 : 0;
    Object.defineProperty(row, 'balance', {
      enumerable: true,
      get() { return new Error().stack.includes('postconditions.js') ? paidCents - shareCents : paidCents - shareCents + lie; },
    });
    return row;`;
  fs.writeFileSync(file, text.replace(from, () => to));
}

test('R15.11 a computeBalances whose rows show the check the true balance and the caller a false one is stopped: bin/ledger.js exits 1 with a ContractViolation', () => {
  const honest = temp('necro-cheats2-honest-');
  fs.cpSync(EXAMPLE, honest, { recursive: true });
  const good = run(process.execPath, ['bin/ledger.js', 'party.txt'], honest);
  assert.equal(good.status, 0, good.stderr);

  const dir = temp('necro-cheats2-example-');
  fs.cpSync(EXAMPLE, dir, { recursive: true });
  liedBalances(dir);
  const res = run(process.execPath, ['bin/ledger.js', 'party.txt'], dir);
  assert.equal(res.status, 1, `it printed ${res.stdout}`);
  assert.match(res.stderr, /ContractViolation: R2\.\d computeBalances/, res.stderr);
  assert.equal(res.stdout, '');
});
