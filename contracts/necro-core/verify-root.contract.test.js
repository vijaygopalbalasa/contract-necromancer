// Contract for Requirement 6.10 of the necro-core spec: `necro verify` says whose contracts run.
//
// R6.10  WHEN `necro verify` uses a project root other than the current folder, THE SYSTEM SHALL first print
//        `Project: <absolute path>` so the user sees whose contracts run.
//
// The test builds a repository with a lock of its own and an example project under `examples/demo` with a lock and a genuine
// receipt of its own (made by `necro freeze` and `necro check`), the layout of this repository. It runs `necro verify` on that
// receipt from the repository root and from an unrelated folder (the first line of output is `Project:` and the absolute
// path of the example, then the verdict), from the example folder (no `Project:` line), for a receipt that confirms and for
// one that does not, and for a receipt outside every project (the current folder is the root, so no line). The `Project:`
// line is the only difference between the outputs. This file carries its own helpers.
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
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-root-'));
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
const CONTRACT_A = `${HEAD}test('R6.10 first contract', () => { assert.ok(true); });\n`;
const CONTRACT_B = `${HEAD}test('R6.10 second contract', () => { assert.equal(1 + 1, 2); });\n`;
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
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

// The folder as the child process sees it: a symbolic link such as /var -> /private/var is resolved.
const real = (p) => fs.realpathSync(p);

test('R6.10 necro verify prints Project: and the absolute path of the project first when its root is not the current folder, and no such line from the root itself', () =>
  temp((make) => {
    const { root, example, receipt } = repoWithExample(make);
    const elsewhere = make();
    const projectLine = `Project: ${real(example)}`;

    // From the example folder, the project root is the current folder: no Project line.
    const here = verifyFrom(example, receipt);
    assert.equal(here.status, 0, `${here.stdout}${here.stderr}`);
    assert.match(here.stdout, /^CONFIRMED [0-9a-f]{64}/);
    assert.doesNotMatch(here.stdout, /Project:/);
    assert.equal(here.stderr, '');

    // From the repository root and from an unrelated folder: the line comes first, then the same verdict.
    for (const [label, cwd] of [['repository root', root], ['unrelated folder', elsewhere]]) {
      const got = verifyFrom(cwd, receipt);
      assert.equal(got.status, 0, `${label}: ${got.stdout}${got.stderr}`);
      assert.ok(path.isAbsolute(projectLine.slice('Project: '.length)), label);
      assert.equal(got.stdout, `${projectLine}\n${here.stdout}`, label);
      assert.equal(got.stderr, '', label);
    }

    // The line comes before a MISMATCH as well, and the exit code is the verdict's.
    fs.appendFileSync(path.join(example, A_REL), '// changed\n');
    const changedHere = verifyFrom(example, receipt);
    assert.equal(changedHere.status, 1, `${changedHere.stdout}${changedHere.stderr}`);
    assert.match(changedHere.stdout, /^MISMATCH/);
    assert.doesNotMatch(changedHere.stdout, /Project:/);
    const changedFar = verifyFrom(root, receipt);
    assert.equal(changedFar.status, 1, `${changedFar.stdout}${changedFar.stderr}`);
    assert.equal(changedFar.stdout, `${projectLine}\n${changedHere.stdout}`);

    // A receipt that sits outside every project: the current folder is the root, so there is no Project line.
    const ok = make();
    const okReceipt = frozenWithReceipt(ok, 'demo', { [A_REL]: CONTRACT_A, 'contracts/demo/b.contract.test.js': CONTRACT_B });
    const orphan = path.join(make(), 'receipt.json');
    fs.copyFileSync(okReceipt, orphan);
    const orphaned = verifyFrom(ok, orphan);
    assert.equal(orphaned.status, 0, `${orphaned.stdout}${orphaned.stderr}`);
    assert.match(orphaned.stdout, /^CONFIRMED/);
    assert.doesNotMatch(orphaned.stdout, /Project:/);
  }));
