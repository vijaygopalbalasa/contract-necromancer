import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { withBrowser, NO_BROWSER } from './fixtures/browser.js';

// Requirement 12: the evidence on the first screen. One line between the story strip and the verdict banner gives the
// experiment result and links to the write-up, and the page no longer says that contracts re-run only in Node. Text
// checks read the files; layout checks run the page in a headless browser.

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('site/index.html');
const css = read('site/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

const EXPERIMENT = 'https://github.com/vijaygopalbalasa/contract-necromancer/blob/main/experiments/README.md';
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'";

const idAt = (id) => {
  const i = html.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
};
const textOf = (fragment) => fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// The evidence line: the <p id="evidence"> element, from its opening tag to its closing tag.
function evidence() {
  const at = idAt('evidence');
  const start = html.lastIndexOf('<', at);
  assert.match(html.slice(start, at), /^<p\b/, 'the evidence line is a <p id="evidence">');
  const end = html.indexOf('</p>', start) + '</p>'.length;
  const text = html.slice(start, end);
  return { start, end, text, words: textOf(text) };
}

const stripEnd = () => html.indexOf('</section>', html.lastIndexOf('<section', idAt('strip'))) + '</section>'.length;

// ---- R12.1 ----

test('R12.1 one line states the experiment result, in reading order between the story strip and the verdict banner', () => {
  const e = evidence();
  assert.ok(e.start >= stripEnd(), 'after the story strip');
  assert.ok(e.end < idAt('verdict'), 'before the verdict banner');
  assert.match(e.words, /\b11 of 11\b/);
  assert.match(e.words, /\b0 of 19\b/);
  assert.match(e.words, /without the gate/);
  assert.match(e.words, /\bwith it\b/);
  assert.match(e.words, /\btwo models\b/);
  assert.match(e.words, /cannot be finished/);
  assert.match(e.words, /marked it done/);
  assert.ok(e.words.indexOf('11 of 11') < e.words.indexOf('0 of 19'), 'the run without the gate comes first');
});

// Revised Nov 12: the old limit of 34 words is gone, because the element now also holds the round 3 caveat.
test('R12.1 the element is plain: no dashes, one paragraph, one plain link', () => {
  const e = evidence();
  assert.doesNotMatch(e.text, /[\u2013\u2014]/, 'no em or en dashes');
  assert.doesNotMatch(e.text, /<(script|svg|img|br|ul|ol|li|button|input)\b|\bhidden\b|aria-hidden|data-|\bon\w+=/i);
  const links = [...e.text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 1, 'exactly one link');
  assert.equal(/\bhref="([^"]*)"/.exec(links[0][1])[1], EXPERIMENT);
  assert.doesNotMatch(links[0][1], /\b(target|rel|download|onclick)=/, 'a plain link: only an href');
  assert.doesNotMatch(links[0][2], /</, 'the link text is plain words');
  assert.match(links[0][2], /experiment/i, 'the link says where it goes');
  assert.ok(html.split(EXPERIMENT).length === 2, 'the address appears once on the page');
});

test('R12.1 the line is plain HTML: app.js does not know it, and the Content Security Policy is unchanged', () => {
  assert.doesNotMatch(read('site/app.js'), /evidence/i);
  assert.equal(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(html)[1], CSP);
  assert.doesNotMatch(css, /#evidence[^{]*{[^}]*(animation|transition)\s*:/, 'the line does not animate');
});

test('R12.1 the line keeps text contrast: it uses only colors that are tokens of the style sheet', () => {
  const rule = /(^|\n)\.evidence\s*{([^}]*)}/.exec(css);
  assert.ok(rule, 'style.css has an .evidence rule');
  const colors = [...rule[2].matchAll(/(?:^|[;\s])(?:color|background(?:-color)?|border(?:-left)?)\s*:[^;]*/g)].map((m) => m[0]);
  assert.doesNotMatch(colors.join(';'), /#[0-9a-f]{3,8}\b|rgba?\(/i, 'colors come from var(--token)');
});

test('R12.1 with scripts off the line is on screen, between the strip and the banner', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844, mobile: true }]) {
      const m = await browser.measure({ ...size, scripts: false, settle: false }, () => {
        const box = (id) => {
          const e = document.getElementById(id);
          const b = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height, display: s.display, visibility: s.visibility };
        };
        const link = document.querySelector('#evidence a');
        return { strip: box('strip'), evidence: box('evidence'), text: document.getElementById('evidence').innerText.replace(/\s+/g, ' ').trim(), href: link && link.href };
      });
      const at = `at ${size.width}`;
      assert.match(m.text, /11 of 11/, at);
      assert.match(m.text, /0 of 19/, at);
      assert.equal(m.href, EXPERIMENT, at);
      assert.ok(m.evidence.width > 0 && m.evidence.height > 0 && m.evidence.display !== 'none' && m.evidence.visibility === 'visible', `${at}: the line is drawn`);
      assert.ok(m.evidence.top >= m.strip.bottom, `${at}: the line is drawn below the strip`);
    }
  });
});

