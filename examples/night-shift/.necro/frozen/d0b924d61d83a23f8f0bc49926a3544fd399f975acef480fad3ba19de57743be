// Frozen contract: planner, Requirement 1 (read the host's start time).
// One test per acceptance criterion. Expected values come from real zones and dates, not from the code under test.
// Expected to fail until src/ exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A user-facing error: one short plain sentence (no newline, one final period, no second sentence).
function assertOneSentence(text, label) {
  assert.equal(typeof text, 'string', `${label}: error must be a string`);
  assert.ok(text.length > 0 && text.length <= 200, `${label}: error must be short, got ${text.length} characters`);
  assert.ok(!/[\r\n]/.test(text), `${label}: error must not contain a newline`);
  assert.ok(text.endsWith('.'), `${label}: error must end with a period`);
  assert.ok(!text.slice(0, -1).includes('. '), `${label}: error must be a single sentence`);
}

const utc = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh, mm);

test('R1.1 turns a local date, time and zone into the single UTC instant', async () => {
  // from '../../src/resolve.js'
  const { resolveLocal } = await import('../../src/resolve.js');

  const cases = [
    // Halloween 2026, 20:00 local. New York is still on daylight time (-04:00) until 2026-11-01.
    ['America/New_York', '2026-10-31', '20:00', utc(2026, 11, 1, 0, 0)],
    // London left summer time on 2026-10-25, so it is +00:00.
    ['Europe/London', '2026-10-31', '20:00', utc(2026, 10, 31, 20, 0)],
    // Sydney is on daylight time (+11:00) from 2026-10-04.
    ['Australia/Sydney', '2026-10-31', '20:00', utc(2026, 10, 31, 9, 0)],
    ['Asia/Kolkata', '2026-10-31', '20:00', utc(2026, 10, 31, 14, 30)],
    ['Asia/Kathmandu', '2026-10-31', '20:00', utc(2026, 10, 31, 14, 15)],
    ['UTC', '2026-10-31', '20:00', utc(2026, 10, 31, 20, 0)],
    // One minute before and at each 2026 clock change: these resolve normally.
    ['America/New_York', '2026-03-08', '01:59', utc(2026, 3, 8, 6, 59)], // EST -05:00
    ['America/New_York', '2026-03-08', '03:00', utc(2026, 3, 8, 7, 0)], // EDT -04:00
    ['America/New_York', '2026-11-01', '00:59', utc(2026, 11, 1, 4, 59)], // EDT, before the repeated hour
    ['America/New_York', '2026-11-01', '02:00', utc(2026, 11, 1, 7, 0)], // EST, after the repeated hour
    ['Europe/London', '2026-03-29', '00:59', utc(2026, 3, 29, 0, 59)], // GMT
    ['Europe/London', '2026-03-29', '02:00', utc(2026, 3, 29, 1, 0)], // BST
    ['Europe/London', '2026-10-25', '00:59', utc(2026, 10, 24, 23, 59)], // BST, before the repeated hour
    ['Europe/London', '2026-10-25', '02:00', utc(2026, 10, 25, 2, 0)], // GMT, after the repeated hour
    ['Australia/Lord_Howe', '2026-10-04', '01:59', utc(2026, 10, 3, 15, 29)], // +10:30
    ['Australia/Lord_Howe', '2026-10-04', '02:30', utc(2026, 10, 3, 15, 30)], // +11:00
  ];

  for (const [zone, date, time, expected] of cases) {
    const result = resolveLocal({ date, time, zone });
    const label = `${date} ${time} ${zone}`;
    assert.equal(result.ok, true, `${label}: should resolve`);
    assert.equal(result.ms, expected, `${label}: wrong instant ${new Date(result.ms).toISOString()}`);
  }
});

