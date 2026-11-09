// Contracts for Requirement 11 of the necro-core spec: the one-command demo.
//
// R11.1  WHEN a user runs `necro demo` THE SYSTEM SHALL copy the bundled `examples/pumpkin-ledger` project into a new folder
//        under the operating system's temporary directory, run every step there, print that folder's path, and change
//        nothing outside it.
// R11.2  WHEN the demo runs THE SYSTEM SHALL reopen task 4 in the copy, plant the rounding bug, send the gate the same
//        `task_update` call the Kiro IDE sends, and print that the gate refused the tick with the failing contract names.
//        The refusal prints a line `Contracts failed: ` followed only by the contract IDs, then each failing contract on its
//        own indented line with its full name. The IDs and names are the ones the gate itself named.
// R11.3  WHEN the refusal has been shown THE SYSTEM SHALL restore the correct code, send the same call again, and print that
//        the gate accepted the tick and the path of the receipt it wrote.
// R11.4  WHEN the receipt has been written THE SYSTEM SHALL run `necro verify` on it and print `CONFIRMED`, then change the
//        copy's `src/split.js`, verify the same receipt again and print `MISMATCH`.
// R11.5  THE SYSTEM SHALL exit 0 only if the refusal, the acceptance, `CONFIRMED` and `MISMATCH` all happened as described,
//        and otherwise exit 1 naming the step that did not.
// R11.6  WHEN the package is run (`npx -y github:vijaygopalbalasa/contract-necromancer demo`) on a machine with Node.js 24 and
//        no global `necro` THE SYSTEM SHALL run the same demo, using only files that the package contains.
//
// The tests run the real command line. One demo run, started from an unrelated folder, serves R11.1 to R11.4 and the exit
// code of R11.5. The failing case of R11.5 runs the demo from a copy of the repository whose example has a bug that the
// "restore" step cannot remove. R11.6 packs the package, unpacks it into an empty folder and runs the demo from there. This
// file carries its own helpers.
//
// The demo uses these files. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/demo.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');
const EXAMPLE = path.join(REPO, 'examples', 'pumpkin-ledger');

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: cleanEnv(), timeout: 280_000 });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

const demoWith = (bin, cwd) => run(process.execPath, [bin, 'demo'], cwd);

// Every file under a folder as "relative path -> sha256", dotfiles included.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(dir, abs).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  walk(dir);
  return out;
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

const folderOf = (stdout) => /^Demo folder: (.+)$/m.exec(stdout)?.[1];
const receiptOf = (stdout) => /^Receipt: (.+\.json)$/m.exec(stdout)?.[1];

// The one demo run that R11.1 to R11.5 look at, made on first use.
let shared = null;
function sharedRun() {
  if (!shared) {
    const elsewhere = temp('necro-core-demo-cwd-');
    const exampleBefore = snapshot(EXAMPLE);
    const res = demoWith(BIN, elsewhere);
    const folder = folderOf(res.stdout);
    if (folder) made.push(folder);
    shared = { res, elsewhere, folder, exampleBefore, exampleAfter: snapshot(EXAMPLE) };
  }
  return shared;
}

test('R11.1 necro demo copies the example into a new folder under the temporary directory, prints its path first and changes nothing outside it', () => {
  const { res, elsewhere, folder, exampleBefore, exampleAfter } = sharedRun();
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.ok(res.stdout.startsWith('Demo folder: '), res.stdout);
  assert.ok(folder && path.isAbsolute(folder), `no folder path in: ${res.stdout}`);
  assert.ok(folder.startsWith(os.tmpdir() + path.sep), `${folder} is not under ${os.tmpdir()}`);
  assert.notEqual(path.resolve(folder), path.resolve(EXAMPLE));
  // The copy holds the whole project: its spec, lock, contracts and code.
  for (const rel of ['.kiro/specs/ledger/tasks.md', '.necro/lock.json', 'contracts/ledger/requirement-2-split.contract.test.js', 'src/split.js']) {
    assert.ok(fs.existsSync(path.join(folder, rel)), `the copy has no ${rel}`);
  }
  // Outside the copy nothing moved: not the bundled example, not the folder the demo ran from.
  assert.deepEqual(exampleAfter, exampleBefore, 'examples/pumpkin-ledger changed');
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  // A second run makes a second folder.
  const again = demoWith(BIN, elsewhere);
  const second = folderOf(again.stdout);
  if (second) made.push(second);
  assert.equal(again.status, 0, `${again.stdout}${again.stderr}`);
  assert.ok(second && second !== folder);
});

