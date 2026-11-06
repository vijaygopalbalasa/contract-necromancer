// Task 6: page view model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from '../src/page.js';

const EXAMPLE = '?date=2026-10-31&time=20:00&zone=America/New_York&guests=Europe/London,Asia/Kolkata';

test('the example link gives status ok with one sorted row per guest', () => {
  const v = buildView(EXAMPLE);
  assert.equal(v.status, 'ok');
  assert.deepEqual(v.host, { date: '2026-10-31', time: '20:00', offset: '-04:00', zone: 'America/New_York' });
  assert.deepEqual(v.rows.map((r) => r.zone), ['Europe/London', 'Asia/Kolkata']);
});

test('dead-of-night rows carry marker and note; others have neither', () => {
  const v = buildView(EXAMPLE);
  const london = v.rows.find((r) => r.zone === 'Europe/London');
  assert.equal(london.marker, '👻');
  assert.equal(london.note, 'dead of night');
  const sydney = buildView('?date=2026-10-31&time=20:00&zone=America/New_York&guests=Australia/Sydney').rows[0];
  assert.equal(sydney.marker, '');
  assert.equal(sydney.note, '');
});

test('an ambiguous time gives choose with two links, pick resolves to ok', () => {
  const base = '?date=2026-11-01&time=01:30&zone=America/New_York&guests=Europe/London';
  const choose = buildView(base);
  assert.equal(choose.status, 'choose');
  assert.equal(choose.links.length, 2);
  assert.ok(/pick=earlier/.test(choose.links[0].search));
  assert.ok(/pick=later/.test(choose.links[1].search));
  assert.equal(buildView(choose.links[0].search).status, 'ok');
  assert.equal(buildView(choose.links[1].search).status, 'ok');
});

test('gap, bad date, bad zone and bad guest zone each give error', () => {
  for (const search of [
    '?date=2026-03-08&time=02:30&zone=America/New_York&guests=Europe/London',
    '?date=2026-02-30&time=20:00&zone=America/New_York&guests=Europe/London',
    '?date=2026-10-31&time=20:00&zone=Mars/Base&guests=Europe/London',
    '?date=2026-10-31&time=20:00&zone=America/New_York&guests=Mars/Base',
  ]) {
    const v = buildView(search);
    assert.equal(v.status, 'error', search);
    assert.ok(v.message.endsWith('.'));
  }
});

test('empty guests gives empty rows; kinder is null when nobody is in the dead of night', () => {
  const v = buildView('?date=2026-10-31&time=20:00&zone=America/New_York&guests=');
  assert.deepEqual(v.rows, []);
  const noOne = buildView('?date=2026-10-31&time=20:00&zone=America/New_York&guests=America/Caracas,Australia/Sydney');
  assert.equal(noOne.kinder, null);
});

test('kinder is a link with a new time when someone is in the dead of night', () => {
  const v = buildView(EXAMPLE);
  assert.equal(v.kinder.time, '02:00');
  assert.ok(/time=02%3A00|time=02:00/.test(v.kinder.search));
});
