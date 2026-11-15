// Contracts for Requirement 6.15 of the necro-core spec: `necro verify` says when a receipt belongs to another project.
//
// R6.15  IF a receipt's spec is not in the local lock AND no spec of that name exists in this project THEN THE SYSTEM
//        SHALL print `OTHER PROJECT` naming the spec, say that the receipt was written in another project and must be
//        verified from that project's checkout, and exit with code 2, instead of `MISMATCH`.
//
// Each test builds two throwaway projects in a temp directory. Project A freezes a spec `demo` and writes a receipt.
// Project B has its own frozen spec `other`. The receipt is copied into B's receipts folder and verified from B. In one
// test B also has a `demo` spec folder that is not frozen, which keeps the earlier answer. This file carries its own
// helpers.
//
// The receipt pins the files `necro verify` uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/verify.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

function necro(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: cleanEnv() });
}

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const HEAD = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n`;

function freezeSpec(cwd, spec) {
  put(cwd, `.kiro/specs/${spec}/requirements.md`, `# Requirements: ${spec}\n`);
  put(cwd, `contracts/${spec}/a.contract.test.js`, `${HEAD}test('R6.15 ${spec} holds', () => { assert.ok(true); });\n`);
  const frozen = necro(cwd, ['freeze', spec]);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
}

// Project A with a receipt for `demo`, and project B with only `other` frozen and A's receipt copied in.
function twoProjects(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-other-'));
  try {
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    freezeSpec(a, 'demo');
    const checked = necro(a, ['check', 'demo']);
    const found = /Receipt: (\S+)/.exec(checked.stdout);
    assert.ok(found, `check wrote a receipt: ${checked.stdout}${checked.stderr}`);
    freezeSpec(b, 'other');
    const text = fs.readFileSync(path.join(a, found[1]), 'utf8');
    const rel = found[1];
    put(b, rel, text);
    return fn({ a, b, rel });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('R6.15 verify prints OTHER PROJECT naming the spec and exits 2 when the spec is neither in the lock nor in the project', () =>
  twoProjects(({ b, rel }) => {
    const res = necro(b, ['verify', rel]);
    assert.equal(res.status, 2, `exit code 2: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /OTHER PROJECT/);
    assert.ok(res.stdout.includes('demo'), `names the spec: ${res.stdout}`);
    assert.match(res.stdout, /another project/);
    assert.doesNotMatch(res.stdout, /MISMATCH/);
    assert.doesNotMatch(res.stdout, /CONFIRMED/);
  }));

test('R6.15 a spec that exists in the project but is not frozen keeps its answer: MISMATCH, not in the lock, exit 1', () =>
  twoProjects(({ b, rel }) => {
    put(b, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
    const res = necro(b, ['verify', rel]);
    assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /MISMATCH/);
    assert.match(res.stdout, /Spec 'demo' is not in the lock/);
    assert.doesNotMatch(res.stdout, /OTHER PROJECT/);
  }));

test('R6.15 a receipt for a spec that is in the lock is verified as before (CONFIRMED in its own project)', () =>
  twoProjects(({ a, rel }) => {
    const res = necro(a, ['verify', rel]);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /CONFIRMED/);
    assert.doesNotMatch(res.stdout, /OTHER PROJECT/);
  }));