// A fresh copy of the bundled example with task 4 reopened and the demo's rounding bug planted, for a gate run that does
// not go through the demo. Returns the folder and the task line text after the checkbox, as the Kiro IDE sends it.
function plantedCopy() {
  const folder = temp('necro-core-demo-gate-');
  fs.cpSync(EXAMPLE, folder, { recursive: true });
  const tasks = path.join(folder, '.kiro/specs/ledger/tasks.md');
  const lines = fs.readFileSync(tasks, 'utf8').split('\n');
  const at = lines.findIndex((l) => /^- \[[xX]\] 4\. /.test(l));
  assert.ok(at >= 0, 'task 4 is ticked in the bundled example');
  lines[at] = lines[at].replace('[x]', '[ ]');
  fs.writeFileSync(tasks, lines.join('\n'));
  const split = path.join(folder, 'src/split.js');
  let text = fs.readFileSync(split, 'utf8');
  for (const [from, to] of [
    ['Math.floor(cents / n)', 'Math.round(cents / n)'],
    ['const extra = cents % n;', 'const extra = 0;'],
  ]) {
    assert.ok(text.includes(from), `split.js has no ${from}`);
    text = text.replace(from, () => to);
  }
  fs.writeFileSync(split, text);
  return { folder, taskLine: lines[at].replace(/^- \[ \] /, '') };
}

// The failing contract names in a gate refusal ("Contracts failed: <name>, <name>."), and their IDs (the first word).
function gateNames(stderr) {
  const m = /^Contracts failed: (.+)\.$/m.exec(stderr);
  assert.ok(m, `the gate named no failing contracts: ${stderr}`);
  const names = m[1].split(/, (?=R\d+\.\d+ )/);
  return { names, ids: names.map((n) => n.split(' ')[0]) };
}

test('R11.2 the demo reopens task 4 in the copy, plants the rounding bug, and prints that the gate refused the tick with the failing contract names', () => {
  const { res, folder, exampleAfter } = sharedRun();
  const out = res.stdout;
  assert.match(out, /Reopen task 4/);
  assert.match(out, /round each share/);
  assert.match(out, /task_update/);
  const refusedAt = out.indexOf('The gate refused the tick (exit 2).');
  assert.ok(refusedAt > out.indexOf('Demo folder:'), out);
  const failed = /^Contracts failed: (.+)$/m.exec(out);
  assert.ok(failed, out);
  assert.ok(out.indexOf(failed[0]) > refusedAt, 'the failing IDs follow the refusal');
  assert.ok(failed.index === out.indexOf('\n', refusedAt) + 1, 'the IDs line is the next line after the refusal');
  // The line holds only contract IDs, separated by commas.
  assert.match(failed[1], /^R\d+\.\d+(, R\d+\.\d+)*$/);
  assert.ok(out.indexOf('Contracts failed:') < out.indexOf('The gate accepted the tick'), 'refusal first, acceptance after');

  // The demo's refusal is the gate's. Plant the same bug in a fresh copy, send the same task_update call here, and compare.
  const { folder: gateFolder, taskLine } = plantedCopy();
  const call = JSON.stringify({
    hook_event_name: 'preToolUse',
    tool_name: 'task_update',
    tool_input: { tasksFilePath: '.kiro/specs/ledger/tasks.md', taskId: taskLine, status: 'completed' },
  });
  const gate = spawnSync(process.execPath, [BIN, 'hook', 'pre'], { cwd: gateFolder, input: call, encoding: 'utf8', env: cleanEnv(), timeout: 280_000 });
  assert.equal(gate.status, 2, `the gate should refuse the planted bug: ${gate.stdout}${gate.stderr}`);
  const named = gateNames(gate.stderr);
  assert.ok(named.ids.length > 0);
  assert.deepEqual(failed[1].split(', '), named.ids, 'the IDs the demo printed are exactly the IDs the gate named');
  assert.match(failed[1], /\bR2\.1\b/);
  assert.match(failed[1], /\bR2\.2\b/);
  // Each failing contract follows on its own indented line with its full name, in the gate's order.
  const after = out.slice(failed.index + failed[0].length + 1).split('\n');
  const indented = after.slice(0, named.names.length);
  assert.deepEqual(indented, named.names.map((n) => `  ${n}`));
  assert.ok(!/^\s/.test(after[named.names.length] ?? 'x') || after[named.names.length] === '', 'no more indented lines than failing contracts');

  // Task 4 was ticked in the bundled example and is open in the copy; the example keeps its tick.
  assert.match(fs.readFileSync(path.join(folder, '.kiro/specs/ledger/tasks.md'), 'utf8'), /^- \[ \] 4\. /m);
  assert.match(fs.readFileSync(path.join(EXAMPLE, '.kiro/specs/ledger/tasks.md'), 'utf8'), /^- \[x\] 4\. /m);
  assert.ok(exampleAfter['.kiro/specs/ledger/tasks.md']);
});

