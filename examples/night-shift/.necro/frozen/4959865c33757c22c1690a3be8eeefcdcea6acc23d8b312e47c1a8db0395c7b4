// Frozen contract: planner, Requirement 2 (every guest's local time).
// One test per acceptance criterion. Expected values come from real zones and dates, not from the code under test.
// Expected to fail until src/ exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const utc = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh, mm);

// Halloween 2026, 20:00 in New York (EDT, -04:00) is 2026-11-01T00:00Z.
const HALLOWEEN_START = utc(2026, 11, 1, 0, 0);

function rowFor(result, zone) {
  assert.equal(result.ok, true, 'planGuests should succeed');
  const matches = result.rows.filter((r) => r.zone === zone);
  assert.equal(matches.length, 1, `expected exactly one row for ${zone}`);
  return matches[0];
}

test('R2.1 gives each guest the local date, local HH:MM and UTC offset at the start instant', async () => {
  // from '../../src/guests.js'
  const { planGuests } = await import('../../src/guests.js');

  const zones = [
    'Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu', 'America/Caracas', 'Australia/Sydney', 'Asia/Tokyo',
    'America/New_York',
  ];
  const halloween = planGuests(HALLOWEEN_START, 'America/New_York', zones);
  const expectedHalloween = {
    'Europe/London': ['2026-11-01', '00:00', '+00:00'], // local midnight reads 00:00, never 24:00
    'Asia/Kolkata': ['2026-11-01', '05:30', '+05:30'],
    'Asia/Kathmandu': ['2026-11-01', '05:45', '+05:45'],
    'America/Caracas': ['2026-10-31', '20:00', '-04:00'],
    'Australia/Sydney': ['2026-11-01', '11:00', '+11:00'],
    'Asia/Tokyo': ['2026-11-01', '09:00', '+09:00'],
    'America/New_York': ['2026-10-31', '20:00', '-04:00'],
  };
  assert.equal(halloween.rows.length, zones.length, 'one row per guest zone');
  for (const [zone, [date, time, offset]] of Object.entries(expectedHalloween)) {
    const row = rowFor(halloween, zone);
    assert.equal(row.date, date, `${zone} date`);
    assert.equal(row.time, time, `${zone} time`);
    assert.equal(row.offset, offset, `${zone} offset`);
  }

  // The offset is the one in force at the start instant, so it changes with daylight saving.
  const july = planGuests(utc(2026, 7, 1, 0, 0), 'UTC', ['America/New_York', 'Europe/London', 'Australia/Sydney', 'Australia/Lord_Howe']);
  const expectedJuly = {
    'America/New_York': ['2026-06-30', '20:00', '-04:00'],
    'Europe/London': ['2026-07-01', '01:00', '+01:00'],
    'Australia/Sydney': ['2026-07-01', '10:00', '+10:00'],
    'Australia/Lord_Howe': ['2026-07-01', '10:30', '+10:30'],
  };
  const january = planGuests(utc(2026, 1, 15, 0, 0), 'UTC', ['America/New_York', 'Europe/London', 'Australia/Sydney', 'Australia/Lord_Howe']);
  const expectedJanuary = {
    'America/New_York': ['2026-01-14', '19:00', '-05:00'],
    'Europe/London': ['2026-01-15', '00:00', '+00:00'],
    'Australia/Sydney': ['2026-01-15', '11:00', '+11:00'],
    'Australia/Lord_Howe': ['2026-01-15', '11:00', '+11:00'],
  };
  for (const [label, result, expected] of [['july', july, expectedJuly], ['january', january, expectedJanuary]]) {
    for (const [zone, [date, time, offset]] of Object.entries(expected)) {
      const row = rowFor(result, zone);
      assert.deepEqual([row.date, row.time, row.offset], [date, time, offset], `${label} ${zone}`);
    }
  }

  // Zone names are kept as given. Intl reports Asia/Kathmandu as Asia/Katmandu; the row must not.
  assert.equal(rowFor(halloween, 'Asia/Kathmandu').zone, 'Asia/Kathmandu');

  // Design decision 2 (unconfirmed): a bad guest zone refuses the whole plan with one sentence naming it.
  const bad = planGuests(HALLOWEEN_START, 'America/New_York', ['Europe/London', 'Mars/Base']);
  assert.equal(bad.ok, false);
  assert.ok(bad.error.includes('Mars/Base'), `error should name the bad zone, got: ${bad.error}`);
  assert.ok(bad.error.endsWith('.') && !/[\r\n]/.test(bad.error) && !bad.error.slice(0, -1).includes('. '), 'one sentence');
});

