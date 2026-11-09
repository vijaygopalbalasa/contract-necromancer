// Contracts for Requirement 15 of the necro-core spec: runtime postconditions (Design by Contract, for real).
//
// R15.1  THE SYSTEM SHALL provide `guard(exports, postconditions)` in `src/runtime.js` that returns the module's exports
//        with each function named in `postconditions` wrapped, so that every call runs that function's check
//        `(args, result)` after it returns and, IF the check returns anything but `true`, THEN throws a `ContractViolation`
//        whose message names the criterion (for example `R5.1`) and the reason.
// R15.2  THE `guard` wrapper SHALL behave the same with or without a test runner and SHALL read no environment variable.
// R15.3  WHERE a spec has a file `contracts/<spec>/postconditions.js` THE SYSTEM SHALL lock it with the spec like a contract
//        file (restored after an agent edit, pinned in receipts, MISMATCH in verify when changed), and `runners.json`'s
//        `"frozen"` key SHALL work for a spec with no runner patterns.
// R15.4  THE Pumpkin Ledger example SHALL have postconditions for `splitExpense`, `computeBalances` and `settle`, applied by
//        `bin/ledger.js`, which is frozen; and code that special-cases the test runner passes every contract yet makes
//        `bin/ledger.js` exit 1 with a `ContractViolation` naming the criterion.
// R15.5  WHEN `necro demo` has shown MISMATCH THE SYSTEM SHALL show one more step: the copy's `src/split.js` behaves correctly
//        only under the test runner, the contracts pass, and running the ledger on a party prints the `ContractViolation`;
//        the demo's exit code rules of Requirement 11 also cover this step.
// R15.6  THE README SHALL explain runtime postconditions as Eiffel's `ensure`, their cost, and what they catch that tests
//        cannot.
//
// The tests use the real modules and the real command line. R15.4 and R15.5 work on copies of the bundled example in
// temporary folders. This file carries its own helpers.
//
// The receipt pins the files this test exercises. Keep these lines, necro reads `from '...'` text:
//   from '../../src/runtime.js'
//   from '../../src/runners.js'
//   from '../../src/lock.js'
//   from '../../src/check.js'
//   from '../../src/verify.js'
//   from '../../src/hooks.js'
//   from '../../src/demo.js'
//   from '../../bin/necro.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { guard, ContractViolation } from '../../src/runtime.js';
import { freezeSpec, readLock, isFrozenPath } from '../../src/lock.js';
import { runCheck } from '../../src/check.js';
import { verify } from '../../src/verify.js';
import { handlePreToolUse, handlePostToolUse } from '../../src/hooks.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');
const RUNTIME = path.join(REPO, 'src', 'runtime.js');
const EXAMPLE = path.join(REPO, 'examples', 'pumpkin-ledger');

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  delete env.NO_COLOR;
  delete env.NECRO_DEMO_FORCE_TTY;
  return { ...env, ...extra };
}

function run(cmd, args, cwd, extra = {}) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: cleanEnv(extra), timeout: 280_000 });
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

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function printed(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const code = fn();
    return { code, out: lines.join('\n') };
  } finally {
    console.log = original;
  }
}

// A fresh copy of the bundled example.
function exampleCopy(prefix = 'necro-runtime-contract-') {
  const dir = temp(prefix);
  fs.cpSync(EXAMPLE, dir, { recursive: true });
  return dir;
}

function edit(dir, rel, from, to) {
  const file = path.join(dir, rel);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(from), `${rel} has no ${from}`);
  fs.writeFileSync(file, text.replace(from, () => to));
}

// The reproduction from the review: the extra cents are kept only under the test runner.
const RUNNER_SWITCH = ['const extra = cents % n;', 'const extra = process.env.NODE_TEST_CONTEXT ? cents % n : 0;'];