test('R1.2 refuses a local time skipped by clocks jumping forward, naming the skipped range', async () => {
  // from '../../src/resolve.js'
  const { resolveLocal } = await import('../../src/resolve.js');

  const cases = [
    // [zone, date, time, skipped range the sentence must name]
    ['America/New_York', '2026-03-08', '02:30', '02:00 to 03:00'],
    ['America/New_York', '2026-03-08', '02:00', '02:00 to 03:00'], // first skipped minute
    ['America/New_York', '2026-03-08', '02:59', '02:00 to 03:00'], // last skipped minute
    ['Europe/London', '2026-03-29', '01:30', '01:00 to 02:00'],
    // A half-hour gap, so the sentence cannot just say "the 02:00 hour".
    ['Australia/Lord_Howe', '2026-10-04', '02:15', '02:00 to 02:30'],
  ];

  for (const [zone, date, time, range] of cases) {
    const label = `${date} ${time} ${zone}`;
    const result = resolveLocal({ date, time, zone });
    assert.equal(result.ok, false, `${label}: must be refused`);
    assert.equal(result.reason, 'gap', `${label}: reason`);
    assert.equal(result.ms, undefined, `${label}: a refused time must not carry an instant`);
    assertOneSentence(result.error, label);
    assert.ok(result.error.includes(range), `${label}: error should name "${range}", got: ${result.error}`);
    assert.ok(result.error.includes(zone), `${label}: error should name the zone, got: ${result.error}`);
  }

  // The same refusal reaches the page as a single sentence.
  // from '../../src/page.js'
  const { buildView } = await import('../../src/page.js');
  const view = buildView('?date=2026-03-08&time=02:30&zone=America/New_York&guests=Europe/London');
  assert.equal(view.status, 'error');
  assertOneSentence(view.message, 'page gap');
  assert.ok(view.message.includes('02:00 to 03:00'), `page message should name the skipped range, got: ${view.message}`);
});

test('R1.3 requires a choice when a local time happens twice, and returns the instant for the choice', async () => {
  // from '../../src/resolve.js'
  const { resolveLocal } = await import('../../src/resolve.js');

  const cases = [
    // [zone, date, time, earlier instant, later instant]
    ['America/New_York', '2026-11-01', '01:30', utc(2026, 11, 1, 5, 30), utc(2026, 11, 1, 6, 30)], // EDT then EST
    ['America/New_York', '2026-11-01', '01:00', utc(2026, 11, 1, 5, 0), utc(2026, 11, 1, 6, 0)],
    ['America/New_York', '2026-11-01', '01:59', utc(2026, 11, 1, 5, 59), utc(2026, 11, 1, 6, 59)],
    ['Europe/London', '2026-10-25', '01:30', utc(2026, 10, 25, 0, 30), utc(2026, 10, 25, 1, 30)], // BST then GMT
    // Lord Howe falls back by only 30 minutes.
    ['Australia/Lord_Howe', '2027-04-04', '01:45', utc(2027, 4, 3, 14, 45), utc(2027, 4, 3, 15, 15)],
  ];

  for (const [zone, date, time, earlier, later] of cases) {
    const label = `${date} ${time} ${zone}`;
    const start = { date, time, zone };

    const open = resolveLocal(start);
    assert.equal(open.ok, false, `${label}: must not pick silently`);
    assert.equal(open.reason, 'ambiguous', `${label}: reason`);
    assertOneSentence(open.error, label);
    assert.ok(/earlier/.test(open.error) && /later/.test(open.error), `${label}: error should offer earlier or later, got: ${open.error}`);
    assert.ok(open.error.includes(time), `${label}: error should name the time, got: ${open.error}`);
    assert.equal(open.options.earlier, earlier, `${label}: options.earlier`);
    assert.equal(open.options.later, later, `${label}: options.later`);

    const first = resolveLocal(start, 'earlier');
    assert.equal(first.ok, true, `${label}: earlier should resolve`);
    assert.equal(first.ms, earlier, `${label}: earlier instant`);

    const second = resolveLocal(start, 'later');
    assert.equal(second.ok, true, `${label}: later should resolve`);
    assert.equal(second.ms, later, `${label}: later instant`);
  }

  // New York and London repeat a full hour, so the two instants are exactly one hour apart.
  for (const [zone, date] of [['America/New_York', '2026-11-01'], ['Europe/London', '2026-10-25']]) {
    const e = resolveLocal({ date, time: '01:30', zone }, 'earlier').ms;
    const l = resolveLocal({ date, time: '01:30', zone }, 'later').ms;
    assert.equal(l - e, 3600000, `${zone}: instants should be one hour apart`);
  }

  // Design decision 1 (unconfirmed): the choice survives a reload as `pick=earlier|later` in the link.
  // from '../../src/page.js'
  const { buildView } = await import('../../src/page.js');
  const base = '?date=2026-11-01&time=01:30&zone=America/New_York&guests=Europe/London';
  const choose = buildView(base);
  assert.equal(choose.status, 'choose');
  assertOneSentence(choose.message, 'page choose');
  assert.equal(choose.links.length, 2, 'two links: earlier and later');
  assert.ok(choose.links.every((l) => typeof l.label === 'string' && l.label.length > 0));
  assert.ok(/pick=earlier/.test(choose.links[0].search) && /pick=later/.test(choose.links[1].search));

  const early = buildView(choose.links[0].search);
  const late = buildView(choose.links[1].search);
  assert.equal(early.status, 'ok');
  assert.equal(late.status, 'ok');
  assert.equal(early.host.offset, '-04:00');
  assert.equal(late.host.offset, '-05:00');
  assert.equal(early.rows[0].time, '05:30'); // London is on GMT, so it reads the UTC time
  assert.equal(late.rows[0].time, '06:30');
});

