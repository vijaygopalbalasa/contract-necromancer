// Contract for Requirement 6.9 of the necro-core spec: `necro verify` gives the same result from any folder.
//
// R6.9  WHEN `necro verify <receiptFile>` runs from a folder that does not contain the receipt's project, the project root
//       is the nearest folder above the receipt file that contains `.necro/lock.json`, so the result is the same from any
//       working directory. IF no such folder exists THEN the current folder is used, as before.
//
// The test builds a repository with a lock of its own and an example project under `examples/demo` with a lock and a genuine
// receipt of its own (made by `necro freeze` and `necro check`), the layout of this repository. It runs `necro verify` on that
// receipt from the repository root, from the example folder and from an unrelated folder, for a receipt that confirms and
// for one whose pinned file changed, and compares output and exit code. A receipt that sits outside every project is checked
// in the current folder. This file carries its own helpers.
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

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
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

function temp(fn) {
  const dirs = [];
  const make = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-anywhere-'));
    dirs.push(d);
    return d;
  };
  try {
    return fn(make);
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
}

const HEAD = `import { test } from 'node:test';
import assert from 'node:assert/strict';
`;
const CONTRACT_A = `${HEAD}test('R6.9 first contract', () => { assert.ok(true); });\n`;
const CONTRACT_B = `${HEAD}test('R6.9 second contract', () => { assert.equal(1 + 1, 2); });\n`;
const A_REL = 'contracts/demo/a.contract.test.js';

// Freeze a spec called `spec` in `project` and make a genuine receipt with `necro check`.
// Returns the receipt's absolute path.
function frozenWithReceipt(project, spec, files) {
  put(project, `.kiro/specs/${spec}/requirements.md`, `# Requirements: ${spec}\n`);
  for (const [rel, text] of Object.entries(files)) put(project, rel, text);
  const frozen = necro(project, ['freeze', spec]);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
  const checked = necro(project, ['check', spec]);
  assert.equal(checked.status, 0, `check failed: ${checked.stdout}${checked.stderr}`);
  return path.join(project, /Receipt: (\S+)/.exec(checked.stdout)[1]);
}

// A repository with its own lock and an example project with a lock and a receipt of its own.
function repoWithExample(make) {
  const root = make();
  frozenWithReceipt(root, 'outer', { 'contracts/outer/o.contract.test.js': CONTRACT_B });
  const example = path.join(root, 'examples', 'demo');
  const receipt = frozenWithReceipt(example, 'demo', {
    [A_REL]: CONTRACT_A,
    'contracts/demo/b.contract.test.js': CONTRACT_B,
  });
  return { root, example, receipt };
}

// `necro verify` in `cwd`, naming the receipt by a path relative to `cwd`.
function verifyFrom(cwd, receiptAbs) {
  const res = necro(cwd, ['verify', path.relative(cwd, receiptAbs)]);
  // Req 6.10 adds a first line `Project: <path>` when the root is not the current folder; 6.9 compares the rest.
  return { status: res.status, stdout: res.stdout.replace(/^Project: .*\n/, ''), stderr: res.stderr };
}

test('R6.9 necro verify on an example\'s receipt gives the same output and exit code from the repository root, the example folder and an unrelated folder, and a receipt outside any project is checked in the current folder', () =>
  temp((make) => {
    const { root, example, receipt } = repoWithExample(make);
    const elsewhere = make();

    // A receipt that confirms.
    const here = verifyFrom(example, receipt);
    assert.equal(here.status, 0, `${here.stdout}${here.stderr}`);
    assert.match(here.stdout, /CONFIRMED [0-9a-f]{64}/);
    for (const [label, cwd] of [['repository root', root], ['unrelated folder', elsewhere]]) {
      const got = verifyFrom(cwd, receipt);
      assert.equal(got.status, here.status, `${label}: ${got.stdout}${got.stderr}`);
      assert.equal(got.stdout, here.stdout, label);
      assert.equal(got.stderr, here.stderr, label);
    }

    // The nearest lock decides: a receipt kept deeper inside the example is still the example's.
    const deeper = path.join(example, 'saved', 'copy.json');
    put(example, 'saved/copy.json', fs.readFileSync(receipt, 'utf8'));
    const nested = verifyFrom(root, deeper);
    assert.equal(nested.status, 0, `${nested.stdout}${nested.stderr}`);
    assert.equal(nested.stdout, here.stdout);

    // A receipt that does not confirm reads the same everywhere.
    fs.appendFileSync(path.join(example, A_REL), '// changed\n');
    const changed = verifyFrom(example, receipt);
    assert.equal(changed.status, 1, `${changed.stdout}${changed.stderr}`);
    assert.match(changed.stdout, /MISMATCH/);
    assert.ok(changed.stdout.includes(A_REL), changed.stdout);
    for (const [label, cwd] of [['repository root', root], ['unrelated folder', elsewhere]]) {
      const got = verifyFrom(cwd, receipt);
      assert.equal(got.status, changed.status, `${label}: ${got.stdout}${got.stderr}`);
      assert.equal(got.stdout, changed.stdout, label);
    }

    // A receipt outside every project: the current folder is the root, as before.
    const orphans = make();
    const orphan = path.join(orphans, 'receipt.json');
    const ok = make();
    const okReceipt = frozenWithReceipt(ok, 'demo', { [A_REL]: CONTRACT_A, 'contracts/demo/b.contract.test.js': CONTRACT_B });
    fs.copyFileSync(okReceipt, orphan);
    const inProject = verifyFrom(ok, orphan);
    assert.equal(inProject.status, 0, `${inProject.stdout}${inProject.stderr}`);
    assert.match(inProject.stdout, /CONFIRMED/);

    const bare = make();
    put(bare, '.necro/lock.json', JSON.stringify({ specs: {} }));
    const lacking = verifyFrom(bare, orphan);
    assert.equal(lacking.status, 1, `${lacking.stdout}${lacking.stderr}`);
    assert.match(lacking.stdout, /MISMATCH/);
    assert.ok(lacking.stdout.includes("'demo'"), lacking.stdout);
  }));
