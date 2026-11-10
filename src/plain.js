// plain(value): the data in a result, without the objects that carry it (Req 13.16).
//
//   import { plain } from 'contract-necromancer/src/plain.js';
//   const lines = plain(renderText(balances, payments)).split('\n');
//
// Code under test can return a subclass of String or Array whose methods lie: a `split` that hides a line, a `map` or `some`
// that skips one, an `includes` that always says yes. A contract that calls those methods asks the cheat to grade itself.
// `plain` reads the data through the built-in operations only, and returns it as new values that have the built-in methods:
//
//   - strings, numbers, booleans, bigints, null and undefined come back as the primitive, also when given as a String,
//     Number, Boolean or BigInt object (read from the object's internal value, never through its own methods);
//   - an array comes back as a new plain array, a Map as a new plain Map, a Set as a new plain Set and a Date as a new Date,
//     each holding the plain version of what it held;
//   - any other object comes back as a new plain object holding the plain version of its own enumerable properties, so a
//     class instance comes back as the data it holds;
//   - functions and symbols are not data and come back unchanged;
//   - an Error comes back as a new built-in error of the same kind (Error, TypeError, RangeError and the like), holding the
//     message and the name the error had, read once; nothing else of it is kept, so a doctored `toString` or a getter that
//     answers differently the second time does not come along (Req 13.18);
//   - a regular expression comes back as a new built-in RegExp, built from the source and the flags that the built-in getters
//     report for it, so a `test`, `exec`, `source` or `flags` that lies is not carried over (Req 13.18).
//
// It reads the built-in operations it needs once, when this file loads, and imports nothing.

const apply = Reflect.apply;
const isArray = Array.isArray;
const keysOf = Object.keys;
const describe = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty;
const prototypeOf = Object.getPrototypeOf;
const PlainMap = Map;
const PlainSet = Set;
const PlainDate = Date;
const PlainWeakMap = WeakMap;
const PlainRegExp = RegExp;
const PlainError = Error;
// Error.isError is the engine's own check for an error object. Older engines do not have it.
const nativeIsError = typeof Error.isError === 'function' ? Error.isError : undefined;
const ordinaryHasInstance = Function.prototype[Symbol.hasInstance];
// The error kinds that come back as themselves. Any other name comes back as an Error that keeps the name.
const ERROR_KINDS = { Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError };

const stringValue = String.prototype.valueOf;
const numberValue = Number.prototype.valueOf;
const booleanValue = Boolean.prototype.valueOf;
const bigintValue = BigInt.prototype.valueOf;
const timeOf = Date.prototype.getTime;
const mapSize = describe(Map.prototype, 'size').get;
const setSize = describe(Set.prototype, 'size').get;
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const mapSet = Map.prototype.set;
const setAdd = Set.prototype.add;
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;
const hasOwn = Object.hasOwn;
const regexpSource = describe(RegExp.prototype, 'source').get;
// The built-in getters of the flags, in the order the engine writes them. Each reads the flags the regular expression was made
// with, from inside the object, so an own or inherited property of the same name does not change the answer.
const FLAG_GETTERS = [
  [describe(RegExp.prototype, 'hasIndices').get, 'd'],
  [describe(RegExp.prototype, 'global').get, 'g'],
  [describe(RegExp.prototype, 'ignoreCase').get, 'i'],
  [describe(RegExp.prototype, 'multiline').get, 'm'],
  [describe(RegExp.prototype, 'dotAll').get, 's'],
  [describe(RegExp.prototype, 'unicode').get, 'u'],
  [describe(RegExp.prototype, 'unicodeSets').get, 'v'],
  [describe(RegExp.prototype, 'sticky').get, 'y'],
];

// The value held by a boxed primitive, or { boxed: false } for any other object. The built-in valueOf of each kind throws
// for an object that is not that kind, so the answer comes from the object's internal slot and not from its methods.
function unboxed(v) {
  for (const read of [stringValue, numberValue, booleanValue, bigintValue]) {
    try {
      return { boxed: true, value: apply(read, v, []) };
    } catch {
      // not this kind
    }
  }
  return { boxed: false };
}