test('R15.1 guard returns the exports with each named function wrapped; every call runs its check with (args, result) after it returns, and anything but true throws a ContractViolation naming the criterion and the reason', () => {
  const add = (a, b) => a + b;
  const other = (x) => x;
  const exports = Object.freeze({ add, other });
  const log = [];
  const guarded = guard(exports, {
    add: {
      criterion: 'R9.1',
      check: (args, result) => {
        log.push(['check', args, result]);
        return result === args[0] + args[1] ? true : `expected ${args[0] + args[1]}`;
      },
    },
  });
  assert.notEqual(guarded.add, add);
  assert.equal(guarded.other, other);
  assert.equal(guarded.add(2, 3), 5);
  assert.deepEqual(log, [['check', [2, 3], 5]]);

  // Every call is checked, not the first one only, and a check passes only by returning true.
  assert.equal(guarded.add(4, 4), 8);
  assert.equal(log.length, 2);
  for (const verdict of [false, undefined, null, 0, 1, 'the sum is wrong', {}]) {
    const bad = guard({ f: () => 1 }, { f: { criterion: 'R5.1', check: () => verdict } });
    assert.throws(
      () => bad.f(),
      (e) => e instanceof ContractViolation && e.name === 'ContractViolation' && /\bR5\.1\b/.test(e.message) && (typeof verdict !== 'string' || e.message.includes(verdict)),
      `verdict ${JSON.stringify(verdict)}`,
    );
  }
  const wrong = guard({ add: () => 6 }, { add: { criterion: 'R9.1', check: (args, result) => result === 5 || 'expected 5, got 6' } });
  assert.throws(() => wrong.add(2, 3), /R9\.1.*expected 5, got 6/);
});

test('R15.2 guard behaves the same with or without a test runner and reads no environment variable', () => {
  // The source does not look at the process, an environment variable or a test runner, and imports nothing.
  const code = fs.readFileSync(RUNTIME, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\bprocess\b|\benv\b|NODE_TEST|\bimport\b/i);

  // Run the same guard in fresh processes: with the test runner's variable, without it, and, once the module is loaded, with the
  // environment replaced by an object that records every read while the guard is built and called.
  const script = `
    const { guard } = await import(${JSON.stringify(RUNTIME)});
    const reads = [];
    process.env = new Proxy(process.env, { get(t, k) { reads.push(String(k)); return t[k]; }, has(t, k) { reads.push(String(k)); return k in t; } });
    const g = guard({ f: (n) => n }, { f: { criterion: 'R7.1', check: (a, r) => r === 1 || 'not one' } });
    const out = [];
    for (const n of [1, 2, 1]) { try { out.push(g.f(n)); } catch (e) { out.push(e.name + ': ' + e.message); } }
    console.log(JSON.stringify({ out, reads }));
  `;
  const results = [{}, { NODE_TEST_CONTEXT: 'child-v8' }, { NODE_TEST_CONTEXT: '1', NODE_ENV: 'test', CI: 'true', JEST_WORKER_ID: '1' }].map((extra) => {
    const env = cleanEnv(extra);
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env });
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  });
  assert.deepEqual(results[0].out, [1, 'ContractViolation: R7.1 f: not one', 1]);
  for (const r of results) {
    assert.deepEqual(r.out, results[0].out);
    assert.deepEqual(r.reads, [], `guard read the environment: ${r.reads}`);
  }
});

// Spec 'demo' with a JavaScript contract and a runners.json that holds only "frozen" (no runner pattern), a bin/app.js that
// applies the guard, and a postconditions file.
const HELLO = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('R1.1 holds', () => assert.ok(true));\n";
const POST = "export const table = { f: { criterion: 'R1.1', check: () => true } };\n";
const APP = "console.log('app');\n";