test('R11.3 the demo restores the correct code, sends the same call again, and prints that the gate accepted the tick and the receipt path', () => {
  const { res, folder } = sharedRun();
  const out = res.stdout;
  const acceptedAt = out.indexOf('The gate accepted the tick');
  assert.ok(acceptedAt > out.indexOf('The gate refused the tick'), out);
  const receipt = receiptOf(out);
  assert.ok(receipt, out);
  assert.ok(out.indexOf(`Receipt: ${receipt}`) > acceptedAt, 'the receipt path follows the acceptance');
  assert.ok(path.isAbsolute(receipt) && receipt.startsWith(folder + path.sep), receipt);
  assert.ok(receipt.includes(`${path.sep}.necro${path.sep}receipts${path.sep}ledger${path.sep}`), receipt);
  // The receipt is a genuine one for task 4: every contract passed and the file name is its hash.
  const body = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  assert.equal(body.spec, 'ledger');
  assert.equal(body.task.id, '4');
  assert.equal(path.basename(receipt), `${body.receiptHash}.json`);
  assert.ok(body.contracts.length > 0);
  assert.ok(body.contracts.every((c) => c.result === 'pass'));
  // The code was restored: the copy's split.js is the bundled one plus the line the demo adds at the end (R11.4).
  const bundled = fs.readFileSync(path.join(EXAMPLE, 'src/split.js'), 'utf8');
  assert.equal(fs.readFileSync(path.join(folder, 'src/split.js'), 'utf8'), `${bundled}// edited by the demo\n`);
});

test('R11.4 the demo verifies the receipt and prints CONFIRMED, then changes src/split.js in the copy and prints MISMATCH for the same receipt', () => {
  const { res, folder } = sharedRun();
  const out = res.stdout;
  const receipt = receiptOf(out);
  const hash = path.basename(receipt, '.json');
  const confirmedAt = out.indexOf(`CONFIRMED ${hash}`);
  const mismatchAt = out.indexOf('MISMATCH');
  assert.ok(confirmedAt > out.indexOf('Receipt:'), out);
  assert.ok(mismatchAt > confirmedAt, out);
  assert.match(out, /MISMATCH[^\n]*src\/split\.js/);
  // The verdicts are real: the copy still mismatches today, and gives CONFIRMED again once the change is undone.
  const split = path.join(folder, 'src/split.js');
  const edited = run(process.execPath, [BIN, 'verify', receipt], folder);
  assert.equal(edited.status, 1, edited.stdout + edited.stderr);
  assert.match(edited.stdout, /^MISMATCH/);
  fs.writeFileSync(split, fs.readFileSync(split, 'utf8').replace('// edited by the demo\n', ''));
  const undone = run(process.execPath, [BIN, 'verify', receipt], folder);
  assert.equal(undone.status, 0, undone.stdout + undone.stderr);
  assert.match(undone.stdout, new RegExp(`^CONFIRMED ${hash}`));
});

