import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { plain } from '../src/plain.js';

// plain(value) (Req 13.16): the data of a result, read without calling any method the result carries.

const trap = () => {
  throw new Error('a method of the result ran');
};

class LyingString extends String {
  split() { return trap(); }
  toString() { return trap(); }
  valueOf() { return trap(); }
  [Symbol.iterator]() { return trap(); }
}

class LyingArray extends Array {
  map() { return trap(); }
  some() { return trap(); }
  includes() { return trap(); }
  slice() { return trap(); }
  [Symbol.iterator]() { return trap(); }
}

test('primitives come back as they are', () => {
  for (const v of [0, -1.5, 'text', '', true, false, null, undefined, 10n]) assert.equal(plain(v), v);
  assert.ok(Number.isNaN(plain(NaN)));
});

test('a String, Number, Boolean or BigInt object comes back as the primitive, whatever its methods say', () => {
  assert.equal(plain(new LyingString('a b')), 'a b');
  assert.equal(plain(new Number(4)), 4);
  assert.equal(plain(new Boolean(false)), false);
  assert.equal(plain(Object(7n)), 7n);
  assert.equal(typeof plain(new LyingString('x')), 'string');
});

test('a subclass of Array comes back as a new plain array holding plain values', () => {
  const source = LyingArray.from(['a', new LyingString('b'), LyingArray.from([1, 2])]);
  const out = plain(source);
  assert.notEqual(out, source);
  assert.ok(Array.isArray(out));
  assert.equal(Object.getPrototypeOf(out), Array.prototype);
  assert.deepEqual(out, ['a', 'b', [1, 2]]);
  assert.equal(Object.getPrototypeOf(out[2]), Array.prototype);
  assert.equal(out.includes('b'), true, 'the built-in includes, not the doctored one');
});

test('holes in an array stay holes', () => {
  const out = plain([1, , 3]); // eslint-disable-line no-sparse-arrays
  assert.equal(out.length, 3);
  assert.equal(1 in out, false);
});

test('an object, a class instance and a null-prototype object come back as plain objects of their own enumerable properties', () => {
  class Row { constructor() { this.name = new LyingString('Ann'); this.cents = 5; } get hidden() { return trap(); } }
  const bare = Object.create(null);
  bare.k = 1;
  const out = plain({ row: new Row(), bare, list: [{ n: 1 }] });
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(Object.getPrototypeOf(out.row), Object.prototype);
  assert.equal(Object.getPrototypeOf(out.bare), Object.prototype);
  assert.deepEqual(out, { row: { name: 'Ann', cents: 5 }, bare: { k: 1 }, list: [{ n: 1 }] });
});

test('a key named __proto__ stays an own key and does not change the prototype', () => {
  const source = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
  const out = plain(source);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(out.polluted, undefined);
  assert.deepEqual(Object.keys(out), ['__proto__', 'a']);
});

test('a Map comes back as a plain Map copy, a Set as a plain Set copy, a Date as a new Date', () => {
  class LyingMap extends Map { get() { return trap(); } forEach() { return trap(); } entries() { return trap(); } [Symbol.iterator]() { return trap(); } }
  class LyingSet extends Set { has() { return trap(); } forEach() { return trap(); } values() { return trap(); } [Symbol.iterator]() { return trap(); } }
  const map = new LyingMap([[new LyingString('k'), LyingArray.from([1])]]);
  const copy = plain(map);
  assert.equal(Object.getPrototypeOf(copy), Map.prototype);
  assert.deepEqual([...copy], [['k', [1]]]);
  copy.set('z', 2);
  assert.equal(map.size, 1);

  const set = plain(new LyingSet([1, new LyingString('b')]));
  assert.equal(Object.getPrototypeOf(set), Set.prototype);
  assert.deepEqual([...set], [1, 'b']);

  const when = new Date(86400000);
  const day = plain(when);
  assert.notEqual(day, when);
  assert.equal(day.getTime(), 86400000);
});

test('a structure that holds itself does not loop', () => {
  const a = { name: 'a', list: [] };
  a.list.push(a);
  a.self = a;
  const out = plain(a);
  assert.equal(out.self, out);
  assert.equal(out.list[0], out);
  assert.notEqual(out, a);
});

test('functions, symbols, errors and regular expressions are not data and come back unchanged', () => {
  const f = () => 1;
  const s = Symbol('s');
  const e = new RangeError('x');
  const r = /x/g;
  assert.equal(plain(f), f);
  assert.equal(plain(s), s);
  assert.equal(plain(e), e);
  assert.equal(plain(r), r);
});

test('src/plain.js imports nothing', () => {
  const code = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'plain.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bimport\b/);
  assert.doesNotMatch(code, /\bprocess\b/);
});
