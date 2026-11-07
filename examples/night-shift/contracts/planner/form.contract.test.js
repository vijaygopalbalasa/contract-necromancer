// Contract: planner, Requirement 4.4 (the form with a working example).
// Written for human review; it becomes a frozen contract only after `necro freeze planner` is run by a person.
// There is no browser here, so the page is checked through the pure functions in src/ and by reading site/ as text.
// What only a browser can show (layout at 320px, focus ring, the real submit) is NOT covered here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSite = (name) => readFile(new URL(`../../site/${name}`, import.meta.url), 'utf8');

test('R4.4 shows a form filled with the working example and its result when the link is missing a part, builds the 4.1 link on submit, and shows a refusal next to the form', async () => {
  // from '../../src/page.js'
  const { buildView, readForm, formToSearch, refusalFor } = await import('../../src/page.js');

  // --- The example: no query string, or a missing date, time or zone ---------------------------------------
  const example = {
    date: '2026-10-31',
    time: '20:00',
    zone: 'America/New_York',
    guests: 'Europe/London, Asia/Kolkata, Asia/Tokyo, Asia/Kathmandu',
  };
  for (const search of ['', '?', '?date=2026-10-31', '?date=2026-10-31&time=20:00', '?zone=Asia/Tokyo&guests=Europe/London']) {
    const form = readForm(search);
    assert.deepEqual(form.fields, example, `the form for "${search}" is filled with the example`);
    // The result shown is the example's result, and it is a real result, not an error.
    const view = buildView(form.search);
    assert.equal(view.status, 'ok', `the example works for "${search}"`);
    assert.deepEqual(view.host, { date: '2026-10-31', time: '20:00', offset: '-04:00', zone: 'America/New_York' });
    assert.deepEqual(
      view.rows.map((r) => [r.zone, r.date, r.time, r.offset, r.dayLabel, r.note]),
      [
        ['Europe/London', '2026-11-01', '00:00', '+00:00', 'the day after', 'dead of night'],
        ['Asia/Kolkata', '2026-11-01', '05:30', '+05:30', 'the day after', 'dead of night'],
        ['Asia/Kathmandu', '2026-11-01', '05:45', '+05:45', 'the day after', 'dead of night'],
        ['Asia/Tokyo', '2026-11-01', '09:00', '+09:00', 'the day after', ''],
      ],
    );
  }
  // A complete link is not replaced by the example: the form shows what the link says.
  const given = readForm('?date=2026-11-02&time=19:30&zone=Asia/Tokyo&guests=Europe/London');
  assert.deepEqual(given.fields, { date: '2026-11-02', time: '19:30', zone: 'Asia/Tokyo', guests: 'Europe/London' });

  // --- Submitting: the link is the ?date=... form of 4.1 and shows the new result --------------------------
  const typed = { date: '2026-11-02', time: '19:30', zone: 'Asia/Tokyo', guests: ' Europe/London , Asia/Kolkata ' };
  const link = formToSearch(typed);
  assert.equal(link, '?date=2026-11-02&time=19:30&zone=Asia/Tokyo&guests=Europe/London,Asia/Kolkata');
  const fromLink = buildView(link);
  assert.equal(fromLink.status, 'ok');
  assert.deepEqual(fromLink.host, { date: '2026-11-02', time: '19:30', offset: '+09:00', zone: 'Asia/Tokyo' });
  assert.deepEqual(fromLink.rows.map((r) => [r.zone, r.date, r.time]), [
    ['Europe/London', '2026-11-02', '10:30'],
    ['Asia/Kolkata', '2026-11-02', '16:00'],
  ]);
  assert.deepEqual(readForm(link).fields, { ...typed, guests: 'Europe/London, Asia/Kolkata' }, 'the link reads back into the same form');

  // --- A refusal of 1.2 or 1.4 is shown next to the form instead of an empty page -------------------------
  const gap = buildView(formToSearch({ ...example, date: '2026-03-08', time: '02:30' }));
  assert.equal(gap.status, 'error');
  assert.match(refusalFor(gap).message, /02:00/, '1.2: the sentence names the skipped hour');
  const badDate = buildView(formToSearch({ ...example, date: '2026-02-30' }));
  const badZone = buildView(formToSearch({ ...example, zone: 'Mars/Base' }));
  const badTime = buildView(formToSearch({ ...example, time: '25:00' }));
  const empty = buildView(formToSearch({ ...example, date: '' }));
  for (const [view, word] of [[badDate, 'date'], [badZone, 'zone'], [badTime, 'time'], [empty, 'date']]) {
    assert.equal(view.status, 'error');
    const refusal = refusalFor(view);
    assert.ok(refusal && refusal.message.length > 0, '1.4: a message is given');
    assert.match(refusal.message, new RegExp(word), `1.4: the sentence says which one (${word})`);
  }
  // The form still holds what was typed, so the host can fix it instead of starting over.
  assert.equal(readForm(formToSearch({ ...example, date: '2026-02-30' })).fields.date, '2026-02-30');
  assert.equal(readForm(formToSearch({ ...example, date: '' })).example, false, 'an empty box is shown as empty, not replaced');
  assert.equal(refusalFor(buildView(formToSearch(example))), null, 'no refusal when the result is fine');

  // --- The static page builds the form and wires submit to the link ----------------------------------------
  const main = await readSite('main.js');
  for (const name of ['date', 'time', 'zone', 'guests']) {
    assert.match(main, new RegExp(`['"]${name}['"]`), `site/main.js should have a "${name}" field`);
  }
  assert.match(main, /readForm\(/, 'site/main.js should fill the form from the link');
  assert.match(main, /formToSearch\(/, 'site/main.js should build the link from the form');
  assert.match(main, /refusalFor\(/, 'site/main.js should show the refusal next to the form');
  assert.match(main, /addEventListener\(\s*['"]submit['"]/, 'site/main.js should handle submit');
  assert.match(main, /preventDefault/, 'submit should not reload the page by default');
  assert.match(main, /pushState/, 'submit should update the link');
  // 4.1 to 4.3 still hold for the new code.
  assert.ok(!main.includes('innerHTML'), 'site/main.js must not use innerHTML; the form values are untrusted');
  const css = (await readSite('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\binput\b/, 'site/style.css should style the form fields');
  assert.match(css, /focus-visible/, 'site/style.css should show keyboard focus');
  assert.doesNotMatch(css, /url\s*\(|@import|https?:/i, 'site/style.css must not load anything external');
});
