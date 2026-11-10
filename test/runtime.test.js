import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Runtime postconditions (Req 15): guard(exports, postconditions) in src/runtime.js, and the Pumpkin Ledger example that
// applies it in bin/ledger.js.

const REPO = path.resolve(import.meta.dirname, '..');
const BIN = path.join(REPO, 'bin', 'necro.js');
const RUNTIME = path.join(REPO, 'src', 'runtime.js');
const EXAMPLE = path.join(REPO, 'examples', 'pumpkin-ledger');

// The test runner sets NODE_TEST_* variables. A child process must not see them unless a test sets them.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

async function load() {
  return import('../src/runtime.js');
}

const sums = { criterion: 'R9.1', check: (args, result) => result === args[0] + args[1] || `expected ${args[0] + args[1]}, got ${result}` };

// ---------------------------------------------------------------------------
// 15.1 guard wraps, checks, and throws ContractViolation naming the criterion
// ---------------------------------------------------------------------------

test('R15.1 guard returns the exports with each function named in postconditions wrapped, and every other export untouched', async () => {
  const { guard } = await load();
  const add = (a, b) => a + b;
  const other = (x) => x;
  const exports = Object.freeze({ add, other, LIMIT: 3 });
  const guarded = guard(exports, { add: sums });
  assert.notEqual(guarded.add, add, 'add is wrapped');
  assert.equal(guarded.other, other);
  assert.equal(guarded.LIMIT, 3);
  assert.equal(guarded.add(2, 3), 5);
  assert.equal(exports.add, add, 'the exports given are not changed');
});

test('R15.1 guard works on a module namespace object, which cannot be changed', async () => {
  const { guard } = await load();
  const ns = await import('../examples/pumpkin-ledger/src/money.js');
  const guarded = guard(ns, { formatCents: { criterion: 'R9.2', check: (args, result) => typeof result === 'string' } });
  assert.equal(guarded.formatCents(1250), '12.50');
  assert.equal(guarded.parseAmount, ns.parseAmount);
});

test('R15.1 every call runs the check with (args, result) after the function returns, and returns the result itself', async () => {
  const { guard } = await load();
  const seen = [];
  const order = [];
  const make = () => {
    const box = { v: 1 };
    return box;
  };
  const guarded = guard(
    {
      make: (...a) => {
        order.push('run');
        return make(a);
      },
    },
    { make: { criterion: 'R9.3', check: (args, result) => { order.push('check'); seen.push([args, result]); return true; } } },
  );
  const a = guarded.make(1, 'two');
  const b = guarded.make();
  assert.deepEqual(order, ['run', 'check', 'run', 'check']);
  assert.deepEqual(seen[0][0], [1, 'two']);
  assert.equal(seen[0][1], a, 'the check sees the very result returned');
  assert.deepEqual(seen[1][0], []);
  assert.equal(seen[1][1], b);
});

test('R15.1 a check that returns anything but true makes the call throw a ContractViolation that names the criterion and the reason', async () => {
  const { guard, ContractViolation } = await load();
  for (const verdict of [false, undefined, null, 0, 1, 'the sum is wrong', { ok: true }, 'true']) {
    const guarded = guard({ f: () => 1 }, { f: { criterion: 'R5.1', check: () => verdict } });
    let thrown;
    try {
      guarded.f();
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ContractViolation, `verdict ${JSON.stringify(verdict)} gave ${thrown}`);
    assert.ok(thrown instanceof Error);
    assert.equal(thrown.name, 'ContractViolation');
    assert.match(thrown.message, /\bR5\.1\b/);
    assert.match(thrown.message, /\bf\b/, 'it names the function');
    assert.equal(thrown.criterion, 'R5.1');
    if (typeof verdict === 'string' && verdict !== 'true') assert.ok(thrown.message.includes(verdict), thrown.message);
    else assert.ok(thrown.reason.length > 0, 'a plain reason when the check gives none');
  }
});

test('R15.1 only the exact value true passes', async () => {
  const { guard } = await load();
  const guarded = guard({ f: () => 'result' }, { f: { criterion: 'R5.1', check: () => true } });
  assert.equal(guarded.f(), 'result');
});

