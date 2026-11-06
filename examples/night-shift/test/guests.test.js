// Task 4: guest rows, day labels, ordering, dead-of-night marking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeadOfNight } from '../src/night.js';
import { planGuests } from '../src/guests.js';

const utc = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh, mm);
const HALLOWEEN = utc(2026, 11, 1, 0, 0); // NY 2026-10-31 20:00

function rowFor(result, zone) {
  return result.rows.find((r) => r.zone === zone);
}

test('each guest gets the right local date, time and offset', () => {
  const r = planGuests(HALLOWEEN, 'America/New_York', [
    'Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu', 'America/Caracas', 'Australia/Sydney',
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual([rowFor(r, 'Europe/London').time, rowFor(r, 'Europe/London').offset], ['00:00', '+00:00']);
  assert.deepEqual([rowFor(r, 'Asia/Kolkata').time, rowFor(r, 'Asia/Kolkata').offset], ['05:30', '+05:30']);
  assert.deepEqual([rowFor(r, 'Asia/Kathmandu').time, rowFor(r, 'Asia/Kathmandu').offset], ['05:45', '+05:45']);
  assert.equal(rowFor(r, 'America/Caracas').date, '2026-10-31');
  assert.equal(rowFor(r, 'Australia/Sydney').time, '11:00');
});

test('day labels: empty, day before, day after', () => {
  const r = planGuests(HALLOWEEN, 'America/New_York', ['Europe/London', 'America/Caracas']);
  assert.equal(rowFor(r, 'Europe/London').dayLabel, 'the day after');
  assert.equal(rowFor(r, 'America/Caracas').dayLabel, '');
  const back = planGuests(HALLOWEEN, 'Asia/Kolkata', ['America/New_York']);
  assert.equal(rowFor(back, 'America/New_York').dayLabel, 'the day before');
});

test('two days before for a Kiritimati host with an Etc/GMT+12 guest', () => {
  const start = utc(2026, 10, 30, 11, 0);
  const r = planGuests(start, 'Pacific/Kiritimati', ['Etc/GMT+12']);
  assert.equal(rowFor(r, 'Etc/GMT+12').dayLabel, '2 days before');
  assert.equal(rowFor(r, 'Etc/GMT+12').dayOffset, -2);
});

test('rows sort by local date and time, ties by zone name', () => {
  const r = planGuests(HALLOWEEN, 'America/New_York', [
    'Australia/Sydney', 'Asia/Kathmandu', 'Europe/London', 'Asia/Kolkata', 'America/Caracas',
  ]);
  assert.deepEqual(r.rows.map((x) => x.zone), [
    'America/Caracas', 'Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu', 'Australia/Sydney',
  ]);
});

test('isDeadOfNight boundaries', () => {
  assert.equal(isDeadOfNight({ hour: 0 }), true);
  assert.equal(isDeadOfNight({ hour: 5 }), true);
  assert.equal(isDeadOfNight({ hour: 6 }), false);
  assert.equal(isDeadOfNight({ hour: 23 }), false);
});

test('a bad guest zone gives one sentence naming it', () => {
  const r = planGuests(HALLOWEEN, 'America/New_York', ['Europe/London', 'Mars/Base']);
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('Mars/Base'));
  assert.ok(r.error.endsWith('.') && !/[\r\n]/.test(r.error));
});