test('R1.4 refuses an invalid date, time or zone with one plain sentence saying which one', async () => {
  // from '../../src/input.js'
  const { parseStart } = await import('../../src/input.js');

  const good = { date: '2026-10-31', time: '20:00', zone: 'America/New_York' };

  // Valid input passes through unchanged.
  for (const ok of [
    good,
    { date: '2028-02-29', time: '00:00', zone: 'UTC' }, // leap day
    { date: '2026-10-31', time: '23:59', zone: 'Asia/Kathmandu' },
    { date: '2026-03-08', time: '02:30', zone: 'America/New_York' }, // nonexistent local time is still well formed
  ]) {
    assert.deepEqual(parseStart(ok), { ok: true, value: ok });
  }

  // Each field is named, and only that field.
  const field = {
    date: { bad: ['2026-02-30', '2026-02-29', '2026-13-01', '10/31/2026', '2026-2-3', ''], pattern: /date/i, others: [/zone/i] },
    time: { bad: ['24:00', '7:5', '12:60', '8pm', ''], pattern: /time/i, others: [/date/i, /zone/i] },
    zone: { bad: ['Mars/Base', '+05:30', 'nope', ''], pattern: /zone/i, others: [/date/i] },
  };
  for (const [name, spec] of Object.entries(field)) {
    for (const value of spec.bad) {
      const label = `${name}=${JSON.stringify(value)}`;
      const result = parseStart({ ...good, [name]: value });
      assert.equal(result.ok, false, `${label}: must be refused`);
      assertOneSentence(result.error, label);
      assert.match(result.error, spec.pattern, `${label}: error should name the ${name}`);
      for (const other of spec.others) assert.doesNotMatch(result.error, other, `${label}: error should not name another field`);
    }
    // A missing value is invalid for its field.
    const { [name]: _dropped, ...without } = good;
    const missing = parseStart(without);
    assert.equal(missing.ok, false, `${name} missing: must be refused`);
    assertOneSentence(missing.error, `${name} missing`);
    assert.match(missing.error, spec.pattern, `${name} missing: error should name the ${name}`);
  }

  // With several problems, exactly one is reported, in the order date, time, zone.
  const dateAndZone = parseStart({ date: '2026-02-30', time: '20:00', zone: 'Mars/Base' });
  assert.match(dateAndZone.error, /date/i);
  assert.doesNotMatch(dateAndZone.error, /zone/i);
  const timeAndZone = parseStart({ date: '2026-10-31', time: '24:00', zone: 'Mars/Base' });
  assert.doesNotMatch(timeAndZone.error, /zone/i);
  const allThree = parseStart({ date: 'x', time: 'y', zone: 'z' });
  assert.match(allThree.error, /date/i);
  assert.doesNotMatch(allThree.error, /zone/i);

  // The link is untrusted: echoed values are cut to 40 characters.
  const long = 'x'.repeat(100);
  for (const name of ['date', 'time', 'zone']) {
    const result = parseStart({ ...good, [name]: long });
    assertOneSentence(result.error, `long ${name}`);
    assert.ok(!result.error.includes('x'.repeat(41)), `long ${name}: echoed value must be cut to 40 characters`);
  }

  // The same sentences reach the page.
  // from '../../src/page.js'
  const { buildView } = await import('../../src/page.js');
  const pageCases = [
    ['?date=2026-02-30&time=20:00&zone=America/New_York&guests=Europe/London', /date/i],
    ['?date=2026-10-31&time=24:00&zone=America/New_York&guests=Europe/London', /time/i],
    ['?date=2026-10-31&time=20:00&zone=Mars/Base&guests=Europe/London', /zone/i],
    ['', /date/i], // nothing given: the first missing field is reported
  ];
  for (const [search, pattern] of pageCases) {
    const view = buildView(search);
    assert.equal(view.status, 'error', `page ${search}`);
    assertOneSentence(view.message, `page ${search}`);
    assert.match(view.message, pattern, `page ${search}`);
  }
  const longView = buildView(`?date=${long}&time=20:00&zone=America/New_York`);
  assert.equal(longView.status, 'error');
  assert.ok(!longView.message.includes('x'.repeat(41)), 'page: echoed value must be cut to 40 characters');
});
