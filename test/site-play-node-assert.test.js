import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as standIn from '../site/lib/play-node-assert.js';

const mine = standIn.default;
const real = assert; // Node's own strict assert, the reference

// Run a check against both implementations: does it throw, and with what code and message.
function outcome(fn) {
  try {
    fn();
    return { threw: false };
  } catch (err) {
    return { threw: true, code: err.code, name: err.name, message: err.message };
  }
}

const same = (name, call) => {
  const a = outcome(() => call(mine));
  const b = outcome(() => call(real));
  assert.equal(a.threw, b.threw, `${name}: the stand-in and Node must agree on whether it throws`);
  if (b.threw) {
    assert.equal(a.code, b.code, `${name}: error code`);
    assert.equal(a.name, b.name, `${name}: error name`);
  }
};

class Point {
  constructor(x) {
    this.x = x;
  }
}
const circular = () => {
  const o = { a: 1 };
  o.self = o;
  return o;
};
const sparse = () => {
  const a = [1, , 3]; // eslint-disable-line no-sparse-arrays
  return a;
};

const PAIRS = [
  [1, 1],
  [1, 2],
  ['1', 1],
  [NaN, NaN],
  [0, -0],
  [-0, -0],
  [null, undefined],
  [null, null],
  ['a', 'a'],
  [true, 1],
  [10n, 10n],
  [{}, {}],
  [[], []],
  [[1, 2], [1, 2]],
  [[1, 2], [2, 1]],
  [[1, 2], { 0: 1, 1: 2, length: 2 }],
  [{ a: 1, b: { c: [1, { d: 2 }] } }, { b: { c: [1, { d: 2 }] }, a: 1 }],
  [{ a: 1 }, { a: 1, b: undefined }],
  [{ a: undefined }, { b: undefined }],
  [new Point(1), new Point(1)],
  [new Point(1), { x: 1 }],
  [Object.create(null), {}],
  [new Map([[1, { a: 1 }]]), new Map([[1, { a: 1 }]])],
  [new Map([[1, 2]]), new Map([[1, 3]])],
  [new Set([1, 2, 3]), new Set([3, 2, 1])],
  [new Set([{ a: 1 }]), new Set([{ a: 1 }])],
  [new Set([1]), new Set([2])],
  [new Date(5), new Date(5)],
  [new Date(5), new Date(6)],
  [/a/g, /a/g],
  [/a/g, /a/i],
  [new Error('x'), new Error('x')],
  [new Error('x'), new Error('y')],
  [new Uint8Array([1, 2]), new Uint8Array([1, 2])],
  [new Uint8Array([1, 2]), new Uint8Array([1, 3])],
  [new Uint8Array([1]), new Int8Array([1])],
  [circular(), circular()],
  [sparse(), sparse()],
  [sparse(), [1, undefined, 3]],
  [() => 1, () => 1],
  [Symbol.for('s'), Symbol.for('s')],
  [{ [Symbol.for('k')]: 1 }, { [Symbol.for('k')]: 1 }],
  [{ [Symbol.for('k')]: 1 }, { [Symbol.for('k')]: 2 }],
  [[{ name: 'Zed', paid: 1000, share: 333, balance: 667 }], [{ name: 'Zed', paid: 1000, share: 333, balance: 667 }]],
];

test('equal agrees with Node strict equal on a matrix of values', () => {
  PAIRS.forEach(([a, b], i) => same(`equal pair ${i}`, (m) => m.equal(a, b)));
});

test('deepEqual agrees with Node strict deepEqual on a matrix of values', () => {
  PAIRS.forEach(([a, b], i) => same(`deepEqual pair ${i}`, (m) => m.deepEqual(a, b)));
});

test('strictEqual and deepStrictEqual are the same functions as equal and deepEqual', () => {
  assert.equal(mine.strictEqual, mine.equal);
  assert.equal(mine.deepStrictEqual, mine.deepEqual);
  assert.equal(standIn.equal, mine.equal);
  assert.equal(standIn.deepEqual, mine.deepEqual);
  assert.equal(standIn.ok, mine.ok);
  assert.equal(standIn.throws, mine.throws);
});

test('ok agrees with Node on truthy and falsy values and on no argument', () => {
  for (const v of [true, 1, 'a', {}, [], 0, '', null, undefined, NaN, false, 0n]) same(`ok(${String(v)})`, (m) => m.ok(v));
  same('ok()', (m) => m.ok());
  // The default export is callable like assert(value).
  assert.throws(() => mine(0), (e) => e.code === 'ERR_ASSERTION');
  mine(1);
});

