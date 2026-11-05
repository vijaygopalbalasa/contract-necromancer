import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, sha256, hashFile } from '../src/canon.js';

test('R1.1 canonicalJson sorts object keys recursively and produces no whitespace', () => {
  const input = { b: 1, a: { d: 2, c: 3 } };
  assert.equal(canonicalJson(input), '{"a":{"c":3,"d":2},"b":1}');
});

test('R1.1 canonicalJson keeps array order and sorts nested object keys', () => {
  const input = { z: [3, 1, 2], a: { y: { b: 2, a: 1 } } };
  assert.equal(canonicalJson(input), '{"a":{"y":{"a":1,"b":2}},"z":[3,1,2]}');
});

test('R1.1 canonicalJson never inserts whitespace', () => {
  assert.ok(!/\s/.test(canonicalJson({ x: { y: 1 }, a: [1, 2] })));
});

test('R1.2 sha256 returns 64 lowercase hex for strings', () => {
  const hash = sha256('hello');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('R1.2 sha256 returns 64 lowercase hex for bytes', () => {
  const bytes = Buffer.from('hello', 'utf8');
  const hash = sha256(bytes);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, sha256('hello'));
});

test('R1.2 sha256 output is always lowercase', () => {
  assert.ok(!/[A-F]/.test(sha256('uppercase check')));
});

test('R1.3 same value with keys in different orders produces the same hash', () => {
  const a = { b: 2, a: 1, c: { f: 6, e: 5 } };
  const b = { a: 1, b: 2, c: { e: 5, f: 6 } };
  assert.equal(sha256(canonicalJson(a)), sha256(canonicalJson(b)));
});

test('hashFile hashes raw file bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-canon-'));
  try {
    const file = path.join(dir, 'sample.txt');
    fs.writeFileSync(file, 'hello');
    assert.equal(hashFile(file), sha256('hello'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
