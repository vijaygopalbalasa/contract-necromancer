import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Requirement 17: the real Kiro session in the header. Text checks on site/index.html and site/style.css, no pixel sizes.

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('site/index.html', root), 'utf8');
const css = fs.readFileSync(new URL('site/style.css', root), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const webp = fs.readFileSync(new URL('site/kiro-session-nov8.webp', root));

const QUOTE = "I couldn't mark task 4 complete. A hook blocked the edit to tasks.md and reported failing contracts, so the checkbox is still [ ].";
const LABEL = 'Real Kiro session, recorded Nov 8, not a simulation.';
const figure = /<figure\b[^>]*>[\s\S]*?<\/figure>/.exec(html);

test('R17.1 the page has one figure, inside the header, after the 14.1 line and before the real-use line', () => {
  assert.equal((html.match(/<figure\b/g) || []).length, 1);
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.ok(header.includes(figure[0]), 'inside the header');
  assert.ok(html.indexOf('id="idea"') < html.indexOf('<figure'));
  assert.ok(html.indexOf('</figure>') < html.indexOf('id="real-use"'));
  assert.ok(html.indexOf('</header>') < html.indexOf('id="real-use"'));
});

test('R17.1 the caption is the quote in quotation marks and then the label, with no link', () => {
  const cap = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/.exec(figure[0]);
  assert.ok(cap, 'a figcaption');
  const text = cap[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(text, `"${QUOTE}" ${LABEL}`);
  assert.doesNotMatch(figure[0], /<(a|button|video|script)\b|[\u2013\u2014]/);
});

test('R17.2 the one img has an alt equal to the quote and a data URL that decodes to the screenshot file', () => {
  const imgs = figure[0].match(/<img\b[^>]*>/g) || [];
  assert.equal(imgs.length, 1);
  assert.equal((html.match(/<img\b/g) || []).length, 1);
  const alt = /\salt="([^"]*)"/.exec(imgs[0])[1];
  assert.equal(alt, QUOTE);
  const src = /\ssrc="([^"]*)"/.exec(imgs[0])[1];
  const prefix = 'data:image/webp;base64,';
  assert.ok(src.startsWith(prefix));
  assert.ok(Buffer.from(src.slice(prefix.length), 'base64').equals(webp));
  assert.match(imgs[0], /\swidth="765"/);
  assert.match(imgs[0], /\sheight="128"/);
});

test('R17.2 the img is not drawn below 52rem and is drawn with a 36rem limit from 52rem up', () => {
  assert.match(css, /figure\.session img\s*\{[^}]*display:\s*none/);
  const media = /@media \(min-width:\s*52rem\)\s*\{\s*figure\.session img\s*\{([^}]*)\}/.exec(css);
  assert.ok(media, 'a min-width 52rem rule for the img');
  assert.match(media[1], /display:\s*block/);
  assert.match(media[1], /max-width:\s*36rem/);
});

test('R17.3 the caption is shown at every width and nothing around the figure animates or transitions', () => {
  const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter((m) => /session/.test(m[1]));
  assert.ok(rules.length > 0);
  for (const [, sel, body] of rules) {
    assert.doesNotMatch(body, /animation|transition|sr-only|clip|visibility:\s*hidden|opacity:\s*0/, sel);
    if (/figcaption|session-label/.test(sel)) assert.doesNotMatch(body, /display:\s*none/, sel);
  }
  assert.match(css, /figure\.session figcaption\s*\{[^}]*font-size:\s*13px/);
  assert.doesNotMatch(/<figure\b[^>]*>/.exec(html)[0], /class="[^"]*sr-only/);
});
