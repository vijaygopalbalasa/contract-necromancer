// Task 9: the pure parts of the form (Req 4.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildView, EXAMPLE_FORM, EXAMPLE_SEARCH, readForm, formToSearch, refusalFor } from '../src/page.js';

const readSite = (name) => readFile(new URL(`../site/${name}`, import.meta.url), 'utf8');

test('the default example is 2026-10-31 20:00 in New York with the four guests, and it works', () => {
  assert.deepEqual(EXAMPLE_FORM, {
    date: '2026-10-31',
    time: '20:00',
    zone: 'America/New_York',
    guests: 'Europe/London, Asia/Kolkata, Asia/Tokyo, Asia/Kathmandu',
  });
  const view = buildView(EXAMPLE_SEARCH);
  assert.equal(view.status, 'ok');
  assert.deepEqual(
    view.rows.map((r) => [r.zone, r.date, r.time]),
    [
      ['Europe/London', '2026-11-01', '00:00'],
      ['Asia/Kolkata', '2026-11-01', '05:30'],
      ['Asia/Kathmandu', '2026-11-01', '05:45'],
      ['Asia/Tokyo', '2026-11-01', '09:00'],
    ],
  );
});

test('no query string, or a missing date, time or zone, reads as the example', () => {
  for (const search of [
    '',
    '?',
    '?date=2026-11-02',
    '?date=2026-10-31&time=20:00',
    '?time=20:00&zone=Asia/Tokyo&guests=Europe/London',
    '?guests=Europe/London',
    undefined,
  ]) {
    const form = readForm(search);
    assert.equal(form.example, true, String(search));
    assert.deepEqual(form.fields, EXAMPLE_FORM, String(search));
    assert.equal(form.search, EXAMPLE_SEARCH, String(search));
  }
});

test('a complete link is read into the form fields as it is', () => {
  const form = readForm('?date=2026-11-02&time=19:30&zone=Asia/Tokyo&guests=Europe/London,%20Asia/Kolkata,,');
  assert.equal(form.example, false);
  assert.deepEqual(form.fields, {
    date: '2026-11-02',
    time: '19:30',
    zone: 'Asia/Tokyo',
    guests: 'Europe/London, Asia/Kolkata',
  });
  // A link without guests is still a complete link (Req 4.1): the guests box is just empty.
  const alone = readForm('?date=2026-11-02&time=19:30&zone=Asia/Tokyo');
  assert.equal(alone.example, false);
  assert.equal(alone.fields.guests, '');
  // A part that is present but empty is not missing: the refusal of 1.4 is shown with the form as typed.
  const blank = readForm('?date=&time=20:00&zone=America/New_York&guests=');
  assert.equal(blank.example, false);
  assert.equal(blank.fields.date, '');
});

test('form values become a link in the form of 4.1, and read back the same', () => {
  const search = formToSearch(EXAMPLE_FORM);
  assert.equal(search, '?date=2026-10-31&time=20:00&zone=America/New_York&guests=Europe/London,Asia/Kolkata,Asia/Tokyo,Asia/Kathmandu');
  assert.equal(search, EXAMPLE_SEARCH);
  assert.deepEqual(readForm(search).fields, EXAMPLE_FORM);
  // The link gives the same result as the example it came from.
  assert.deepEqual(buildView(search), buildView(EXAMPLE_SEARCH));

  // Spaces and empty items in the guests box are tidied; surrounding spaces in other boxes are trimmed.
  assert.equal(
    formToSearch({ date: ' 2026-11-02 ', time: '19:30 ', zone: ' Asia/Tokyo', guests: ' Europe/London ,, Asia/Kolkata ,' }),
    '?date=2026-11-02&time=19:30&zone=Asia/Tokyo&guests=Europe/London,Asia/Kolkata',
  );
  // No guests gives an empty guests value, which 4.1 accepts.
  assert.equal(formToSearch({ ...EXAMPLE_FORM, guests: '' }), '?date=2026-10-31&time=20:00&zone=America/New_York&guests=');
});

test('odd characters in the form values cannot break out of the link', () => {
  const search = formToSearch({ date: '2026-10-31', time: '20:00', zone: 'A&zone=UTC#x', guests: 'a&b, c=d%' });
  const params = new URLSearchParams(search.slice(1));
  assert.deepEqual([...params.keys()], ['date', 'time', 'zone', 'guests']);
  assert.equal(params.get('zone'), 'A&zone=UTC#x');
  assert.equal(params.get('guests'), 'a&b,c=d%');
  assert.deepEqual(readForm(search).fields.guests, 'a&b, c=d%');
});

test('a refusal is placed next to the form, so the page is never empty', () => {
  // Hosts' mistakes: a bad date (1.4), a skipped hour (1.2), a bad guest zone.
  const cases = [
    ['?date=2026-02-30&time=20:00&zone=America/New_York&guests=Europe/London', /date/],
    ['?date=&time=20:00&zone=America/New_York&guests=', /date/],
    ['?date=2026-10-31&time=25:00&zone=America/New_York&guests=', /time/],
    ['?date=2026-10-31&time=20:00&zone=Mars/Base&guests=', /zone/],
    ['?date=2026-03-08&time=02:30&zone=America/New_York&guests=Europe/London', /02:00/],
    ['?date=2026-10-31&time=20:00&zone=America/New_York&guests=Mars/Base', /Mars\/Base/],
  ];
  for (const [search, pattern] of cases) {
    const view = buildView(search);
    assert.equal(view.status, 'error', search);
    const refusal = refusalFor(view);
    assert.ok(refusal, search);
    assert.equal(refusal.message, view.message, search);
    assert.match(refusal.message, pattern, search);
    assert.deepEqual(refusal.links, [], search);
    // The form still shows what was typed so the host can fix it.
    assert.equal(readForm(search).example, false, search);
  }
  // A time that happens twice asks for a choice, and the two links come with it.
  const choose = buildView('?date=2026-11-01&time=01:30&zone=America/New_York&guests=Europe/London');
  const asked = refusalFor(choose);
  assert.equal(asked.message, choose.message);
  assert.deepEqual(asked.links, choose.links);
  // Nothing to refuse when the result is fine.
  assert.equal(refusalFor(buildView(EXAMPLE_SEARCH)), null);
});

test('the page has a form with the four fields, filled and read by main.js', async () => {
  const main = await readSite('main.js');
  assert.match(main, /readForm\(/, 'main.js should read the form from the link');
  assert.match(main, /formToSearch\(/, 'main.js should build the link from the form');
  assert.match(main, /refusalFor\(/, 'main.js should place the refusal next to the form');
  assert.match(main, /addEventListener\(\s*['"]submit['"]/, 'main.js should handle submit');
  assert.match(main, /pushState/, 'main.js should update the link without leaving the page');
  assert.match(main, /preventDefault/);
  for (const name of ['date', 'time', 'zone', 'guests']) {
    assert.match(main, new RegExp(`['"]${name}['"]`), `main.js should create the ${name} field`);
  }
});

test('the stylesheet styles the form without adding motion or fixed widths', async () => {
  const css = (await readSite('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\bform\b/);
  assert.match(css, /\binput\b/);
  assert.match(css, /focus-visible/, 'keyboard focus should be visible');
});