test('R15.3 contracts/<spec>/postconditions.js is locked with the spec, restored after an edit, pinned in receipts and MISMATCH in verify when changed; a runners.json with only "frozen" locks its files too', () => {
  const cwd = temp('necro-runtime-lock-');
  put(cwd, '.kiro/specs/demo/requirements.md', '# Demo\n');
  put(cwd, '.kiro/specs/demo/runners.json', JSON.stringify({ frozen: ['bin/app.js'] }) + '\n');
  put(cwd, 'contracts/demo/hello.contract.test.js', HELLO);
  put(cwd, 'contracts/demo/postconditions.js', POST);
  put(cwd, 'bin/app.js', APP);
  freezeSpec(cwd, 'demo');

  const entry = readLock(cwd).specs.demo;
  assert.deepEqual(entry.frozen.map((f) => f.path).sort(), ['bin/app.js', 'contracts/demo/postconditions.js']);
  assert.ok(entry.runners.path.endsWith('runners.json'));
  for (const rel of ['bin/app.js', 'contracts/demo/postconditions.js', '.kiro/specs/demo/runners.json']) {
    assert.ok(isFrozenPath(cwd, rel), rel);
    const refused = handlePreToolUse({ session_id: 's', hook_event_name: 'PreToolUse', cwd, tool_name: 'fs_write', tool_input: { path: path.join(cwd, rel), text: 'x' } });
    assert.equal(refused.exitCode, 2, rel);
  }

  // Restored after an edit and after a delete.
  fs.writeFileSync(path.join(cwd, 'contracts/demo/postconditions.js'), 'export const table = {};\n');
  fs.rmSync(path.join(cwd, 'bin/app.js'));
  const back = handlePostToolUse({ session_id: 's', hook_event_name: 'PostToolUse', cwd, tool_name: 'execute_bash', tool_input: { command: 'x' } });
  assert.match(back.stderr, /Restored frozen file contracts\/demo\/postconditions\.js/);
  assert.match(back.stderr, /Restored frozen file bin\/app\.js/);
  assert.equal(fs.readFileSync(path.join(cwd, 'contracts/demo/postconditions.js'), 'utf8'), POST);
  assert.equal(fs.readFileSync(path.join(cwd, 'bin/app.js'), 'utf8'), APP);

  // Pinned in the receipt, MISMATCH when the file changes.
  const { receipt } = runCheck(cwd, 'demo');
  const written = JSON.parse(fs.readFileSync(path.join(cwd, receipt), 'utf8'));
  assert.deepEqual(written.frozen.map((f) => f.path).sort(), ['bin/app.js', 'contracts/demo/postconditions.js']);
  const confirmed = printed(() => verify(cwd, receipt));
  assert.equal(confirmed.code, 0, confirmed.out);
  assert.match(confirmed.out, /CONFIRMED/);
  for (const rel of ['contracts/demo/postconditions.js', 'bin/app.js']) {
    const original = fs.readFileSync(path.join(cwd, rel), 'utf8');
    fs.writeFileSync(path.join(cwd, rel), original + '// changed\n');
    const changed = printed(() => verify(cwd, receipt));
    assert.equal(changed.code, 1, rel);
    assert.match(changed.out, new RegExp(`MISMATCH.*${rel.replace(/[./]/g, '\\$&')}`));
    fs.writeFileSync(path.join(cwd, rel), original);
  }
  assert.equal(printed(() => verify(cwd, receipt)).code, 0);
});

test('R15.4 the example has postconditions for splitExpense, computeBalances and settle, applied by bin/ledger.js, which is listed under frozen; each one stops a ledger whose code breaks it', () => {
  const post = fs.readFileSync(path.join(EXAMPLE, 'contracts/ledger/postconditions.js'), 'utf8');
  for (const name of ['splitExpense', 'computeBalances', 'settle']) assert.match(post, new RegExp(`\\b${name}\\b`));
  const bin = fs.readFileSync(path.join(EXAMPLE, 'bin/ledger.js'), 'utf8');
  assert.match(bin, /contracts\/ledger\/postconditions\.js/);
  assert.match(bin, /\bguard\(/);
  const runners = JSON.parse(fs.readFileSync(path.join(EXAMPLE, '.kiro/specs/ledger/runners.json'), 'utf8'));
  assert.ok(runners.frozen.includes('bin/ledger.js'));
  // The copy of src/runtime.js that the example carries is the one of this package.
  assert.equal(fs.readFileSync(path.join(EXAMPLE, 'src/runtime.js'), 'utf8'), fs.readFileSync(RUNTIME, 'utf8'));

  const fine = run(process.execPath, ['bin/ledger.js', 'party.txt'], EXAMPLE);
  assert.equal(fine.status, 0, fine.stderr);
  assert.match(fine.stdout, /^Name\s+Paid\s+Share\s+Balance$/m);

  const breaks = [
    { criterion: 'R5.1', rel: 'src/split.js', from: 'const extra = cents % n;', to: 'const extra = 0;' },
    { criterion: 'R2.2', rel: 'src/balances.js', from: 'share.set(key, share.get(key) + amount);', to: 'share.set(key, share.get(key) + amount + (key === allKeys[0] ? 1 : 0));' },
    { criterion: 'R3.1', rel: 'src/settle.js', from: '  return payments;', to: '  payments.pop();\n  return payments;' },
  ];
  for (const b of breaks) {
    const dir = exampleCopy();
    edit(dir, b.rel, b.from, b.to);
    const res = run(process.execPath, ['bin/ledger.js', 'party.txt'], dir);
    assert.equal(res.status, 1, `${b.criterion}: ${res.stdout}${res.stderr}`);
    assert.match(res.stderr, new RegExp(`ContractViolation: ${b.criterion.replace('.', '\\.')} `), res.stderr);
    assert.equal(res.stdout, '');
  }
});

test('R15.4 code that special-cases the test runner passes every contract, yet bin/ledger.js exits 1 with a ContractViolation that names the criterion', () => {
  const dir = exampleCopy();
  edit(dir, 'src/split.js', ...RUNNER_SWITCH);
  // Every contract passes: the frozen contracts run under the test runner, where this code is right.
  const checked = run(process.execPath, [BIN, 'check', 'ledger'], dir);
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
  assert.match(checked.stdout, /All \d+ contracts pass\./);
  // The same code, outside a test runner, is wrong, and the ledger says so.
  const res = run(process.execPath, ['bin/ledger.js', 'party.txt'], dir);
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /ContractViolation/);
  assert.match(res.stderr, /\bR(?:2\.1|5\.1)\b/);
  assert.equal(res.stdout, '');
  // splitExpense itself returns 99 cents for 100 over three people outside the test runner.
  const probe = run(process.execPath, ['--input-type=module', '-e', "import { splitExpense } from './src/split.js'; console.log([...splitExpense(100, ['a', 'b', 'c']).values()].reduce((s, x) => s + x, 0));"], dir);
  assert.equal(probe.stdout.trim(), '99');
});