test('R15.1 a check that throws is a violation too, and a function that throws passes its own error through', async () => {
  const { guard, ContractViolation } = await load();
  const broken = guard({ f: () => 1 }, { f: { criterion: 'R5.2', check: () => { throw new TypeError('bad shape'); } } });
  assert.throws(() => broken.f(), (e) => e instanceof ContractViolation && /R5\.2/.test(e.message) && /bad shape/.test(e.message));
  const own = new RangeError('mine');
  const failing = guard({ f: () => { throw own; } }, { f: { criterion: 'R5.3', check: () => true } });
  assert.throws(() => failing.f(), (e) => e === own);
});

test('R15.1 several checks for one function may be given as a list and all must hold, in order', async () => {
  const { guard } = await load();
  const guarded = guard(
    { f: (n) => n },
    { f: [{ criterion: 'R1.1', check: (args, r) => r > 0 || 'not positive' }, { criterion: 'R1.2', check: (args, r) => r < 10 || 'too big' }] },
  );
  assert.equal(guarded.f(5), 5);
  assert.throws(() => guarded.f(-1), /R1\.1.*not positive/);
  assert.throws(() => guarded.f(50), /R1\.2.*too big/);
});

test('R15.1 a postcondition that names something the module does not export, or is not well formed, is refused when the guard is built', async () => {
  const { guard } = await load();
  assert.throws(() => guard({ a: () => 1 }, { b: sums }), /\bb\b/);
  assert.throws(() => guard({ a: 5 }, { a: sums }), /\ba\b/);
  assert.throws(() => guard({ a: () => 1 }, { a: { criterion: 'R1.1' } }), /\ba\b/);
  assert.throws(() => guard({ a: () => 1 }, { a: { check: () => true } }), /\ba\b/);
  assert.throws(() => guard({ a: () => 1 }, { a: { criterion: '', check: () => true } }), /\ba\b/);
});

// ---------------------------------------------------------------------------
// 15.2 the same with or without a test runner, and no environment variable is read
// ---------------------------------------------------------------------------

test('R15.2 src/runtime.js reads no environment variable and does not look at the process at all', () => {
  const source = fs.readFileSync(RUNTIME, 'utf8');
  const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\bprocess\b/);
  assert.doesNotMatch(code, /\benv\b/i);
  assert.doesNotMatch(code, /NODE_TEST/);
  assert.doesNotMatch(code, /\bimport\b/, 'no import, so nothing else can change what it does');
});

test('R15.2 guard gives the same verdicts when a test runner is present and when it is not', () => {
  const script = `
    import { guard } from ${JSON.stringify(RUNTIME)};
    const g = guard({ f: (n) => n }, { f: { criterion: 'R7.1', check: (a, r) => r === 1 || 'not one' } });
    const out = [];
    for (const n of [1, 2]) { try { out.push(g.f(n)); } catch (e) { out.push(e.name + ': ' + e.message); } }
    console.log(JSON.stringify(out));
  `;
  const run = (extra) => spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...cleanEnv(), ...extra } });
  const plain = run({});
  const runner = run({ NODE_TEST_CONTEXT: 'child-v8' });
  const odd = run({ NODE_TEST_CONTEXT: '', NODE_ENV: 'test', CI: 'true' });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(runner.stdout, plain.stdout);
  assert.equal(odd.stdout, plain.stdout);
  assert.deepEqual(JSON.parse(plain.stdout), [1, 'ContractViolation: R7.1 f: not one']);
});

// ---------------------------------------------------------------------------
// 15.4 the Pumpkin Ledger example
// ---------------------------------------------------------------------------

test('R15.4 the example carries a copy of src/runtime.js that is byte for byte the same, so the example runs on its own', () => {
  const vendored = path.join(EXAMPLE, 'src', 'runtime.js');
  assert.ok(fs.existsSync(vendored), 'examples/pumpkin-ledger/src/runtime.js');
  assert.equal(fs.readFileSync(vendored, 'utf8'), fs.readFileSync(RUNTIME, 'utf8'));
});

// A copy of the example, as the demo makes it.
function exampleCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-runtime-'));
  fs.cpSync(EXAMPLE, dir, { recursive: true });
  return dir;
}

function node(cwd, args, extra = {}) {
  const res = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...cleanEnv(), ...extra }, timeout: 240_000 });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// The reproduction from the review: base is floored, and the extra cents are kept only under the test runner.
function plantRunnerSwitch(dir) {
  const file = path.join(dir, 'src', 'split.js');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('const extra = cents % n;'));
  fs.writeFileSync(file, text.replace('const extra = cents % n;', 'const extra = process.env.NODE_TEST_CONTEXT ? cents % n : 0;'));
}

