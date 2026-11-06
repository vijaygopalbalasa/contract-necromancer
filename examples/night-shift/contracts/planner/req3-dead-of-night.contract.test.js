// Frozen contract: planner, Requirement 3 (the dead of night).
// One test per acceptance criterion. Expected values come from real zones and dates, not from the code under test.
// Expected to fail until src/ exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const utc = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh, mm);

function rowFor(result, zone) {
  assert.equal(result.ok, true, 'planGuests should succeed');
  return result.rows.find((r) => r.zone === zone);
}

test('R3.1 marks a guest whose local start is from 00:00 up to but not including 06:00', async () => {
  // from '../../src/night.js'
  const { isDeadOfNight } = await import('../../src/night.js');
  // from '../../src/guests.js'
  const { planGuests } = await import('../../src/guests.js');

  // The rule on a local hour.
  for (const hour of [0, 1, 5]) assert.equal(isDeadOfNight({ hour }), true, `hour ${hour}`);
  for (const hour of [6, 7, 12, 23]) assert.equal(isDeadOfNight({ hour }), false, `hour ${hour}`);

  // The boundaries on real instants, read in the guest's own zone. UTC guest, so local time equals the instant.
  const boundaries = [
    [0, 0, true], // 00:00 is in
    [5, 59, true], // 05:59 is in
    [6, 0, false], // 06:00 is out
    [23, 59, false],
    [12, 0, false],
  ];
  for (const [hour, minute, expected] of boundaries) {
    const row = planGuests(utc(2026, 6, 15, hour, minute), 'UTC', ['UTC']).rows[0];
    assert.equal(row.deadOfNight, expected, `UTC guest at ${row.time}`);
  }
  assert.equal(planGuests(utc(2026, 6, 15, 0, 0), 'UTC', ['UTC']).rows[0].time, '00:00', 'midnight reads 00:00, not 24:00');

  // Half-hour and 45-minute zones cross the 06:00 line at the right minute.
  assert.equal(rowFor(planGuests(utc(2026, 6, 15, 0, 29), 'UTC', ['Asia/Kolkata']), 'Asia/Kolkata').deadOfNight, true); // 05:59
  assert.equal(rowFor(planGuests(utc(2026, 6, 15, 0, 30), 'UTC', ['Asia/Kolkata']), 'Asia/Kolkata').deadOfNight, false); // 06:00
  assert.equal(rowFor(planGuests(utc(2026, 6, 15, 0, 14), 'UTC', ['Asia/Kathmandu']), 'Asia/Kathmandu').deadOfNight, true); // 05:59
  assert.equal(rowFor(planGuests(utc(2026, 6, 15, 0, 15), 'UTC', ['Asia/Kathmandu']), 'Asia/Kathmandu').deadOfNight, false); // 06:00

  // Halloween 20:00 in New York is 2026-11-01T00:00Z. Only the guest's local hour matters, not the host's.
  const halloween = planGuests(utc(2026, 11, 1, 0, 0), 'America/New_York', [
    'Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu', 'America/Caracas', 'Australia/Sydney', 'America/New_York',
  ]);
  const expected = {
    'Europe/London': true, // 00:00
    'Asia/Kolkata': true, // 05:30
    'Asia/Kathmandu': true, // 05:45
    'America/Caracas': false, // 20:00
    'Australia/Sydney': false, // 11:00
    'America/New_York': false, // 20:00
  };
  for (const [zone, dead] of Object.entries(expected)) {
    assert.equal(rowFor(halloween, zone).deadOfNight, dead, zone);
  }
});

