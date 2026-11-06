// Contracts for Requirement 1 (canonical hashing) of the necro-core spec.
//
// The static import below is what makes the receipt pin src/canon.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { canonicalJson, sha256 } from '../../src/canon.js';

const HEX64 = /^[0-9a-f]{64}$/;

// Independent oracle: Node's own SHA-256.
function nodeSha(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

test('R1.1 canonicalJson sorts object keys recursively and writes no whitespace', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(
    canonicalJson({ z: [3, 1, 2], a: { y: { b: 2, a: 1 } } }),
    '{"a":{"y":{"a":1,"b":2}},"z":[3,1,2]}',
  );

  // Objects inside arrays are sorted too, and the array order is kept.
  assert.equal(
    canonicalJson([{ b: 1, a: 2 }, { d: [{ f: 1, e: 2 }], c: null }]),
    '[{"a":2,"b":1},{"c":null,"d":[{"e":2,"f":1}]}]',
  );

  // Scalars.
  assert.equal(
    canonicalJson({ n: 1.5, t: true, f: false, z: null, s: 'a b' }),
    '{"f":false,"n":1.5,"s":"a b","t":true,"z":null}',
  );

  // No whitespace between tokens (spaces inside strings are data, so strings are blanked first).
  const text = canonicalJson({ x: { y: [1, 2, { b: 1, a: 2 }] }, a: 'with space', k: 'line\nbreak' });
  assert.doesNotMatch(text.replace(/"(?:[^"\\]|\\.)*"/g, '""'), /\s/);

  // The input is not changed.
  const input = { b: 1, a: { d: 1, c: 2 } };
  canonicalJson(input);
  assert.deepEqual(Object.keys(input), ['b', 'a']);
  assert.deepEqual(Object.keys(input.a), ['d', 'c']);
});

test('R1.2 sha256 returns the SHA-256 digest as 64 lowercase hex characters', () => {
  const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), abc);

  // Bytes give the same digest as the same text.
  assert.equal(sha256(Buffer.from('abc', 'utf8')), abc);
  assert.equal(sha256(new Uint8Array([0x61, 0x62, 0x63])), abc);

  // Text is hashed as UTF-8.
  const text = 'héllo € 𝄞';
  assert.equal(sha256(text), nodeSha(Buffer.from(text, 'utf8')));

  // Bytes that are not valid UTF-8 are hashed as they are.
  const raw = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x0d, 0x0a]);
  assert.equal(sha256(raw), nodeSha(raw));

  for (const sample of ['', 'abc', 'UPPER lower 123', text, raw]) {
    const digest = sha256(sample);
    assert.match(digest, HEX64);
    assert.equal(digest, digest.toLowerCase());
  }
});

test('R1.3 the same value hashed in different key orders gives the same hash', () => {
  const a = { b: 2, a: 1, c: { f: [{ y: 1, x: 2 }], e: 5 } };
  const b = { c: { e: 5, f: [{ x: 2, y: 1 }] }, a: 1, b: 2 };
  assert.equal(sha256(canonicalJson(a)), sha256(canonicalJson(b)));

  // The hash still depends on the content.
  assert.notEqual(sha256(canonicalJson(a)), sha256(canonicalJson({ ...a, a: 2 })));
  assert.notEqual(sha256(canonicalJson({ x: [1, 2] })), sha256(canonicalJson({ x: [2, 1] })));
});