test('R15.4 code that special-cases the test runner passes every contract, yet bin/ledger.js exits 1 with a ContractViolation that names the criterion', () => {
  const dir = exampleCopy();
  try {
    const good = node(dir, ['bin/ledger.js', 'party.txt']);
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /All square|pays/);

    plantRunnerSwitch(dir);
    const checked = node(dir, [BIN, 'check', 'ledger']);
    assert.equal(checked.status, 0, `the contracts should pass: ${checked.stdout}${checked.stderr}`);
    assert.match(checked.stdout, /All \d+ contracts pass\./);

    const bad = node(dir, ['bin/ledger.js', 'party.txt']);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /ContractViolation/);
    assert.match(bad.stderr, /\bR(?:2\.1|5\.1)\b/);
    assert.equal(bad.stdout, '', 'it prints no balances it cannot stand behind');
    // Under the test runner the same code is right, which is how the contracts were fooled.
    const fooled = node(dir, ['bin/ledger.js', 'party.txt'], { NODE_TEST_CONTEXT: 'child-v8' });
    assert.equal(fooled.status, 0, fooled.stderr);
    assert.equal(fooled.stdout, good.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R15.4 the example has postconditions for splitExpense, computeBalances and settle, applied by bin/ledger.js; R15.7 adds the two reports and R15.10 parseLedger', async () => {
  const post = await import('../examples/pumpkin-ledger/contracts/ledger/postconditions.js');
  const names = Object.values(post).flatMap((table) => Object.keys(table));
  assert.deepEqual([...names].sort(), ['computeBalances', 'parseLedger', 'renderJson', 'renderText', 'settle', 'splitExpense']);
  const bin = fs.readFileSync(path.join(EXAMPLE, 'bin', 'ledger.js'), 'utf8');
  assert.match(bin, /postconditions\.js/);
  assert.match(bin, /guard\(/);
  const runners = JSON.parse(fs.readFileSync(path.join(EXAMPLE, '.kiro', 'specs', 'ledger', 'runners.json'), 'utf8'));
  assert.ok(runners.frozen.includes('bin/ledger.js'));
});

// ---------------------------------------------------------------------------
// 15.9 the check gets a deep copy of the arguments taken before the call
// ---------------------------------------------------------------------------

test('R15.9 the check gets the arguments as they were before the call, and the function gets the originals', async () => {
  const { guard } = await load();
  const seen = [];
  const shrink = guard(
    { shrink: (list) => { list.length = 0; return 0; } },
    { shrink: { criterion: 'R9.9', check: (args, result) => { seen.push(args[0]); return result === args[0].length - args[0].length; } } },
  );
  const list = [1, 2, 3];
  shrink.shrink(list);
  assert.deepEqual(list, []);
  assert.deepEqual(seen[0], [1, 2, 3]);
});

test('R15.9 a function that changes its argument to agree with a wrong result is caught', async () => {
  const { guard, ContractViolation } = await load();
  const guarded = guard(
    { double: (box) => { box.value = 1; return 2; } },
    { double: { criterion: 'R9.8', check: ([box], result) => result === box.value * 2 || `${result} is not twice ${box.value}` } },
  );
  assert.throws(() => guarded.double({ value: 5 }), (e) => e instanceof ContractViolation && /R9\.8/.test(e.message) && /not twice 5/.test(e.message));
});

test('R15.9 arguments that cannot be cloned are passed on as the original, one by one', async () => {
  const { guard } = await load();
  let seen;
  const fn = () => 1;
  const guarded = guard({ f: (a, b) => { a.n = 2; return b(); } }, { f: { criterion: 'R9.7', check: (args) => { seen = args; return true; } } });
  const a = { n: 1 };
  assert.equal(guarded.f(a, fn), 1);
  assert.deepEqual(seen[0], { n: 1 });
  assert.notEqual(seen[0], a);
  assert.equal(seen[1], fn);
});

test('R15.9 runtime.js reads structuredClone once, when it loads, and still reads no environment variable', () => {
  const code = fs.readFileSync(RUNTIME, 'utf8').replace(/\/\/.*$/gm, '');
  assert.equal(code.match(/structuredClone/g).length, 1, 'one mention, at the top of the file');
  assert.doesNotMatch(code, /\bprocess\b/);
  assert.doesNotMatch(code, /\bimport\b/);
});
