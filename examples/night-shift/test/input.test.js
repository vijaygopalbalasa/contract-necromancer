// Task 2: input validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStart } from '../src/input.js';

function oneSentence(text) {
  return typeof text === 'string'
    && text.length > 0
    && !/[\r\n]/.test(text)
    && text.endsWith('.')
    && !text.slice(0, -1).includes('. ');
}

const good = { date: '2026-10-31', time: '20:00', zone: 'America/New_York' };

test('valid input passes through unchanged', () => {
  assert.deepEqual(parseStart(good), { ok: true, value: good });
});

test('bad dates fail naming the date', () => {
  for (const date of ['2026-02-30', '2026-13-01', '10/31/2026']) {
    const r = parseStart({ ...good, date });
    assert.equal(r.ok, false);
    assert.match(r.error, /date/i);
    assert.ok(oneSentence(r.error));
  }
});

test('bad times fail naming the time', () => {
  for (const time of ['24:00', '7:5', '12:60']) {
    const r = parseStart({ ...good, time });
    assert.equal(r.ok, false);
    assert.match(r.error, /time/i);
    assert.ok(oneSentence(r.error));
  }
});

test('bad zones fail naming the zone', () => {
  const r1 = parseStart({ ...good, zone: 'Mars/Base' });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /zone/i);
  const { zone: _z, ...noZone } = good;
  const r2 = parseStart(noZone);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /zone/i);
});

test('when date and zone are both bad only the date is reported', () => {
  const r = parseStart({ date: '2026-02-30', time: '20:00', zone: 'Mars/Base' });
  assert.match(r.error, /date/i);
  assert.doesNotMatch(r.error, /zone/i);
});

test('long values are cut to 40 characters', () => {
  const long = 'x'.repeat(100);
  const r = parseStart({ ...good, zone: long });
  assert.ok(!r.error.includes('x'.repeat(41)));
  assert.ok(oneSentence(r.error));
});