test('a custom message is the error message, for every assertion', () => {
  assert.throws(() => mine.ok(false, 'balances must sum to zero'), { code: 'ERR_ASSERTION', message: 'balances must sum to zero' });
  assert.throws(() => mine.equal(1, 2, 'shares must sum'), { code: 'ERR_ASSERTION', message: 'shares must sum' });
  assert.throws(() => mine.deepEqual([1], [2], 'rows differ'), { code: 'ERR_ASSERTION', message: 'rows differ' });
  assert.throws(() => mine.throws(() => {}, undefined, 'must throw'), (e) => e.code === 'ERR_ASSERTION' && /must throw/.test(e.message));
  // Real Node does the same, which is the point.
  assert.throws(() => real.ok(false, 'balances must sum to zero'), { message: 'balances must sum to zero' });
});

test('an Error passed as the message is thrown as it is', () => {
  const mark = new RangeError('mine');
  assert.throws(() => mine.ok(false, mark), (e) => e === mark);
  assert.throws(() => mine.equal(1, 2, mark), (e) => e === mark);
});

test('failed assertions carry actual, expected, operator and the values in the generated message', () => {
  let err;
  try {
    mine.equal(1, 2);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'equal(1, 2) throws');
  assert.equal(err.name, 'AssertionError');
  assert.equal(err.code, 'ERR_ASSERTION');
  assert.equal(err.actual, 1);
  assert.equal(err.expected, 2);
  assert.equal(err.operator, 'strictEqual');
  assert.equal(err.generatedMessage, true);
  assert.match(err.message, /strictly equal/);
  assert.match(err.message, /1/);
  assert.match(err.message, /2/);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof standIn.AssertionError);

  try {
    mine.deepEqual({ a: 1 }, { a: 2 });
  } catch (e) {
    err = e;
  }
  assert.equal(err.operator, 'deepStrictEqual');
  assert.match(err.message, /deep-equal/);
  assert.match(err.message, /a: 1/);
  assert.match(err.message, /a: 2/);

  let custom;
  try {
    mine.equal(1, 2, 'mine');
  } catch (e) {
    custom = e;
  }
  assert.equal(custom.generatedMessage, false);
});

test('the generated message of a huge value stays short', () => {
  let err;
  try {
    mine.deepEqual(Array.from({ length: 5000 }, (_, i) => i), []);
  } catch (e) {
    err = e;
  }
  assert.ok(err.message.length < 4000, `message is ${err.message.length} characters`);
});

test('throws: passes when the function throws, fails when it does not', () => {
  same('throws throwing', (m) => m.throws(() => { throw new Error('x'); }));
  same('throws not throwing', (m) => m.throws(() => {}));
  const a = outcome(() => mine.throws(() => {}));
  assert.match(a.message, /Missing expected exception/);
});

test('throws: a string second argument is the message, and the failure says so', () => {
  const failing = outcome(() => mine.throws(() => {}, 'the printed party must still fail'));
  const nodeFailing = outcome(() => real.throws(() => {}, 'the printed party must still fail'));
  assert.equal(failing.message, nodeFailing.message);
  same('throws string message ok', (m) => m.throws(() => { throw new Error('x'); }, 'the printed party must still fail'));
});

test('throws: a string equal to the thrown message is ambiguous, as in Node', () => {
  same('ambiguous', (m) => m.throws(() => { throw new Error('same'); }, 'same'));
  const a = outcome(() => mine.throws(() => { throw new Error('same'); }, 'same'));
  assert.equal(a.code, 'ERR_AMBIGUOUS_ARGUMENT');
});

test('throws: RegExp, class, validation function and object expectations agree with Node', () => {
  const boom = () => { throw new TypeError('boom 1'); };
  same('regexp ok', (m) => m.throws(boom, /boom/));
  same('regexp bad', (m) => m.throws(boom, /nope/));
  same('class ok', (m) => m.throws(boom, TypeError));
  same('class base ok', (m) => m.throws(boom, Error));
  same('class bad', (m) => m.throws(boom, RangeError));
  same('fn ok', (m) => m.throws(boom, (e) => e instanceof TypeError));
  same('fn false', (m) => m.throws(boom, () => false));
  same('object ok', (m) => m.throws(boom, { name: 'TypeError', message: 'boom 1' }));
  same('object regexp ok', (m) => m.throws(boom, { message: /boom/ }));
  same('object bad', (m) => m.throws(boom, { message: 'other' }));
  same('error instance ok', (m) => m.throws(boom, new TypeError('boom 1')));
  same('error instance bad', (m) => m.throws(boom, new TypeError('different')));
});

test('throws: a function argument that is not a function is a TypeError', () => {
  assert.throws(() => mine.throws(1), TypeError);
});

test('fail always throws an AssertionError', () => {
  assert.throws(() => mine.fail('no'), { code: 'ERR_ASSERTION', message: 'no' });
  assert.throws(() => mine.fail(), { code: 'ERR_ASSERTION' });
});

test('the stand-in has no import and no mention of the Node module names, and a method it does not have is simply missing', () => {
  const text = fs.readFileSync(new URL('../site/lib/play-node-assert.js', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /^\s*import\b/m);
  assert.doesNotMatch(text, /node:/);
  assert.equal(mine.rejects, undefined);
});
