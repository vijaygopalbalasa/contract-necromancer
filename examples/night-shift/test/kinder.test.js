// Task 5: kinder time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestKinderTime } from '../src/kinder.js';

const utc = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh, mm);

test('returns the fewest-count hour on the host date', () => {
  const r = suggestKinderTime({ date: '2026-10-31', zone: 'America/New_York' }, ['Europe/London', 'Asia/Kolkata']);
  assert.equal(r.date, '2026-10-31');
  assert.equal(r.time, '02:00');
  assert.equal(r.count, 0);
  assert.equal(r.ms, utc(2026, 10, 31, 6, 0));
});

test('no guests returns 00:00 with count 0', () => {
  const r = suggestKinderTime({ date: '2026-10-31', zone: 'America/New_York' }, []);
  assert.deepEqual([r.date, r.time, r.count], ['2026-10-31', '00:00', 0]);
});

test('a skipped hour is never offered', () => {
  const r = suggestKinderTime({ date: '2026-03-08', zone: 'America/New_York' }, ['Etc/GMT+1']);
  assert.notEqual(r.time, '02:00');
  assert.equal(r.time, '03:00');
  assert.equal(r.count, 0);
});

test('a repeated hour can win with choice earlier', () => {
  const r = suggestKinderTime({ date: '2026-11-01', zone: 'America/New_York' }, ['Etc/GMT-1']);
  assert.equal(r.time, '01:00');
  assert.equal(r.choice, 'earlier');
  assert.equal(r.ms, utc(2026, 11, 1, 5, 0));
});

test('ties choose the earliest hour, result stays on the host date', () => {
  const r = suggestKinderTime(
    { date: '2026-06-15', zone: 'UTC' },
    ['UTC', 'UTC', 'Etc/GMT-6', 'Etc/GMT-12', 'Etc/GMT+6'],
  );
  assert.deepEqual([r.date, r.time, r.count], ['2026-06-15', '06:00', 1]);
});
