// Contracts for Requirements 15.7 and 15.8 of the necro-core spec: guard every output the ledger prints.
//
// R15.7  THE Pumpkin Ledger postconditions SHALL also check, for `computeBalances`, each person's paid amount (the sum of what
//        they paid, read from the expenses given) and each person's share (recomputed by the check itself: floor division,
//        extra cents to the first names alphabetically), and SHALL guard the text and JSON reports so that every balance and
//        payment printed equals the guarded results; a test SHALL show that two cheats from an independent review (in
//        `src/balances.js`, swap two people's shares when no test runner is present; in `src/report.js`, halve every printed
//        payment) pass every contract and still make `bin/ledger.js` exit 1 with a `ContractViolation`.
// R15.8  THE README and `docs/limits.md` SHALL say that runtime postconditions protect only the outputs they check, so a
//        project should guard every function whose result reaches a user, and that the demo's step 6 shows one cheat among
//        many.
//
// The tests use the real modules and the real command line, on copies of the bundled example in temporary folders. A person
// freezes the example again after editing its postconditions and entry point, so each copy is frozen again here, as a person
// would, before a cheat is added to it. This file carries its own helpers.
//
// The receipt pins the files this test exercises. Keep these lines, necro reads `from '...'` text:
//   from '../../src/runtime.js'
//   from '../../src/lock.js'
//   from '../../bin/necro.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { freezeSpec } from '../../src/lock.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');
const EXAMPLE = path.join(REPO, 'examples', 'pumpkin-ledger');

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  delete env.NO_COLOR;
  delete env.NECRO_DEMO_FORCE_TTY;
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

// A fresh copy of the bundled example, frozen again as a person does after reviewing it.
function exampleCopy() {
  const dir = temp('necro-coverage-contract-');
  fs.cpSync(EXAMPLE, dir, { recursive: true });
  freezeSpec(dir, 'ledger');
  return dir;
}

function edit(dir, rel, from, to) {
  const file = path.join(dir, rel);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(from), `${rel} has no ${from}`);
  fs.writeFileSync(file, text.replace(from, () => to));
}

// The two cheats from the independent review. Both act only when no test runner is present, so every contract passes.
function swapShares(dir) {
  edit(
    dir,
    'src/balances.js',
    '  return people.map((p) => {',
    '  if (!process.env.NODE_TEST_CONTEXT && allKeys.length > 1) {\n' +
      '    const first = share.get(allKeys[0]);\n' +
      '    share.set(allKeys[0], share.get(allKeys[1]));\n' +
      '    share.set(allKeys[1], first);\n' +
      '  }\n' +
      '  return people.map((p) => {',
  );
}

function halvePayments(dir) {
  const half = 'const printed = (p) => (process.env.NODE_TEST_CONTEXT ? p.amount : Math.floor(p.amount / 2));\n';
  edit(dir, 'src/report.js', 'export function renderText(', `${half}export function renderText(`);
  edit(dir, 'src/report.js', '${formatCents(p.amount)}`);', '${formatCents(printed(p))}`);');
  edit(dir, 'src/report.js', 'JSON.stringify({ balances, payments })', 'JSON.stringify({ balances, payments: payments.map((p) => ({ ...p, amount: printed(p) })) })');
}

// What the cheated modules print when nothing guards them: the ledger's own steps, without bin/ledger.js.
const UNGUARDED = `
import { readFileSync } from 'node:fs';
import { parseLedger } from './src/parse.js';
import { computeBalances } from './src/balances.js';
import { settle } from './src/settle.js';
import { renderText, renderJson } from './src/report.js';
const parsed = parseLedger(readFileSync('party.txt', 'utf8'));
const balances = computeBalances(parsed);
const payments = settle(balances);
console.log(process.argv[2] === '--json' ? renderJson(balances, payments) : renderText(balances, payments));
`;

function unguarded(dir, flag) {
  fs.writeFileSync(path.join(dir, 'unguarded.mjs'), UNGUARDED);
  return run(process.execPath, ['unguarded.mjs', ...(flag ? [flag] : [])], dir);
}

