// Contracts for Requirement 12 of the necro-core spec: a demo that reads at a glance.
//
// R12.1  WHEN `necro demo` writes to a terminal (stdout is a TTY) and the `NO_COLOR` environment variable is not set THE
//        SYSTEM SHALL colour the refusal and `MISMATCH` red and the acceptance and `CONFIRMED` green, and mark each with a
//        short text symbol that also reads without colour.
// R12.2  WHEN stdout is not a TTY or `NO_COLOR` is set THE SYSTEM SHALL print no ANSI escape codes, so piped output, CI logs
//        and the existing Requirement 11 contracts see plain text.
// R12.3  WHEN the demo succeeds THE SYSTEM SHALL end with one line naming the live receipt viewer,
//        `https://vijaygopalbalasa.github.io/contract-necromancer/`, and saying the receipt file can be opened there
//        (pasted or chosen), without claiming a direct link to the temporary file.
//
// The tests run the real command line. A test cannot attach a terminal, so R12.1 sets NECRO_DEMO_FORCE_TTY=1, a hook that
// stands in for stdout being a TTY. R12.2 runs the demo piped (the way a test sees it) and with NO_COLOR set on a forced
// terminal. This file carries its own helpers.
//
// The demo uses these files. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/demo.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');
const VIEWER = 'https://vijaygopalbalasa.github.io/contract-necromancer/';
const CSI = '\u001b[';
const RED = `${CSI}31m`;
const GREEN = `${CSI}32m`;
const RESET = `${CSI}0m`;
const ANSI = /\u001b\[[0-9;]*m/g;

const strip = (s) => s.replaceAll(ANSI, '');

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  delete env.NO_COLOR;
  delete env.NECRO_DEMO_FORCE_TTY;
  return env;
}

const made = [];
process.on('exit', () => {
  for (const d of made) {
    if (d.startsWith(os.tmpdir() + path.sep)) fs.rmSync(d, { recursive: true, force: true });
  }
});

// One demo run per kind of environment, made on first use.
const runs = {};
function demo(kind, extraEnv) {
  if (!runs[kind]) {
    const res = spawnSync(process.execPath, [BIN, 'demo'], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: { ...cleanEnv(), ...extraEnv },
      timeout: 280_000,
    });
    const out = res.stdout || '';
    const folder = /^Demo folder: (.+)$/m.exec(strip(out))?.[1];
    if (folder && path.basename(folder).startsWith('necro-demo-')) made.push(folder);
    runs[kind] = { status: res.status, stdout: out, stderr: res.stderr || '' };
  }
  return runs[kind];
}

const terminal = () => demo('terminal', { NECRO_DEMO_FORCE_TTY: '1' });
const piped = () => demo('piped', {});
const terminalNoColor = () => demo('terminal-no-color', { NECRO_DEMO_FORCE_TTY: '1', NO_COLOR: '1' });

const lineWith = (out, text) => out.split('\n').find((l) => strip(l).includes(text));

test('R12.1 on a terminal without NO_COLOR the refusal and MISMATCH are red and the acceptance and CONFIRMED are green, each with a text symbol', () => {
  const run = terminal();
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  const refused = lineWith(run.stdout, 'The gate refused the tick');
  const accepted = lineWith(run.stdout, 'The gate accepted the tick');
  const confirmed = lineWith(run.stdout, 'CONFIRMED ');
  const mismatch = lineWith(run.stdout, 'MISMATCH');
  for (const [line, colour] of [[refused, RED], [mismatch, RED], [accepted, GREEN], [confirmed, GREEN]]) {
    assert.ok(line, run.stdout);
    assert.ok(line.startsWith(colour), `expected ${JSON.stringify(colour)} at the start of ${JSON.stringify(line)}`);
    assert.ok(line.endsWith(RESET), `the colour is not reset at the end of ${JSON.stringify(line)}`);
    // The symbol is plain text: it is still there when the colour codes are removed.
    assert.match(strip(line), /^[\u2713\u2717] \S/, `no symbol on ${JSON.stringify(strip(line))}`);
  }
  assert.match(strip(refused), /^\u2717 The gate refused the tick/);
  assert.match(strip(mismatch), /^\u2717 MISMATCH/);
  assert.match(strip(accepted), /^\u2713 The gate accepted the tick/);
  assert.match(strip(confirmed), /^\u2713 CONFIRMED [0-9a-f]{64}\.$/);
  // Red and green are used for the verdicts only: no other line carries a colour.
  const coloured = run.stdout.split('\n').filter((l) => l.includes(CSI));
  assert.deepEqual(
    coloured.map((l) => strip(l).split(' ').slice(0, 3).join(' ')).sort(),
    [refused, accepted, confirmed, mismatch].map((l) => strip(l).split(' ').slice(0, 3).join(' ')).sort(),
  );
});

test('R12.2 when NO_COLOR is set, or stdout is not a terminal, the demo prints no ANSI escape codes and the same plain lines as before', () => {
  for (const [label, run] of [['NO_COLOR on a terminal', terminalNoColor()], ['piped', piped()]]) {
    assert.equal(run.status, 0, `${label}: ${run.stdout}${run.stderr}`);
    assert.ok(!run.stdout.includes(CSI), `${label}: escape codes in ${JSON.stringify(run.stdout)}`);
    assert.ok(!run.stdout.includes('\u001b') && !run.stderr.includes('\u001b'), label);
    // The lines the Requirement 11 contracts read are there, unchanged.
    const lines = run.stdout.split('\n');
    assert.ok(lines.includes('The gate refused the tick (exit 2).'), label);
    assert.ok(lines.some((l) => /^The gate accepted the tick \(exit 0\)\.$/.test(l)), label);
    assert.match(run.stdout, /^CONFIRMED [0-9a-f]{64}\.$/m, label);
    assert.match(run.stdout, /^MISMATCH/m, label);
  }
});

test('R12.3 on success the last line names the live viewer and says the receipt file can be pasted or chosen there, without a link to the temporary file', () => {
  for (const run of [piped(), terminal(), terminalNoColor()]) {
    const lines = strip(run.stdout).trimEnd().split('\n');
    const last = lines[lines.length - 1];
    assert.ok(last.includes(VIEWER), last);
    assert.match(last, /receipt file/i);
    assert.match(last, /paste/i);
    assert.match(last, /choose/i);
    // It points at the viewer's address only: no file link, no path of the demo folder, no receipt file name.
    assert.equal(last.split(VIEWER).length, 2, 'the viewer address appears once');
    assert.doesNotMatch(last, /file:\/\/|necro-demo-|\.json|[0-9a-f]{64}/);
    assert.doesNotMatch(last, /[\u2014\u2013]/);
    // Only the last line speaks of the viewer.
    assert.equal(lines.filter((l) => l.includes('github.io')).length, 1);
  }
});