test('R11.5 the demo exits 0 when every step happened as described, and exits 1 naming the step that did not', () => {
  const { res } = sharedRun();
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.equal(res.stderr, '');

  // A copy of the package whose example has a bug that "restore the correct code" cannot remove: the shares are off by
  // one cent, in a way that keeps the text the demo plants its own bug into. The gate refuses both times.
  const pkg = temp('necro-core-demo-pkg-');
  fs.cpSync(path.join(REPO, 'bin'), path.join(pkg, 'bin'), { recursive: true });
  fs.cpSync(path.join(REPO, 'src'), path.join(pkg, 'src'), { recursive: true });
  fs.cpSync(EXAMPLE, path.join(pkg, 'examples', 'pumpkin-ledger'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(pkg, 'package.json'));
  const split = path.join(pkg, 'examples', 'pumpkin-ledger', 'src', 'split.js');
  const text = fs.readFileSync(split, 'utf8');
  assert.ok(text.includes('base + (i < extra ? 1 : 0)'));
  fs.writeFileSync(split, text.replace('base + (i < extra ? 1 : 0)', 'base + (i < extra ? 2 : 0)'));

  const elsewhere = temp('necro-core-demo-cwd-');
  const failed = demoWith(path.join(pkg, 'bin', 'necro.js'), elsewhere);
  const folder = folderOf(failed.stdout);
  if (folder) made.push(folder);
  assert.equal(failed.status, 1, `${failed.stdout}${failed.stderr}`);
  assert.match(failed.stderr, /Demo failed at step 'acceptance'/);
  assert.match(failed.stdout, /The gate refused the tick/);
  assert.doesNotMatch(failed.stdout, /Receipt:|CONFIRMED|MISMATCH/);
});

test('R11.6 the packed package, unpacked into an empty folder with no other file of this repository, runs the same demo', () => {
  const dest = temp('necro-core-demo-pack-');
  const packed = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dest], REPO);
  assert.equal(packed.status, 0, packed.stderr);
  const [info] = JSON.parse(packed.stdout);
  const listed = new Set(info.files.map((f) => f.path));
  for (const rel of ['package.json', 'bin/necro.js', 'src/demo.js', 'src/verify.js', 'src/hooks.js']) {
    assert.ok(listed.has(rel), `npm pack leaves out ${rel}`);
  }
  for (const rel of Object.keys(snapshot(EXAMPLE))) {
    assert.ok(listed.has(`examples/pumpkin-ledger/${rel}`), `npm pack leaves out examples/pumpkin-ledger/${rel}`);
  }

  const unpacked = path.join(dest, 'unpacked');
  fs.mkdirSync(unpacked);
  const tar = run('tar', ['-xzf', path.join(dest, info.filename), '-C', unpacked], dest);
  assert.equal(tar.status, 0, tar.stderr);
  const pkg = path.join(unpacked, 'package');
  const elsewhere = temp('necro-core-demo-cwd-');
  const res = demoWith(path.join(pkg, 'bin', 'necro.js'), elsewhere);
  const folder = folderOf(res.stdout);
  if (folder) made.push(folder);
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /The gate refused the tick/);
  assert.match(res.stdout, /The gate accepted the tick/);
  assert.match(res.stdout, /^CONFIRMED [0-9a-f]{64}\.$/m);
  assert.match(res.stdout, /^MISMATCH/m);
  const engines = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).engines;
  assert.equal(engines.node, '>=24');
});