// A cheat that is really wrong, passes every contract, and has a receipt that verifies; then the ledger stops it.
function assertCheatIsCaught({ apply, criterion, flag }) {
  const honest = run(process.execPath, ['bin/ledger.js', 'party.txt', ...(flag ? [flag] : [])], exampleCopy());
  assert.equal(honest.status, 0, honest.stderr);

  const dir = exampleCopy();
  apply(dir);

  // The cheat prints something wrong and exits 0 when nothing guards the output.
  const bare = unguarded(dir, flag);
  assert.equal(bare.status, 0, bare.stderr);
  assert.notEqual(bare.stdout, honest.stdout, 'the cheat should print different numbers');

  // Every frozen contract passes, and the receipt of that run is CONFIRMED.
  const checked = run(process.execPath, [BIN, 'check', 'ledger'], dir);
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
  assert.match(checked.stdout, /All \d+ contracts pass\./);
  const receipt = /^Receipt: (.+)$/m.exec(checked.stdout)?.[1];
  assert.ok(receipt, checked.stdout);
  const verified = run(process.execPath, [BIN, 'verify', receipt], dir);
  assert.equal(verified.status, 0, `${verified.stdout}${verified.stderr}`);
  assert.match(verified.stdout, /^CONFIRMED /m);

  // The ledger run by a person stops with a ContractViolation that names the criterion, and prints nothing.
  const res = run(process.execPath, ['bin/ledger.js', 'party.txt', ...(flag ? [flag] : [])], dir);
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  assert.match(res.stderr, criterion, res.stderr);
  assert.equal(res.stdout, '');
}

test('R15.7 the example checks each person\'s paid amount and share in computeBalances and guards the text and JSON reports, applied by bin/ledger.js', () => {
  const post = fs.readFileSync(path.join(EXAMPLE, 'contracts/ledger/postconditions.js'), 'utf8');
  for (const name of ['computeBalances', 'renderText', 'renderJson']) assert.match(post, new RegExp(`\\b${name}\\b`));
  assert.match(post, /\bpaid\b/);
  assert.match(post, /\bshare\b/);
  const bin = fs.readFileSync(path.join(EXAMPLE, 'bin/ledger.js'), 'utf8');
  assert.match(bin, /\bguard\(reportModule, reportPostconditions\)/);
  const runners = JSON.parse(fs.readFileSync(path.join(EXAMPLE, '.kiro/specs/ledger/runners.json'), 'utf8'));
  assert.ok(runners.frozen.includes('bin/ledger.js'));
  // The honest ledger still prints the table and the payments.
  const fine = run(process.execPath, ['bin/ledger.js', 'party.txt'], EXAMPLE);
  assert.equal(fine.status, 0, fine.stderr);
  assert.match(fine.stdout, /^Name\s+Paid\s+Share\s+Balance$/m);
  assert.match(fine.stdout, /^Dee pays Cy 21\.54$/m);
});

test('R15.7 two shares swapped in src/balances.js when no test runner is present pass every contract, yet bin/ledger.js exits 1 with a ContractViolation that names the criterion, in text and in JSON', () => {
  assertCheatIsCaught({ apply: swapShares, criterion: /ContractViolation: R2\.[12] computeBalances/ });
  assertCheatIsCaught({ apply: swapShares, criterion: /ContractViolation: R2\.[12] computeBalances/, flag: '--json' });
});

test('R15.7 every printed payment halved in src/report.js when no test runner is present passes every contract, yet bin/ledger.js exits 1 with a ContractViolation that names the criterion, in text and in JSON', () => {
  assertCheatIsCaught({ apply: halvePayments, criterion: /ContractViolation: R4\.1 renderText/ });
  assertCheatIsCaught({ apply: halvePayments, criterion: /ContractViolation: R4\.2 renderJson/, flag: '--json' });
});

// The text of a README or docs section: from its heading to the next heading of the same or a higher level.
function section(file, heading) {
  const text = fs.readFileSync(path.join(REPO, file), 'utf8');
  const start = heading.exec(text);
  assert.ok(start, `${file} has no section matching ${heading}`);
  const rest = text.slice(start.index + start[0].length);
  const level = /^#+/.exec(start[0])[0].length;
  const next = new RegExp(`^#{1,${level}} `, 'm').exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

test('R15.8 the README and docs/limits.md say runtime postconditions protect only the outputs they check, that a project should guard every function whose result reaches a user, and that the demo\'s step 6 shows one cheat among many', () => {
  const parts = [
    ['README.md', section('README.md', /^### Runtime postconditions$/m)],
    ['docs/limits.md', section('docs/limits.md', /^## Runtime postconditions$/m)],
  ];
  for (const [file, text] of parts) {
    const flat = text.replace(/\s+/g, ' ');
    assert.match(flat, /protect only the outputs they check/i, file);
    assert.match(flat, /guard every function whose result reaches a user/i, file);
    assert.match(flat, /step 6/i, file);
    assert.match(flat, /one cheat among many/i, file);
    assert.doesNotMatch(text, /\u2014|\u2013/, file);
  }
});