test('R3.2 returns the on-the-hour start on the host date with the fewest dead-of-night guests, earliest on ties', async () => {
  // from '../../src/kinder.js'
  const { suggestKinderTime } = await import('../../src/kinder.js');
  // from '../../src/resolve.js'
  const { resolveLocal } = await import('../../src/resolve.js');

  // Host in New York on Halloween (EDT, -04:00), guests in London (+00:00) and Kolkata (+05:30).
  // London is dead for host hours 20-23 and 00-01; Kolkata for 15-20. Host 02:00 is the first hour with nobody up.
  const example = suggestKinderTime({ date: '2026-10-31', zone: 'America/New_York' }, ['Europe/London', 'Asia/Kolkata']);
  assert.equal(example.date, '2026-10-31');
  assert.equal(example.time, '02:00');
  assert.equal(example.count, 0);
  assert.equal(example.ms, utc(2026, 10, 31, 6, 0));

  // No guests: every hour ties at zero, so the earliest hour wins.
  const alone = suggestKinderTime({ date: '2026-10-31', zone: 'America/New_York' }, []);
  assert.deepEqual([alone.date, alone.time, alone.count], ['2026-10-31', '00:00', 0]);
  assert.equal(alone.ms, utc(2026, 10, 31, 4, 0));

  // A minimum above zero, with ties. UTC host on 2026-06-15; two guests in UTC, one each in UTC+6, UTC+12, UTC-6.
  // Host hours 00-05 mark both UTC guests (count 2). Every other hour marks exactly one guest (count 1).
  // The earliest hour with count 1 is 06:00.
  const busy = suggestKinderTime(
    { date: '2026-06-15', zone: 'UTC' },
    ['UTC', 'UTC', 'Etc/GMT-6', 'Etc/GMT-12', 'Etc/GMT+6'],
  );
  assert.deepEqual([busy.date, busy.time, busy.count], ['2026-06-15', '06:00', 1]);
  assert.equal(busy.ms, utc(2026, 6, 15, 6, 0));

  // The result always stays on the host date, on the hour, across zones and dates.
  const hostCases = [
    [{ date: '2026-10-31', zone: 'Pacific/Kiritimati' }, ['Etc/GMT+12', 'Europe/London']],
    [{ date: '2026-10-31', zone: 'Etc/GMT+12' }, ['Pacific/Kiritimati', 'Asia/Kolkata']],
    [{ date: '2026-10-31', zone: 'Asia/Kathmandu' }, ['America/New_York', 'Asia/Kathmandu']],
    [{ date: '2026-12-31', zone: 'Australia/Sydney' }, ['Europe/London']],
  ];
  for (const [host, guests] of hostCases) {
    const found = suggestKinderTime(host, guests);
    assert.equal(found.date, host.date, `${host.zone}: stays on the host date`);
    assert.match(found.time, /^\d{2}:00$/, `${host.zone}: on the hour`);
  }

  // A skipped hour is never offered. New York 2026-03-08 has no 02:00 (clocks go 02:00 to 03:00).
  // Guest in Etc/GMT+1 (-01:00) is up for host hours 00 and 01, free at 03:00 (07:00Z reads 06:00 for the guest).
  const springForward = suggestKinderTime({ date: '2026-03-08', zone: 'America/New_York' }, ['Etc/GMT+1']);
  assert.equal(springForward.time, '03:00');
  assert.equal(springForward.count, 0);
  assert.equal(springForward.ms, utc(2026, 3, 8, 7, 0));
  for (const guests of [[], ['Europe/London'], ['Etc/GMT+1'], ['Asia/Kolkata', 'Etc/GMT+1']]) {
    const found = suggestKinderTime({ date: '2026-03-08', zone: 'America/New_York' }, guests);
    assert.notEqual(found.time, '02:00', `guests ${JSON.stringify(guests)}: 02:00 does not exist on 2026-03-08`);
  }

  // A repeated hour can win, reported with the choice that makes it unambiguous.
  // New York 2026-11-01 01:00 happens at 05:00Z (EDT) and 06:00Z (EST).
  // Guest in Etc/GMT-1 (+01:00): up at 00:00 (04:00Z reads 05:00), free at the earlier 01:00 (05:00Z reads 06:00).
  const earlierWins = suggestKinderTime({ date: '2026-11-01', zone: 'America/New_York' }, ['Etc/GMT-1']);
  assert.equal(earlierWins.time, '01:00');
  assert.equal(earlierWins.choice, 'earlier');
  assert.equal(earlierWins.ms, utc(2026, 11, 1, 5, 0));
  assert.equal(earlierWins.count, 0);
  assert.equal(resolveLocal({ date: '2026-11-01', time: earlierWins.time, zone: 'America/New_York' }, earlierWins.choice).ms, earlierWins.ms);

  // Guest in UTC: up at 00:00 (04:00Z) and at the earlier 01:00 (05:00Z reads 05:00), free at the later 01:00 (06:00Z).
  const laterWins = suggestKinderTime({ date: '2026-11-01', zone: 'America/New_York' }, ['UTC']);
  assert.equal(laterWins.time, '01:00');
  assert.equal(laterWins.choice, 'later');
  assert.equal(laterWins.ms, utc(2026, 11, 1, 6, 0));
  assert.equal(laterWins.count, 0);
  assert.equal(resolveLocal({ date: '2026-11-01', time: laterWins.time, zone: 'America/New_York' }, laterWins.choice).ms, laterWins.ms);

  // Design decision 5 (unconfirmed): the page offers the kinder time as a link, only when it improves on the current start.
  // from '../../src/page.js'
  const { buildView } = await import('../../src/page.js');
  const base = '?date=2026-10-31&time=20:00&zone=America/New_York&guests=Europe/London,Asia/Kolkata';
  const view = buildView(base);
  assert.equal(view.status, 'ok');
  assert.equal(view.kinder.time, '02:00');
  assert.equal(view.kinder.count, 0);
  const link = new URLSearchParams(view.kinder.search);
  assert.equal(link.get('time'), '02:00');
  assert.equal(link.get('date'), '2026-10-31');
  assert.equal(link.get('zone'), 'America/New_York');
  assert.equal(link.get('guests'), 'Europe/London,Asia/Kolkata');
  const kinderView = buildView(view.kinder.search);
  assert.equal(kinderView.status, 'ok');
  assert.ok(kinderView.rows.every((r) => r.deadOfNight === false), 'nobody is up in the dead of night at the kinder time');
  assert.equal(kinderView.kinder, null, 'nothing kinder than a start that already marks nobody');

  const noOneUp = buildView('?date=2026-10-31&time=20:00&zone=America/New_York&guests=America/Caracas,Australia/Sydney');
  assert.equal(noOneUp.status, 'ok');
  assert.equal(noOneUp.kinder, null, 'no kinder time when nobody is in the dead of night');
});
