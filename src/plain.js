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
//   - functions, symbols, errors and regular expressions are not data and come back unchanged.
//
// It reads the built-in operations it needs once, when this file loads, and imports nothing.

const apply = Reflect.apply;
const isArray = Array.isArray;
const keysOf = Object.keys;
const describe = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty;
const PlainMap = Map;
const PlainSet = Set;
const PlainDate = Date;
const PlainWeakMap = WeakMap;

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
const isError = (v) => v instanceof Error;
const isRegExp = (v) => v instanceof RegExp;

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

function copy(v, seen) {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
  if (typeof v === 'function') return v;
  const known = apply(weakGet, seen, [v]);
  if (known !== undefined) return known;

  const box = unboxed(v);
  if (box.boxed) return box.value;
  if (isError(v) || isRegExp(v)) return v;

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
