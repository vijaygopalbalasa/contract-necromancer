// Task 3: local time to UTC instant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocal } from '../src/resolve.js';

const utc = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh, mm);

test('ordinary times return the exact UTC ms', () => {
  const cases = [
    ['America/New_York', '2026-10-31', '20:00', utc(2026, 11, 1, 0, 0)],
    ['Europe/London', '2026-10-31', '20:00', utc(2026, 10, 31, 20, 0)],
    ['Australia/Sydney', '2026-10-31', '20:00', utc(2026, 10, 31, 9, 0)],
    ['Asia/Kolkata', '2026-10-31', '20:00', utc(2026, 10, 31, 14, 30)],
    ['UTC', '2026-10-31', '20:00', utc(2026, 10, 31, 20, 0)],
  ];
  for (const [zone, date, time, expected] of cases) {
    const r = resolveLocal({ date, time, zone });
    assert.equal(r.ok, true, `${zone} ${time}`);
    assert.equal(r.ms, expected, `${zone} ${time}`);
  }
});

test('a gap is refused with a sentence naming the skipped range', () => {
  const ny = resolveLocal({ date: '2026-03-08', time: '02:30', zone: 'America/New_York' });
  assert.equal(ny.ok, false);
  assert.equal(ny.reason, 'gap');
  assert.equal(ny.ms, undefined);
  assert.ok(ny.error.includes('02:00 to 03:00'));
  assert.ok(ny.error.includes('America/New_York'));

  const london = resolveLocal({ date: '2026-03-29', time: '01:30', zone: 'Europe/London' });
  assert.equal(london.reason, 'gap');
  assert.ok(london.error.includes('01:00 to 02:00'));

  const lh = resolveLocal({ date: '2026-10-04', time: '02:15', zone: 'Australia/Lord_Howe' });
  assert.equal(lh.reason, 'gap');
  assert.ok(lh.error.includes('02:00 to 02:30'), lh.error);
});

test('an ambiguous time offers earlier and later one hour apart', () => {
  const open = resolveLocal({ date: '2026-11-01', time: '01:30', zone: 'America/New_York' });
  assert.equal(open.ok, false);
  assert.equal(open.reason, 'ambiguous');
  assert.ok(!('choice' in open));
  assert.equal(open.options.earlier, utc(2026, 11, 1, 5, 30));
  assert.equal(open.options.later, utc(2026, 11, 1, 6, 30));

  const early = resolveLocal({ date: '2026-11-01', time: '01:30', zone: 'America/New_York' }, 'earlier');
  const late = resolveLocal({ date: '2026-11-01', time: '01:30', zone: 'America/New_York' }, 'later');
  assert.equal(early.ms, utc(2026, 11, 1, 5, 30));
  assert.equal(late.ms, utc(2026, 11, 1, 6, 30));
  assert.equal(late.ms - early.ms, 3600000);

  const londonOpen = resolveLocal({ date: '2026-10-25', time: '01:30', zone: 'Europe/London' });
  assert.equal(londonOpen.reason, 'ambiguous');
});

test('times just before and after each change resolve normally', () => {
  assert.equal(resolveLocal({ date: '2026-03-08', time: '01:59', zone: 'America/New_York' }).ms, utc(2026, 3, 8, 6, 59));
  assert.equal(resolveLocal({ date: '2026-03-08', time: '03:00', zone: 'America/New_York' }).ms, utc(2026, 3, 8, 7, 0));
  assert.equal(resolveLocal({ date: '2026-11-01', time: '00:59', zone: 'America/New_York' }).ms, utc(2026, 11, 1, 4, 59));
  assert.equal(resolveLocal({ date: '2026-11-01', time: '02:00', zone: 'America/New_York' }).ms, utc(2026, 11, 1, 7, 0));
});
