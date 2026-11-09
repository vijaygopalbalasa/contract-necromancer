// Unit tests for `necro demo` (Req 11.1 to 11.6).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
const BIN = path.join(REPO, 'bin', 'necro.js');
const EXAMPLE = path.join(REPO, 'examples', 'pumpkin-ledger');

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

// Every file under a folder, as "relative path -> sha256", dotfiles included.
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

function runCli(cwd) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [BIN, 'demo'], { cwd, encoding: 'utf8', env: cleanEnv(), timeout: 280_000 });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, ms: Date.now() - started };
}

// Remove a demo folder, but only one that the demo made under the temporary directory.
function removeDemoFolder(dir) {
  assert.ok(dir.startsWith(os.tmpdir() + path.sep) && path.basename(dir).startsWith('necro-demo-'), `not a demo folder: ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

const folderOf = (stdout) => /^Demo folder: (.+)$/m.exec(stdout)?.[1];

// Run the demo once from the repository root and once from an unrelated folder, and keep what each did.
const runs = {};
before(() => {
  const exampleBefore = snapshot(EXAMPLE);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-demo-cwd-'));
  runs.exampleBefore = exampleBefore;
  runs.root = runCli(REPO);
  runs.far = runCli(elsewhere);
  runs.elsewhere = elsewhere;
  runs.exampleAfter = snapshot(EXAMPLE);
});

test('R11.1 necro demo works from the repository root and from an unrelated folder and prints a new folder under the temporary directory', () => {
  const folders = [];
  for (const [label, run] of [['repository root', runs.root], ['unrelated folder', runs.far]]) {
    assert.equal(run.status, 0, `${label}: ${run.stdout}${run.stderr}`);
    const dir = folderOf(run.stdout);
    assert.ok(dir, `${label}: no "Demo folder:" line in ${run.stdout}`);
    assert.ok(path.isAbsolute(dir), label);
    assert.ok(dir.startsWith(os.tmpdir() + path.sep), `${label}: ${dir} is not under ${os.tmpdir()}`);
    assert.ok(fs.existsSync(path.join(dir, 'src', 'split.js')), `${label}: the copy has no src/split.js`);
    folders.push(dir);
  }
  assert.notEqual(folders[0], folders[1], 'each run makes its own folder');
  // The folder path is the first thing printed.
  assert.ok(runs.root.stdout.trimStart().startsWith('Demo folder:'));
  // Nothing was written in the folder the demo ran from.
  assert.deepEqual(fs.readdirSync(runs.elsewhere), []);
});

test('R11.2 the demo shows the gate refusing the tick, one line of contract IDs including R2.1, then each failing contract with its full name', () => {
  for (const run of [runs.root, runs.far]) {
    const lines = run.stdout.split('\n');
    const refused = lines.findIndex((l) => l === 'The gate refused the tick (exit 2).');
    assert.ok(refused > lines.findIndex((l) => l.startsWith('Demo folder:')), run.stdout);
    // The line right after the refusal holds only IDs, separated by commas.
    const idsLine = lines[refused + 1];
    const m = /^Contracts failed: (R\d+\.\d+(?:, R\d+\.\d+)*)$/.exec(idsLine);
    assert.ok(m, `not an IDs-only line: ${idsLine}`);
    const ids = m[1].split(', ');
    assert.ok(ids.includes('R2.1') && ids.includes('R2.2'), idsLine);
    // Then one indented line per ID, starting with that ID and holding more than the ID.
    const names = lines.slice(refused + 2, refused + 2 + ids.length);
    names.forEach((line, i) => {
      assert.match(line, /^ {2}\S/, `not indented: ${line}`);
      assert.ok(line.startsWith(`  ${ids[i]} `) && line.length > ids[i].length + 3, `no full name for ${ids[i]}: ${line}`);
    });
    // The block ends there: the next line is blank, then step 3.
    assert.equal(lines[refused + 2 + ids.length], '');
    assert.match(lines[refused + 3 + ids.length], /^Step 3\./);
  }
});

test('R11.2 the failing names are split at the next contract ID, so a comma inside a name stays in that name', async () => {
  const { parseFailing } = await import('../src/demo.js');
  assert.deepEqual(parseFailing('Contracts failed: R1.1 a, b and c, R1.2 d.\n'), {
    ids: ['R1.1', 'R1.2'],
    names: ['R1.1 a, b and c', 'R1.2 d'],
  });
  assert.deepEqual(parseFailing('Contracts failed: R10.1 only one.'), { ids: ['R10.1'], names: ['R10.1 only one'] });
  assert.equal(parseFailing('Spec is not frozen.'), null);
  assert.equal(parseFailing('Contracts failed: .'), null);
});

test('R11.3 the demo then shows the gate accepting the tick and the receipt it wrote', () => {
  for (const run of [runs.root, runs.far]) {
    const dir = folderOf(run.stdout);
    const m = /^Receipt: (.+\.json)$/m.exec(run.stdout);
    assert.ok(m, run.stdout);
    assert.ok(run.stdout.indexOf(m[0]) > run.stdout.indexOf('Contracts failed:'), 'the receipt comes after the refusal');
    assert.ok(path.isAbsolute(m[1]) && m[1].startsWith(dir + path.sep), m[1]);
    assert.ok(fs.existsSync(m[1]), `receipt ${m[1]} was not written`);
    assert.match(run.stdout, /accepted/i);
  }
});

test('R11.4 the demo prints CONFIRMED for the receipt and then MISMATCH after src/split.js changes, in that order', () => {
  for (const run of [runs.root, runs.far]) {
    const out = run.stdout;
    const order = [out.indexOf('Demo folder:'), out.indexOf('Contracts failed:'), out.indexOf('Receipt:'), out.indexOf('CONFIRMED'), out.indexOf('MISMATCH')];
    assert.ok(order.every((n) => n >= 0), out);
    assert.deepEqual([...order].sort((a, b) => a - b), order, out);
    // The mismatch is the one that names the changed file.
    assert.match(out, /MISMATCH[^\n]*src\/split\.js/);
  }
});

test('R11.5 the demo exits 0 when every step happened and the bundled example is byte for byte unchanged', () => {
  assert.equal(runs.root.status, 0);
  assert.equal(runs.far.status, 0);
  assert.deepEqual(runs.exampleAfter, runs.exampleBefore, 'examples/pumpkin-ledger changed');
  // The copy, not the bundled example, was edited.
  const dir = folderOf(runs.root.stdout);
  assert.match(fs.readFileSync(path.join(dir, 'src', 'split.js'), 'utf8'), /edited by the demo/);
  assert.doesNotMatch(fs.readFileSync(path.join(EXAMPLE, 'src', 'split.js'), 'utf8'), /edited by the demo/);
});

test('R11.5 a demo whose acceptance step is forced to fail exits 1 and names that step', async () => {
  const { runDemo } = await import('../src/demo.js');
  const out = [];
  const err = [];
  // The fix is not applied, so the gate refuses the second call too.
  const result = runDemo({ out: (s) => out.push(s), err: (s) => err.push(s), restore: () => {} });
  try {
    assert.equal(result.exitCode, 1);
    assert.equal(result.failedStep, 'acceptance');
    assert.match(err.join('\n'), /acceptance/);
    assert.doesNotMatch(out.join('\n'), /Receipt:/);
  } finally {
    removeDemoFolder(result.folder);
  }
});

test('R11.5 a demo whose bug is not planted exits 1 and names the refusal step', async () => {
  const { runDemo } = await import('../src/demo.js');
  const err = [];
  const result = runDemo({ out: () => {}, err: (s) => err.push(s), plant: () => {} });
  try {
    assert.equal(result.exitCode, 1);
    assert.equal(result.failedStep, 'refusal');
    assert.match(err.join('\n'), /refusal/);
  } finally {
    removeDemoFolder(result.folder);
  }
});

test('R11.6 npm pack lists every file the demo reads', () => {
  const res = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: REPO, encoding: 'utf8', env: cleanEnv() });
  assert.equal(res.status, 0, res.stderr);
  const packed = new Set(JSON.parse(res.stdout)[0].files.map((f) => f.path));
  const needed = ['package.json', 'bin/necro.js', ...fs.readdirSync(path.join(REPO, 'src')).map((f) => `src/${f}`)];
  for (const rel of Object.keys(snapshot(EXAMPLE))) needed.push(`examples/pumpkin-ledger/${rel}`);
  const missing = needed.filter((p) => !packed.has(p));
  assert.deepEqual(missing, [], `npm pack leaves out: ${missing.join(', ')}`);
});

test('R11.6 the demo needs no dependency that is not a Node built-in', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  const source = fs.readFileSync(path.join(REPO, 'src', 'demo.js'), 'utf8');
  for (const m of source.matchAll(/from '([^']+)'/g)) assert.match(m[1], /^(node:|\.)/, `non built-in import ${m[1]}`);
});

test('cleanup of the demo folders made by this file', () => {
  for (const run of [runs.root, runs.far]) {
    const dir = folderOf(run.stdout);
    if (dir) removeDemoFolder(dir);
  }
  fs.rmSync(runs.elsewhere, { recursive: true, force: true });
});
