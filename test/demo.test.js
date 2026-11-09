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

// Req 12: the look of the demo. A real terminal cannot be attached in a test, so the tests set NECRO_DEMO_FORCE_TTY=1, a
// hook that exists for them only.
const ESC = '\x1b[';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const VIEWER = 'https://vijaygopalbalasa.github.io/contract-necromancer/';

function runLook(extra, drop = []) {
  const env = cleanEnv();
  delete env.NO_COLOR;
  for (const k of drop) delete env[k];
  Object.assign(env, extra);
  const res = spawnSync(process.execPath, [BIN, 'demo'], { cwd: os.tmpdir(), encoding: 'utf8', env, timeout: 280_000 });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const looks = {};
const lookFolders = [];
function look(name, extra) {
  if (!looks[name]) {
    looks[name] = runLook(extra);
    const dir = folderOf(looks[name].stdout.replaceAll(/\x1b\[[0-9;]*m/g, ''));
    if (dir) lookFolders.push(dir);
  }
  return looks[name];
}
const colored = () => look('tty', { NECRO_DEMO_FORCE_TTY: '1' });
const strip = (s) => s.replaceAll(/\x1b\[[0-9;]*m/g, '');
const lineWith = (out, text) => out.split('\n').find((l) => strip(l).includes(text));

test('R12.1 on a terminal without NO_COLOR the refusal and MISMATCH are red and the acceptance and CONFIRMED are green, each with a text symbol', () => {
  const run = colored();
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  const refused = lineWith(run.stdout, 'The gate refused the tick');
  const accepted = lineWith(run.stdout, 'The gate accepted the tick');
  const confirmed = lineWith(run.stdout, 'CONFIRMED ');
  const mismatch = lineWith(run.stdout, 'MISMATCH');
  for (const [line, colour] of [[refused, RED], [mismatch, RED], [accepted, GREEN], [confirmed, GREEN]]) {
    assert.ok(line, run.stdout);
    assert.ok(line.startsWith(colour), `not coloured ${JSON.stringify(colour)}: ${JSON.stringify(line)}`);
    assert.ok(line.endsWith(`${ESC}0m`), `colour not reset: ${JSON.stringify(line)}`);
    // A symbol in plain text, so the line still says which side it is on once the colour is gone.
    assert.match(strip(line), /^[✓✗] \S/, `no symbol: ${JSON.stringify(strip(line))}`);
  }
  assert.match(strip(refused), /^✗ /);
  assert.match(strip(mismatch), /^✗ MISMATCH/);
  assert.match(strip(accepted), /^✓ /);
  assert.match(strip(confirmed), /^✓ CONFIRMED [0-9a-f]{64}\.$/);
  // The failing contract lines and everything that is not a verdict stay uncoloured.
  assert.doesNotMatch(lineWith(run.stdout, 'Demo folder:'), /\x1b/);
  assert.doesNotMatch(lineWith(run.stdout, 'Receipt:'), /\x1b/);
});

test('R12.2 with NO_COLOR set, or when stdout is piped, the demo prints no ANSI escape codes at all', () => {
  const noColor = look('nocolor', { NECRO_DEMO_FORCE_TTY: '1', NO_COLOR: '1' });
  assert.equal(noColor.status, 0, `${noColor.stdout}${noColor.stderr}`);
  assert.ok(!noColor.stdout.includes(ESC) && !noColor.stderr.includes(ESC), JSON.stringify(noColor.stdout));
  // Piped: this run has no forced terminal, and its stdout is a pipe.
  const piped = look('piped', {});
  assert.equal(piped.status, 0, `${piped.stdout}${piped.stderr}`);
  assert.ok(!piped.stdout.includes(ESC) && !piped.stderr.includes(ESC), JSON.stringify(piped.stdout));
  // The plain text is the same lines that the Requirement 11 tests read.
  assert.ok(piped.stdout.split('\n').includes('The gate refused the tick (exit 2).'));
  assert.match(piped.stdout, /^CONFIRMED [0-9a-f]{64}\.$/m);
  assert.match(piped.stdout, /^MISMATCH/m);
  // Colour carries no new words beyond the symbols: stripped, the terminal run is the plain run with symbols in front.
  const unsymbol = strip(colored().stdout).replaceAll(/^[✓✗] /gm, '').replaceAll(/necro-demo-\w+/g, 'F').replaceAll(/[0-9a-f]{64}/g, 'H');
  const plain = piped.stdout.replaceAll(/necro-demo-\w+/g, 'F').replaceAll(/[0-9a-f]{64}/g, 'H');
  assert.equal(unsymbol, plain);
});

test('R12.3 on success the last line names the live viewer and says the receipt file can be pasted or chosen there', () => {
  for (const run of [look('piped', {}), colored()]) {
    const lines = strip(run.stdout).trimEnd().split('\n');
    const last = lines[lines.length - 1];
    assert.ok(last.includes(VIEWER), last);
    assert.match(last, /receipt/i);
    assert.match(last, /paste/i);
    assert.match(last, /choose/i);
    // It does not claim a link to the temporary file.
    assert.doesNotMatch(last, /file:\/\/|necro-demo-|\.json/);
    assert.doesNotMatch(last, /\u2014|\u2013/);
  }
});

test('R12.3 a failed demo does not print the viewer line', async () => {
  const { runDemo } = await import('../src/demo.js');
  const out = [];
  const result = runDemo({ out: (s) => out.push(s), err: () => {}, restore: () => {} });
  try {
    assert.equal(result.exitCode, 1);
    assert.doesNotMatch(out.join('\n'), /github\.io/);
  } finally {
    removeDemoFolder(result.folder);
  }
});

test('cleanup of the demo folders made by the look tests', () => {
  for (const dir of lookFolders) removeDemoFolder(dir);
});

test('cleanup of the demo folders made by this file', () => {
  for (const run of [runs.root, runs.far]) {
    const dir = folderOf(run.stdout);
    if (dir) removeDemoFolder(dir);
  }
  fs.rmSync(runs.elsewhere, { recursive: true, force: true });
});