test('R2.2 says whether a guest is on the day before or the day after the host', async () => {
  // from '../../src/guests.js'
  const { planGuests } = await import('../../src/guests.js');

  // Host in New York, Halloween 20:00 (2026-10-31 local).
  const fromNewYork = planGuests(HALLOWEEN_START, 'America/New_York', [
    'Europe/London', 'America/Caracas', 'Asia/Kolkata', 'Australia/Sydney', 'America/Los_Angeles',
  ]);
  assert.equal(rowFor(fromNewYork, 'Europe/London').dayLabel, 'the day after'); // London reads 2026-11-01 00:00
  assert.equal(rowFor(fromNewYork, 'Asia/Kolkata').dayLabel, 'the day after');
  assert.equal(rowFor(fromNewYork, 'Australia/Sydney').dayLabel, 'the day after');
  assert.equal(rowFor(fromNewYork, 'America/Caracas').dayLabel, ''); // same date as the host
  assert.equal(rowFor(fromNewYork, 'America/Los_Angeles').dayLabel, ''); // 17:00 on 2026-10-31
  assert.equal(rowFor(fromNewYork, 'Asia/Kolkata').dayOffset, 1);
  assert.equal(rowFor(fromNewYork, 'America/Caracas').dayOffset, 0);

  // Host in Kolkata at the same instant (2026-11-01 05:30 local): New York and Los Angeles are on the day before.
  // London reads 2026-11-01 00:00, the same date as the host.
  const fromKolkata = planGuests(HALLOWEEN_START, 'Asia/Kolkata', ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Kathmandu']);
  assert.equal(rowFor(fromKolkata, 'America/New_York').dayLabel, 'the day before');
  assert.equal(rowFor(fromKolkata, 'America/Los_Angeles').dayLabel, 'the day before');
  assert.equal(rowFor(fromKolkata, 'Europe/London').dayLabel, '');
  assert.equal(rowFor(fromKolkata, 'Asia/Kathmandu').dayLabel, ''); // 05:45 on the same date
  assert.equal(rowFor(fromKolkata, 'America/New_York').dayOffset, -1);

  // Design decision 6 (unconfirmed): two days apart is possible, and the label must not say "the day before".
  // Kiritimati (+14:00) 2026-10-31 01:00 is 2026-10-29 23:00 in Etc/GMT+12 (-12:00).
  const kiritimatiStart = utc(2026, 10, 30, 11, 0);
  const farBehind = planGuests(kiritimatiStart, 'Pacific/Kiritimati', ['Etc/GMT+12']);
  assert.equal(rowFor(farBehind, 'Etc/GMT+12').date, '2026-10-29');
  assert.equal(rowFor(farBehind, 'Etc/GMT+12').dayLabel, '2 days before');
  assert.equal(rowFor(farBehind, 'Etc/GMT+12').dayOffset, -2);
  const farAhead = planGuests(kiritimatiStart, 'Etc/GMT+12', ['Pacific/Kiritimati']);
  assert.equal(rowFor(farAhead, 'Pacific/Kiritimati').dayLabel, '2 days after');
  assert.equal(rowFor(farAhead, 'Pacific/Kiritimati').dayOffset, 2);
});

test('R2.3 orders guests by local time at the start instant, earliest first, ties by zone name', async () => {
  // from '../../src/guests.js'
  const { planGuests } = await import('../../src/guests.js');

  // Halloween start, given in a scrambled order. Local times: Caracas 10-31 20:00, London 11-01 00:00,
  // Kolkata 11-01 05:30, Kathmandu 11-01 05:45, Sydney 11-01 11:00.
  const scrambled = ['Australia/Sydney', 'Asia/Kathmandu', 'Europe/London', 'Asia/Kolkata', 'America/Caracas'];
  const result = planGuests(HALLOWEEN_START, 'America/New_York', scrambled);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((r) => r.zone), [
    'America/Caracas', 'Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu', 'Australia/Sydney',
  ]);

  // Ties by zone name, whatever order they were given in. Caracas and New York both read 2026-10-31 20:00.
  for (const guests of [['America/New_York', 'America/Caracas'], ['America/Caracas', 'America/New_York']]) {
    const tied = planGuests(HALLOWEEN_START, 'UTC', guests);
    assert.deepEqual(tied.rows.map((r) => r.zone), ['America/Caracas', 'America/New_York']);
  }
  // Four zones that all read 2026-11-01 00:00 sort by plain string comparison of the zone name.
  const tiedUtc = planGuests(HALLOWEEN_START, 'UTC', ['UTC', 'Etc/UTC', 'Europe/London', 'Atlantic/Reykjavik']);
  assert.deepEqual(tiedUtc.rows.map((r) => r.zone), ['Atlantic/Reykjavik', 'Etc/UTC', 'Europe/London', 'UTC']);

  // Design decision 4 (unconfirmed): order by local date and time together, not by time of day alone.
  // At 2026-06-15T11:30Z: Etc/GMT+12 reads 2026-06-14 23:30, UTC reads 2026-06-15 11:30,
  // Pacific/Tongatapu reads 2026-06-16 00:30. Time of day alone would put Tongatapu first.
  const crossDay = planGuests(utc(2026, 6, 15, 11, 30), 'UTC', ['Pacific/Tongatapu', 'UTC', 'Etc/GMT+12']);
  assert.deepEqual(crossDay.rows.map((r) => r.zone), ['Etc/GMT+12', 'UTC', 'Pacific/Tongatapu']);
  assert.deepEqual(crossDay.rows.map((r) => `${r.date} ${r.time}`), ['2026-06-14 23:30', '2026-06-15 11:30', '2026-06-16 00:30']);
});
