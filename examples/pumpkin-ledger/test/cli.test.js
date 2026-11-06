import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/ledger.js', import.meta.url));

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-cli-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const run = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

test('ledger <file> prints the table and payments and exits 0', () => {
  withDir((dir) => {
    const file = join(dir, 'party.txt');
    writeFileSync(file, 'Ann paid 10.00 for pizza split Ann,Bob,Cy\n');
    const r = run([file]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    const lines = r.stdout.split('\n').map((l) => l.trim());
    assert.ok(lines.some((l) => l.startsWith('Name')));
    assert.ok(lines.includes('Bob pays Ann 3.33'));
  });
});

test('ledger <file> --json prints parseable JSON', () => {
  withDir((dir) => {
    const file = join(dir, 'party.txt');
    writeFileSync(file, 'Ann paid 10.00 for pizza split Ann,Bob,Cy\n');
    const r = run([file, '--json']);
    assert.equal(r.status, 0);
    const printed = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(printed), ['balances', 'payments']);
  });
});

test('a missing file exits 1 with one sentence on stderr', () => {
  withDir((dir) => {
    const missing = join(dir, 'missing.txt');
    const r = run([missing]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr.trimEnd(), `Cannot read ${missing}.`);
  });
});

test('a bad line exits 1 with the Line <n>: sentence', () => {
  withDir((dir) => {
    const file = join(dir, 'party.txt');
    writeFileSync(file, 'Ann paid 5 for tea\nbogus line\n');
    const r = run([file]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr.trimEnd(), "Line 2: Write the line as '<payer> paid <amount> for <what>'.");
  });
});

test('a missing argument exits 1 with the usage sentence', () => {
  const r = run([]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trimEnd(), 'Usage: ledger <file> [--json]');
});
