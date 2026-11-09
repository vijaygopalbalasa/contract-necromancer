// Replacement contract for Requirement 15.5 of the necro-core spec.
//
// R15.5  WHEN `necro demo` has shown MISMATCH THE SYSTEM SHALL show one more step: the copy's `src/split.js` behaves correctly
//        only under the test runner, the contracts pass, and running the ledger on a party prints the `ContractViolation`;
//        the demo's exit code rules of Requirement 11 also cover this step.
//
// Why this file exists: the R15.5 test in runtime.contract.test.js builds its failure case by editing the example's
// `contracts/ledger/postconditions.js` in a copy. Since R15.3 that file is locked with the spec, so a changed copy fails
// `necro verify` at step 4 ('confirmed') and the demo never reaches step 6 ('runtime'). This test makes the same failure,
// a ledger that no postcondition stops, in a way the lock accepts: after the edit, it freezes its own copy of the example
// again, as a person would. The demo then runs every step up to 'runtime' and fails there.
//
// The old R15.5 test in runtime.contract.test.js is removed by a person. Until then both files carry a test with this name.
//
// The tests use the real modules and the real command line, on copies in temporary folders. This file carries its own
// helpers.
//
// The receipt pins the files this test exercises. Keep these lines, necro reads `from '...'` text:
//   from '../../src/lock.js'
//   from '../../src/demo.js'
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

// Postconditions that accept everything: the ledger these allow is not stopped by any of them.
const ALWAYS_TRUE =
  "const always = (name) => ({ [name]: { criterion: 'R0.0', check: () => true } });\n" +
  "export const splitPostconditions = always('splitExpense');\n" +
  "export const balancesPostconditions = always('computeBalances');\n" +
  "export const settlePostconditions = always('settle');\n";

test('R15.5 after MISMATCH the demo shows a step where src/split.js is right only under the test runner, the contracts pass and the ledger prints a ContractViolation, and its exit code rules cover the step', () => {
  // The demo as shipped, started from a folder that is not the repository.
  const elsewhere = temp('necro-runtime-demo-cwd-');
  const res = run(process.execPath, [BIN, 'demo'], elsewhere);
  const folder = /^Demo folder: (.+)$/m.exec(res.stdout)?.[1];
  if (folder) made.push(folder);
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  const at = (re) => res.stdout.search(re);
  const order = [
    at(/^MISMATCH/m),
    at(/^Step 6\./m),
    at(/^The contracts pass \(\d+ of \d+\)/m),
    at(/^ContractViolation: R(?:2\.1|5\.1) /m),
    at(/^To see a receipt in your browser/m),
  ];
  assert.ok(order.every((n) => n >= 0), res.stdout);
  assert.deepEqual([...order].sort((a, b) => a - b), order, res.stdout);
  assert.match(res.stdout, /NODE_TEST_CONTEXT/);
  assert.equal(res.stderr, '');

  // A package whose example does not stop the ledger. A person edited the example's postconditions and froze the example
  // again, so the lock matches the edit. Steps 1 to 5 then happen as before, step 6 does not, and the demo exits 1 and names it.
  const pkg = temp('necro-runtime-demo-pkg-');
  fs.cpSync(path.join(REPO, 'bin'), path.join(pkg, 'bin'), { recursive: true });
  fs.cpSync(path.join(REPO, 'src'), path.join(pkg, 'src'), { recursive: true });
  const example = path.join(pkg, 'examples', 'pumpkin-ledger');
  fs.cpSync(EXAMPLE, example, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(pkg, 'package.json'));
  fs.writeFileSync(path.join(example, 'contracts', 'ledger', 'postconditions.js'), ALWAYS_TRUE);
  freezeSpec(example, 'ledger');

  const failed = run(process.execPath, [path.join(pkg, 'bin', 'necro.js'), 'demo'], elsewhere);
  const failedFolder = /^Demo folder: (.+)$/m.exec(failed.stdout)?.[1];
  if (failedFolder) made.push(failedFolder);
  assert.equal(failed.status, 1, `${failed.stdout}${failed.stderr}`);
  assert.match(failed.stderr, /Demo failed at step 'runtime'/);
  // Every step before 'runtime' happened, the mismatch included, and nothing after it did.
  assert.match(failed.stdout, /^CONFIRMED /m);
  assert.match(failed.stdout, /^MISMATCH/m);
  assert.match(failed.stdout, /^Step 6\./m);
  assert.doesNotMatch(failed.stdout, /^ContractViolation: /m);
  assert.doesNotMatch(failed.stdout, /^To see a receipt in your browser/m);
});