test('R12.1 Requirement 9.5 (revised Nov 12) still holds with the result in place: the result is in the first screen at 1280x800 and 390x844, the banner at 1280x800, with no sideways scroll', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844, mobile: true }]) {
      const m = await browser.measure(size, () => {
        const b = (id) => document.getElementById(id).getBoundingClientRect();
        const e = b('evidence');
        const v = b('verdict');
        return {
          h: innerHeight,
          w: innerWidth,
          page: document.documentElement.scrollWidth,
          strip: { bottom: b('strip').bottom },
          evidence: { top: e.top, bottom: e.bottom, left: e.left, right: e.right, height: e.height },
          verdict: { top: v.top, bottom: v.bottom },
        };
      });
      const at = `at ${size.width}x${size.height}`;
      assert.ok(m.strip.bottom <= m.evidence.top, `${at}: the line is below the strip`);
      assert.ok(m.evidence.bottom <= m.verdict.top, `${at}: the line is above the banner`);
      assert.ok(m.evidence.top >= 0 && m.evidence.bottom <= m.h && m.evidence.left >= 0 && m.evidence.right <= m.w, `${at}: the line is inside the first screen`);
      if (size.width > 800) assert.ok(m.verdict.bottom <= m.h, `${at}: the banner ends at ${Math.round(m.verdict.bottom)} of ${m.h}`);
      assert.ok(m.page <= m.w, `${at}: the page scrolls sideways`);
    }
  });
});

test('R12.1 the frozen above-fold-v2 contract file is untouched', () => {
  const lock = JSON.parse(read('.necro/lock.json'));
  const pinned = lock.specs['receipt-viewer'].contracts.find((c) => c.path === 'contracts/receipt-viewer/above-fold-v2.contract.test.js');
  assert.ok(pinned, 'the lock lists above-fold-v2');
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL(pinned.path, root))).digest('hex'), pinned.sha256);
});

// ---- R12.2 ----

// The sentences of the visible page text: tags and the head are dropped, and the text is split after . ! or ?
function sentences() {
  const body = html.slice(html.indexOf('<body'), html.indexOf('<script'));
  return body
    .replace(/<(code)[^>]*>([\s\S]*?)<\/\1>/g, (_, _t, inner) => inner.replace(/\./g, '\u0000'))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\u0000/g, '.').trim())
    .filter(Boolean);
}

test('R12.2 no sentence on the page says that contracts re-run only in Node', () => {
  for (const s of sentences()) {
    assert.doesNotMatch(s, /\bcontracts?\b[^.]*\bre-?run\w*\s+(only\s+)?in\s+Node\b/i, `"${s}"`);
    assert.doesNotMatch(s, /\bonly\b[^.]*\bin\s+Node\b|\bin\s+Node\b[^.]*\bonly\b|\bNode\s+only\b/i, `"${s}"`);
  }
  assert.doesNotMatch(read('site/lib/samples.js'), /re-?run\w* in Node/i);
});

test('R12.2 the page says that necro verify re-runs JavaScript contracts and runner contracts such as pytest alike', () => {
  const found = sentences().filter((s) => /necro verify/.test(s) && /JavaScript contracts/.test(s) && /runner contracts/.test(s));
  assert.equal(found.length, 1, 'one sentence says it');
  assert.match(found[0], /re-runs/);
  assert.match(found[0], /\bpytest\b/);
  assert.match(found[0], /\balike\b/);
  assert.doesNotMatch(found[0], /[\u2013\u2014]/);
});

test('R12.2 the honest limit stays: the receipt card checks hashes, not test runs, and the play runs seven contracts in the browser, after the receipt', () => {
  const at = html.indexOf('id="about"');
  const about = html.slice(html.lastIndexOf('<section', at), html.indexOf('</section>', at));
  assert.match(textOf(about), /The receipt card checks hashes, not test runs, and the play above runs seven of the example's contracts in your browser\./);
  assert.ok(at > idAt('receipt'));
});
