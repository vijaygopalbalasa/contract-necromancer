// Contract for R9.5 of the receipt-viewer spec: on a first visit the verdict banner and the first contract rows are in the
// first screen, in a 1280x800 window and in a 390x844 phone window, and the way to open your own receipt is still on the
// page.
//
// Node cannot lay a page out, so this contract checks what makes the first screen short, from the files as text:
//   1. the order of the page's parts in site/index.html (the banner and the contract rows come before the facts, the
//      checks and the explanation, and the sample switch and the way to open your own receipt are above the result);
//   2. that nothing tall sits above the banner (the paste form is inside one collapsed <details>, the explanation and
//      the legend are below the result, the sample note is short);
//   3. that site/style.css keeps the header, the bar and the banner compact.
// Whether the banner and the rows really land inside 1280x800 and 390x844 is measured by hand in a headless browser
// (see the task report); this file cannot prove it.
//
// The sample notes are read with a dynamic import so this file always loads and the contract name is always registered.
// Dynamic imports are not followed by necro's import tracing, so the module is also named below the way a static import
// would name it. Keep this line: the receipt pins files it finds this way.
//   import {} from '../../site/lib/samples.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const HTML = fs.readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SAMPLES_URL = new URL('../../site/lib/samples.js', import.meta.url);

// The position of the tag that carries this id.
function idAt(id) {
  const i = HTML.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
}

// The whole <details id="open"> element, from its opening tag to its closing tag.
function openElement() {
  const start = HTML.lastIndexOf('<details', idAt('open'));
  assert.ok(start >= 0 && HTML.slice(start, idAt('open')).indexOf('>') < 0, 'the way to open your own receipt must be a <details id="open"> element');
  const end = HTML.indexOf('</details>', start);
  assert.ok(end > start, 'the <details id="open"> element is not closed');
  return HTML.slice(start, end + '</details>'.length);
}

// The declarations of every rule at the top level of the style sheet whose selector list contains `selector`, merged.
function declarationsOf(selector) {
  const merged = new Map();
  for (const m of CSS.matchAll(/(?:^|(?<=[{}]))\s*([^{}@]+){([^{}]*)}/g)) {
    if (!m[1].split(',').map((s) => s.trim()).includes(selector)) continue;
    for (const part of m[2].split(';')) {
      const i = part.indexOf(':');
      if (i > 0) merged.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
    }
  }
  return merged;
}

const rem = (value) => {
  const m = /^(\d*\.?\d+)rem\b/.exec(value || '');
  return m ? Number(m[1]) : null;
};

test('R9.5 the first visit shows the verdict banner and the first contract rows without scrolling, with the sample switch and the way to open your own receipt still on the page', async () => {
  // 1. Order of the parts: name, sample switch, the way to open your own receipt, the banner, the receipt with its
  //    contract rows, then the facts, the checks and the explanation.
  const order = ['brand', 'sample-note', 'sample-row', 'open', 'verdict', 'receipt', 'summary', 'groups', 'spec', 'hash-check', 'run', 'file-check', 'about'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(idAt(order[i - 1]) < idAt(order[i]), `#${order[i - 1]} must come before #${order[i]}`);
  }
  const betweenReceiptAndRows = HTML.slice(idAt('receipt'), idAt('groups'));
  assert.doesNotMatch(betweenReceiptAndRows, /<dl|<table|<pre|<textarea|<input|<img|<svg/, 'only the heading and the summary may stand between the receipt card and its contract rows');

  // 2. The way to open your own receipt: reachable on the same page, above the result, and closed, so it takes one line.
  const open = openElement();
  assert.doesNotMatch(/^<details[^>]*>/.exec(open)[0], /\sopen[\s>=]/, 'the open-your-own-receipt element must start collapsed');
  assert.match(/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(open)?.[1] ?? '', /open your own receipt/i, 'its summary must say "Open your own receipt"');
  for (const id of ['paste', 'show', 'file']) assert.ok(open.includes(`id="${id}"`), `#${id} (paste, Show, file pick) must be inside the open-your-own-receipt element`);
  assert.ok(idAt('open') < idAt('verdict'), 'the way to open your own receipt must be above the result');

  // The two samples are one click away from the start, and a message about a bad receipt is not hidden in the closed element.
  for (const id of ['sample', 'sample-buried']) {
    assert.ok(idAt(id) < idAt('verdict'), `the #${id} button must be above the result`);
  }
  assert.doesNotMatch(/<[^>]*id="sample-row"[^>]*>/.exec(HTML)[0], /\bhidden\b/, 'the sample row must be visible from the start');
  assert.ok(!open.includes('id="error"'), 'the error message must not sit inside the closed element');
  assert.match(/<[^>]*id="error"[^>]*>/.exec(HTML)[0], /role="alert"/);
  assert.ok(idAt('error') < idAt('verdict'));

  // 3. Nothing tall above the banner: take away the closed element, the scripts and the tags, and little text is left.
  const above = HTML.slice(HTML.indexOf('<body'), idAt('verdict')).replace(open, '');
  assert.doesNotMatch(above, /<textarea|<input|<pre|<img|<h2|<table|<dl|class="lede"|class="legend"|id="limit"/, 'a form field, a second heading or the explanation sits above the banner');
  const words = above.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 40, `${words.length} words of fixed text sit above the banner, the limit is 40`);
  assert.equal((HTML.match(/<h1\b/g) || []).length, 1);

  // The sample note is the only text that varies above the banner, and it stays short enough to wrap to a few lines.
  const { SAMPLES } = await import(SAMPLES_URL.href);
  assert.ok(SAMPLES[0].note.length <= 120, `the note for the sample a first visit shows is ${SAMPLES[0].note.length} characters, the limit is 120`);
  for (const sample of SAMPLES) {
    assert.ok(sample.note.length <= 200, `the note for the ${sample.id} sample is ${sample.note.length} characters, the limit is 200`);
    assert.match(sample.note, /\bsample\b/i, 'the note must still say it is a sample');
  }

  // 4. The style sheet keeps the header, the bar and the banner compact.
  const title = declarationsOf('h1').get('font-size') || '';
  const titleFloor = /^clamp\(\s*(\d*\.?\d+)rem/.exec(title);
  assert.ok(titleFloor && Number(titleFloor[1]) <= 1.5, `the title is ${title || 'unset'}, its smallest size must be at most 1.5rem`);
  const banner = declarationsOf('.verdict');
  assert.ok(rem(banner.get('padding')) !== null && rem(banner.get('padding')) <= 1.25, `the banner padding is ${banner.get('padding')}, it must be at most 1.25rem at phone width`);
  assert.ok(declarationsOf('.bar').size > 0, 'style.css needs a .bar rule for the sample switch and the way to open your own receipt');
  for (const selector of ['.intro', '.bar', '.verdict', '.open-own', 'main']) {
    const d = declarationsOf(selector);
    for (const prop of ['min-height', 'height']) {
      assert.ok(!/\d\s*(vh|dvh|svh|lvh)\b/.test(d.get(prop) || ''), `${selector} sets ${prop}: ${d.get(prop)}, which could fill the first screen`);
    }
    assert.ok(!/^\s*-/.test(d.get('margin-top') || ''), `${selector} must not pull itself up with a negative margin`);
  }
  const mainPadding = declarationsOf('main').get('padding') || '';
  assert.ok(rem(mainPadding) !== null && rem(mainPadding) <= 1.5, `main starts ${mainPadding.split(/\s+/)[0]} from the top at phone width, the limit is 1.5rem`);
});
