// Task 7: contrast helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio } from '../src/contrast.js';

test('black on white is 21', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-9);
});

test('white on white is 1', () => {
  assert.ok(Math.abs(contrastRatio('#ffffff', '#ffffff') - 1) < 1e-9);
});

test('a known mid-grey pair', () => {
  // #777777 on #ffffff is about 4.48:1.
  const r = contrastRatio('#777777', '#ffffff');
  assert.ok(r > 4.4 && r < 4.6, `got ${r}`);
});
