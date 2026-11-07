import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Requirement 9.5: on a first visit the verdict banner and the first contract rows are visible without scrolling at
// 1280x800 and 390x844. A test in Node cannot lay the page out, so these tests pin the order of the page's parts and the
// CSS that keeps what comes before the result short. The real pixel positions are measured in a headless browser, by
// hand, and reported with the task.

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('site/index.html');
const css = read('site/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

const at = (needle) => {
  const i = html.indexOf(needle);
  assert.ok(i >= 0, `index.html has no ${needle}`);
  return i;
};
const idAt = (id) => at(`id="${id}"`);

// The part of the page before the verdict banner: everything a first visitor passes to reach the result.
const beforeVerdict = html.slice(html.indexOf('<body'), idAt('verdict'));

// The element with this id, from its opening tag to its closing tag (the tags used here do not nest in themselves).
function element(tag, id) {
  const start = html.lastIndexOf(`<${tag}`, idAt(id));
  const end = html.indexOf(`</${tag}>`, start);
  assert.ok(start >= 0 && end > start, `no <${tag} id="${id}"> element`);
  return html.slice(start, end + tag.length + 3);
}

test('the parts of the page come in this order: name, sample switch, verdict banner, contract rows, receipt facts, the checks, the explanation', () => {
  const order = ['brand', 'sample-note', 'sample-row', 'open', 'verdict', 'receipt', 'summary', 'groups', 'spec', 'hash-check', 'run', 'file-check', 'about'];
  const positions = order.map((id) => [id, idAt(id)]);
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i - 1][1] < positions[i][1], `#${positions[i - 1][0]} must come before #${positions[i][0]}`);
  }
});

test('nothing tall comes before the verdict banner: no paste box in the open, no explanation, no legend', () => {
  assert.doesNotMatch(beforeVerdict.replace(element('details', 'open'), ''), /<textarea|<input|class="lede"|class="legend"|id="limit"/, 'a form field or the explanation sits above the banner');
  assert.doesNotMatch(beforeVerdict, /<h2/, 'a second heading sits above the banner');
});

test('the way to open your own receipt sits above the result in a collapsed details element with paste, file and Show', () => {
  const open = element('details', 'open');
  assert.doesNotMatch(/^<details[^>]*>/.exec(open)[0], /\sopen[\s>=]/, 'it starts collapsed so it does not push the result down');
  assert.match(/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(open)[1], /open your own receipt/i);
  for (const id of ['paste', 'show', 'file']) assert.ok(open.includes(`id="${id}"`), `#${id} belongs inside the open element`);
  assert.ok(idAt('open') < idAt('verdict'));
});

test('the sample switch is visible from the start, above the banner, and the error message is not hidden inside the collapsed details', () => {
  assert.ok(idAt('sample') < idAt('verdict') && idAt('sample-buried') < idAt('verdict'));
  assert.doesNotMatch(/<[^>]*id="sample-row"[^>]*>/.exec(html)[0], /\bhidden\b/);
  assert.ok(!element('details', 'open').includes('id="error"'), 'an alert inside a closed details element cannot be seen');
  assert.ok(idAt('error') < idAt('verdict'));
});

test('the honest limit and the PASS and FAIL legend are still on the page, after the result', () => {
  const about = element('section', 'about');
  assert.match(about, /necro verify/);
  assert.match(about, /hashes, not test runs/);
  assert.match(about, /<strong class="legend-alive">PASS<\/strong>/);
  assert.match(about, /<strong class="legend-grave">FAIL<\/strong>/);
  assert.ok(idAt('about') > idAt('receipt'));
});

test('the page keeps one heading level order: one h1, in the header', () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.ok(html.indexOf('<h1') < idAt('verdict'));
});

test('the style sheet keeps the part before the result short: a compact bar, a collapsed details summary and a compact banner', () => {
  assert.match(css, /\.bar\s*{/, 'style.css needs a .bar rule for the sample switch');
  assert.match(css, /\.open-own\b[^{]*{/, 'style.css needs rules for the .open-own details');
  // The banner's base (phone) padding is at most 1.25rem top and bottom; the wide rule may add a little.
  const base = /(^|\n)\.verdict\s*{([^}]*)}/.exec(css)[2];
  const padding = /padding:\s*([\d.]+)rem/.exec(base);
  assert.ok(padding && Number(padding[1]) <= 1.25, `the banner needs a compact padding, it has ${padding && padding[1]}rem`);
  const h1 = /h1\s*{[^}]*font-size:\s*clamp\(([\d.]+)rem/.exec(css);
  assert.ok(h1 && Number(h1[1]) <= 1.5, 'the title must be at most 1.5rem on a phone');
});
