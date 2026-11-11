import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Each test gets a fresh copy of the stand-in, so one test's registry never leaks into another.
let n = 0;
const fresh = () => import(`../site/lib/play-node-test.js?copy=${n++}`);

nodeTest('test registers by name and the default export is the same function', async () => {
  const m = await fresh();
  assert.equal(typeof m.test, 'function');
  assert.equal(m.default, m.test);
  assert.equal(typeof m.runRegistered, 'function');
});

nodeTest('registering runs nothing; runRegistered runs the tests one after another in order', async () => {
  const m = await fresh();
  const log = [];
  m.test('a', async () => {
    log.push('a start');
    await new Promise((r) => setTimeout(r, 10));
    log.push('a end');
  });
  m.test('b', () => {
    log.push('b');
  });
  assert.deepEqual(log, [], 'nothing ran at registration');
  const results = await m.runRegistered();
  assert.deepEqual(log, ['a start', 'a end', 'b'], 'strictly in order, one at a time');
  assert.deepEqual(results, [
    { name: 'a', result: 'pass', message: '' },
    { name: 'b', result: 'pass', message: '' },
  ]);
});

nodeTest('a thrown assertion or any error is a fail with its message; the next test still runs', async () => {
  const m = await fresh();
  m.test('bad', () => {
    throw new Error('balances must sum to zero');
  });
  m.test('rejects', async () => {
    throw new RangeError('later');
  });
  m.test('non error', () => {
    throw 'just a string'; // eslint-disable-line no-throw-literal
  });
  m.test('good', () => {});
  const results = await m.runRegistered();
  assert.deepEqual(results, [
    { name: 'bad', result: 'fail', message: 'balances must sum to zero' },
    { name: 'rejects', result: 'fail', message: 'later' },
    { name: 'non error', result: 'fail', message: 'just a string' },
    { name: 'good', result: 'pass', message: '' },
  ]);
});

nodeTest('the name can come first with options in the middle, or from the function', async () => {
  const m = await fresh();
  m.test('with options', { timeout: 5 }, () => {});
  m.test(function named() {});
  m.test('no body');
  const results = await m.runRegistered();
  assert.deepEqual(results.map((r) => [r.name, r.result]), [
    ['with options', 'pass'],
    ['named', 'pass'],
    ['no body', 'pass'],
  ]);
});

nodeTest('the test function gets a context with the name', async () => {
  const m = await fresh();
  let seen;
  m.test('ctx', (t) => {
    seen = t.name;
    t.diagnostic('ignored');
  });
  await m.runRegistered();
  assert.equal(seen, 'ctx');
});

nodeTest('onResult is called for each test as it finishes, and the registry is empty after a run', async () => {
  const m = await fresh();
  const heard = [];
  m.test('one', () => {});
  m.test('two', () => {
    throw new Error('x');
  });
  await m.runRegistered((r) => heard.push(`${r.name}:${r.result}`));
  assert.deepEqual(heard, ['one:pass', 'two:fail']);
  assert.deepEqual(await m.runRegistered(), [], 'a second run has nothing left to run');
});

nodeTest('an exception thrown by onResult does not stop the run', async () => {
  const m = await fresh();
  m.test('one', () => {});
  m.test('two', () => {});
  const results = await m.runRegistered(() => {
    throw new Error('listener');
  });
  assert.equal(results.length, 2);
});

nodeTest('the stand-in has no import and no mention of the Node module names', () => {
  const text = fs.readFileSync(new URL('../site/lib/play-node-test.js', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /^\s*import\b/m);
  assert.doesNotMatch(text, /node:/);
});
