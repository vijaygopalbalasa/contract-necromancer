import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReceipt } from '../site/lib/receipt.js';
import { computeReceiptHash } from '../site/lib/canon.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const samplePath = path.join(root, 'site', 'sample-receipt.json');
const text = fs.readFileSync(samplePath, 'utf8');

test('the sample receipt parses with parseReceipt', () => {
  const parsed = parseReceipt(text);
  assert.equal(parsed.ok, true, parsed.message);
});

test('the sample receipt hash equals its recomputed hash', async () => {
  const receipt = JSON.parse(text);
  assert.equal(await computeReceiptHash(receipt), receipt.receiptHash);
});

test('the sample receipt is for a spec that exists in this repository', () => {
  const receipt = JSON.parse(text);
  assert.ok(fs.existsSync(path.join(root, '.kiro', 'specs', receipt.spec, 'requirements.md')), receipt.spec);
});

test('every contract in the sample receipt passed', () => {
  const receipt = JSON.parse(text);
  const failing = receipt.contracts.filter((c) => c.result !== 'pass').map((c) => c.name);
  assert.deepEqual(failing, []);
});

test('the sample receipt is a byte copy of a receipt the gate wrote in .necro/receipts', () => {
  const receipt = JSON.parse(text);
  const written = path.join(root, '.necro', 'receipts', receipt.spec, `${receipt.receiptHash}.json`);
  assert.ok(fs.existsSync(written), `no gate receipt at ${path.relative(root, written)}`);
  assert.equal(fs.readFileSync(written, 'utf8'), text, 'the sample was edited after the gate wrote it');
});