test('R15.5 after MISMATCH the demo shows a step where src/split.js is right only under the test runner, the contracts pass and the ledger prints a ContractViolation, and its exit code rules cover the step', () => {
  const elsewhere = temp('necro-runtime-cwd-');
  const res = run(process.execPath, [BIN, 'demo'], elsewhere);
  const folder = /^Demo folder: (.+)$/m.exec(res.stdout)?.[1];
  if (folder) made.push(folder);
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  const at = (re) => res.stdout.search(re);
  const order = [at(/^MISMATCH/m), at(/^Step 6\./m), at(/^The contracts pass \(\d+ of \d+\)/m), at(/^ContractViolation: R(?:2\.1|5\.1) /m), at(/^To see a receipt in your browser/m)];
  assert.ok(order.every((n) => n >= 0), res.stdout);
  assert.deepEqual([...order].sort((a, b) => a - b), order, res.stdout);
  assert.match(res.stdout, /NODE_TEST_CONTEXT/);
  assert.equal(res.stderr, '');

  // A package whose example does not stop the ledger: the last step does not happen, so the demo exits 1 and names it.
  const pkg = temp('necro-runtime-pkg-');
  fs.cpSync(path.join(REPO, 'bin'), path.join(pkg, 'bin'), { recursive: true });
  fs.cpSync(path.join(REPO, 'src'), path.join(pkg, 'src'), { recursive: true });
  fs.cpSync(EXAMPLE, path.join(pkg, 'examples', 'pumpkin-ledger'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(pkg, 'package.json'));
  fs.writeFileSync(
    path.join(pkg, 'examples', 'pumpkin-ledger', 'contracts', 'ledger', 'postconditions.js'),
    "const always = (name) => ({ [name]: { criterion: 'R0.0', check: () => true } });\nexport const splitPostconditions = always('splitExpense');\nexport const balancesPostconditions = always('computeBalances');\nexport const settlePostconditions = always('settle');\n",
  );
  const failed = run(process.execPath, [path.join(pkg, 'bin', 'necro.js'), 'demo'], elsewhere);
  const failedFolder = /^Demo folder: (.+)$/m.exec(failed.stdout)?.[1];
  if (failedFolder) made.push(failedFolder);
  assert.equal(failed.status, 1, `${failed.stdout}${failed.stderr}`);
  assert.match(failed.stderr, /Demo failed at step 'runtime'/);
  assert.match(failed.stdout, /^MISMATCH/m);
  assert.doesNotMatch(failed.stdout, /^To see a receipt in your browser/m);
});

test('R15.6 the README explains runtime postconditions as Eiffel\'s ensure, their cost, and what they catch that tests cannot', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  const heading = /^#{2,3} .*[Rr]untime postconditions.*$/m.exec(readme);
  assert.ok(heading, 'a README section about runtime postconditions');
  const rest = readme.slice(heading.index + heading[0].length);
  const next = /^#{2,3} /m.exec(rest);
  const section = next ? rest.slice(0, next.index) : rest;
  assert.match(section, /Eiffel/);
  assert.match(section, /`ensure`/);
  assert.match(section, /every call/i);
  assert.match(section, /cost|slower|extra work/i);
  assert.match(section, /test runner/i);
  assert.match(section, /NODE_TEST_CONTEXT/);
  assert.match(section, /guard\(/);
  assert.match(section, /postconditions\.js/);
  assert.doesNotMatch(section, /\u2014|\u2013/);
});