function brand(read, v) {
  try {
    apply(read, v, []);
    return true;
  } catch {
    return false;
  }
}

export function plain(value) {
  return copy(value, new PlainWeakMap());
}

// The flags of a regular expression as a string, or null when the value is not one. The source getter throws for anything
// that is not a regular expression, and the flag getters give a boolean only for one (they give undefined for RegExp.prototype).
function regexpFlags(v) {
  try {
    apply(regexpSource, v, []);
  } catch {
    return null;
  }
  let flags = '';
  for (let i = 0; i < FLAG_GETTERS.length; i++) {
    const on = apply(FLAG_GETTERS[i][0], v, []);
    if (typeof on !== 'boolean') return null;
    if (on) flags += FLAG_GETTERS[i][1];
  }
  return flags;
}

function copyRegExp(v, flags, seen) {
  const out = new PlainRegExp(apply(regexpSource, v, []), flags);
  apply(weakSet, seen, [v, out]);
  return out;
}

function isErrorObject(v) {
  if (nativeIsError !== undefined && nativeIsError(v) === true) return true;
  return apply(ordinaryHasInstance, PlainError, [v]) === true;
}

// The value of a property of an error, found along its prototype chain and read once. A getter is called once, with the error
// as `this`; one that throws gives undefined.
function fieldOf(v, key) {
  for (let o = v; o !== null && o !== undefined; o = prototypeOf(o)) {
    const descriptor = describe(o, key);
    if (descriptor === undefined) continue;
    if ('value' in descriptor) return descriptor.value;
    if (descriptor.get === undefined) return undefined;
    try {
      return apply(descriptor.get, v, []);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// A string from a value: the string itself, or the string a String object holds (read from its internal slot), else the fallback.
function textOf(value, fallback) {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    const box = unboxed(value);
    if (box.boxed && typeof box.value === 'string') return box.value;
  }
  return fallback;
}

// A new built-in error holding the message and name of the one given, as primitive strings.
function copyError(v, seen) {
  const text = textOf(fieldOf(v, 'message'), '');
  const label = textOf(fieldOf(v, 'name'), 'Error');
  const known = hasOwn(ERROR_KINDS, label);
  const out = new (known ? ERROR_KINDS[label] : PlainError)(text);
  if (!known) define(out, 'name', { value: label, writable: true, enumerable: false, configurable: true });
  apply(weakSet, seen, [v, out]);
  return out;
}

function copy(v, seen) {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
  if (typeof v === 'function') return v;
  const known = apply(weakGet, seen, [v]);
  if (known !== undefined) return known;

  const box = unboxed(v);
  if (box.boxed) return box.value;

  if (isArray(v)) {
    const out = [];
    apply(weakSet, seen, [v, out]);
    const length = v.length;
    for (let i = 0; i < length; i++) {
      if (i in v) out[i] = copy(v[i], seen);
    }
    out.length = length;
    return out;
  }
  const flags = regexpFlags(v);
  if (flags !== null) return copyRegExp(v, flags, seen);
  if (isErrorObject(v)) return copyError(v, seen);
  if (brand(mapSize, v)) {
    const out = new PlainMap();
    apply(weakSet, seen, [v, out]);
    apply(mapForEach, v, [(item, key) => { apply(mapSet, out, [copy(key, seen), copy(item, seen)]); }]);
    return out;
  }
  if (brand(setSize, v)) {
    const out = new PlainSet();
    apply(weakSet, seen, [v, out]);
    apply(setForEach, v, [(item) => { apply(setAdd, out, [copy(item, seen)]); }]);
    return out;
  }
  if (brand(timeOf, v)) return new PlainDate(apply(timeOf, v, []));

  const out = {};
  apply(weakSet, seen, [v, out]);
  for (const key of keysOf(v)) {
    const descriptor = describe(v, key);
    const item = descriptor && 'value' in descriptor ? descriptor.value : v[key];
    define(out, key, { value: copy(item, seen), writable: true, enumerable: true, configurable: true });
  }
  return out;
}
