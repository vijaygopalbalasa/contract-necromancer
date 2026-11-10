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

test('functions and symbols are not data and come back unchanged', () => {
  const f = () => 1;
  const s = Symbol('s');
  assert.equal(plain(f), f);
  assert.equal(plain(s), s);
});

// ---------------------------------------------------------------------------
// 13.18 an Error or a RegExp comes back as a fresh built-in copy
// ---------------------------------------------------------------------------

test('R13.18 an Error comes back as a new built-in error with the same message and name, never the object given', () => {
  const e = new RangeError('out of range');
  const copy = plain(e);
  assert.notEqual(copy, e);
  assert.ok(copy instanceof RangeError);
  assert.equal(Object.getPrototypeOf(copy), RangeError.prototype);
  assert.equal(copy.message, 'out of range');
  assert.equal(copy.name, 'RangeError');
  assert.equal(String(copy), 'RangeError: out of range');

  for (const Kind of [Error, TypeError, SyntaxError, ReferenceError, EvalError, URIError]) {
    const c = plain(new Kind('m'));
    assert.equal(Object.getPrototypeOf(c), Kind.prototype, Kind.name);
    assert.equal(c.message, 'm');
  }
});

test('R13.18 the copy of an Error does not carry the methods or properties the error was given', () => {
  const e = new Error('disk full');
  e.toString = trap;
  e.stack = 'doctored';
  e.extra = trap;
  const copy = plain(e);
  assert.equal(copy.extra, undefined);
  assert.notEqual(copy.toString, trap);
  assert.equal(String(copy), 'Error: disk full');
  assert.notEqual(copy.stack, 'doctored');
});

test('R13.18 an Error with a subclass name comes back as an Error that keeps the name', () => {
  class ContractLike extends Error {}
  ContractLike.prototype.name = 'ContractLike';
  const copy = plain(new ContractLike('broken'));
  assert.equal(Object.getPrototypeOf(copy), Error.prototype);
  assert.equal(copy.name, 'ContractLike');
  assert.equal(copy.message, 'broken');
  assert.equal(String(copy), 'ContractLike: broken');
});

test('R13.18 the message and the name of an Error are read once, so a getter cannot show a second value later', () => {
  let reads = 0;
  const e = new Error('first');
  Object.defineProperty(e, 'message', { get() { return reads++ === 0 ? 'first' : 'later'; } });
  let nameReads = 0;
  Object.defineProperty(e, 'name', { get() { return nameReads++ === 0 ? 'Error' : 'Other'; } });
  const copy = plain(e);
  assert.equal(copy.message, 'first');
  assert.equal(copy.message, 'first');
  assert.equal(copy.name, 'Error');
  assert.equal(copy.name, 'Error');
  assert.equal(reads, 1);
  assert.equal(nameReads, 1);
  assert.equal(typeof Object.getOwnPropertyDescriptor(copy, 'message').value, 'string');
});

test('R13.18 a message that is a String object comes back as a primitive string', () => {
  const e = new Error('x');
  e.message = new LyingString('boxed');
  const copy = plain(e);
  assert.equal(typeof copy.message, 'string');
  assert.equal(copy.message, 'boxed');
});

test('R13.18 an Error inside an array or an object is copied too, and a self-referencing structure does not loop', () => {
  const e = new TypeError('inner');
  const out = plain({ list: [e], error: e });
  assert.notEqual(out.error, e);
  assert.notEqual(out.list[0], e);
  assert.equal(out.error, out.list[0], 'the same error is copied once');
  assert.equal(out.error.message, 'inner');
});

test('R13.18 an object that only looks like an Error (prototype set by hand, no error inside) still comes back as plain data', () => {
  const fake = Object.create(null);
  fake.message = 'm';
  fake.code = 7;
  const copy = plain(fake);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.deepEqual(copy, { message: 'm', code: 7 });
});

test('R13.18 a RegExp comes back as a new built-in RegExp with the same source and flags, never the object given', () => {
  const r = /a+b/gi;
  const copy = plain(r);
  assert.notEqual(copy, r);
  assert.equal(Object.getPrototypeOf(copy), RegExp.prototype);
  assert.equal(copy.source, 'a+b');
  assert.equal(copy.flags, 'gi');
  assert.equal(copy.test('AAB'), true);
  const every = plain(new RegExp('x', 'dgimsuy'));
  assert.equal(every.flags, 'dgimsuy');
  assert.equal(plain(new RegExp('y', 'v')).flags, 'v');
});

test('R13.18 a RegExp whose methods and properties lie comes back with the real ones', () => {
  class LyingRegExp extends RegExp {
    test() { return true; }
    exec() { return ['x']; }
    get source() { return 'evil'; }
    get flags() { return 'm'; }
    get global() { return false; }
  }
  const lying = new LyingRegExp('^safe$', 'i');
  Object.defineProperty(lying, 'ignoreCase', { value: false });
  const copy = plain(lying);
  assert.equal(Object.getPrototypeOf(copy), RegExp.prototype);
  assert.equal(copy.source, '^safe$');
  assert.equal(copy.flags, 'i');
  assert.equal(copy.test('SAFE'), true);
  assert.equal(copy.test('danger'), false);
  assert.notEqual(copy.test, lying.test);

  const own = /^ok$/;
  own.test = () => true;
  Object.defineProperty(own, 'source', { value: '.*' });
  const copied = plain(own);
  assert.equal(copied.source, '^ok$');
  assert.equal(copied.test('nope'), false);
});

test('R13.18 the prototype objects of Error and RegExp do not crash plain()', () => {
  assert.doesNotThrow(() => plain(Error.prototype));
  assert.doesNotThrow(() => plain(RegExp.prototype));
});

test('src/plain.js imports nothing', () => {
  const code = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'plain.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bimport\b/);
  assert.doesNotMatch(code, /\bprocess\b/);
});
