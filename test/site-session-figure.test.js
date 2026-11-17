import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Requirement 17: the real Kiro session in the header. Text checks on site/index.html and site/style.css, no pixel sizes.

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('site/index.html', root), 'utf8');
const css = fs.readFileSync(new URL('site/style.css', root), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const QUOTE = "I couldn't mark task 4 complete. A hook blocked the edit to tasks.md and reported failing contracts, so the checkbox is still [ ].";
const LABEL = 'Real Kiro session, recorded Nov 8, not a simulation.';
const HREF = 'https://github.com/vijaygopalbalasa/contract-necromancer/blob/main/.kiro/build-log/film/take6-refusal.webp';
const figure = /<figure\b[^>]*>[\s\S]*?<\/figure>/.exec(html);

test('R17.1 the page has one figure, inside the header, after the 14.1 line and before the real-use line', () => {
  assert.equal((html.match(/<figure\b/g) || []).length, 1);
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.ok(header.includes(figure[0]), 'inside the header');
  assert.ok(html.indexOf('id="idea"') < html.indexOf('<figure'));
  assert.ok(html.indexOf('</figure>') < html.indexOf('id="real-use"'));
  assert.ok(html.indexOf('</header>') < html.indexOf('id="real-use"'));
});

test('R17.1 the caption is the quoted words in one span, one space, and one link whose text is the label', () => {
  const cap = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/.exec(figure[0]);
  assert.ok(cap, 'a figcaption');
  const text = cap[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(text, `"${QUOTE}" ${LABEL}`);
  assert.match(cap[1].trim(), /^<span class="session-words">[^<]*<\/span> <a [^>]*>[^<]*<\/a>$/);
  const span = /<span class="session-words">([^<]*)<\/span>/.exec(cap[1]);
  assert.equal(span[1], `"${QUOTE}"`);
  assert.equal((figure[0].match(/<a\b/g) || []).length, 1);
  assert.doesNotMatch(figure[0], /<(button|video|script)\b|[\u2013\u2014]/);
});

test('R17.3 the label is the one link and goes to the evidence image', () => {
  const links = [...figure[0].matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)];
  assert.equal(links.length, 1);
  assert.equal(/\shref="([^"]*)"/.exec(links[0][1])[1], HREF);
  assert.match(links[0][1], /class="session-label"/);
  assert.equal(links[0][2], LABEL);
});

test('R17.2 the figure holds no picture and the page has no img', () => {
  assert.doesNotMatch(figure[0], /<(img|picture|svg|canvas)\b/i);
  assert.doesNotMatch(html, /<img\b/i);
});

test('R17.1 the quoted words are larger than the body only inside the 52rem query, and no img rule is left', () => {
  assert.doesNotMatch(css, /figure\.session img/);
  const media = /@media \(min-width:\s*52rem\)\s*\{([\s\S]*?\})\s*\}/.exec(css);
  assert.ok(media, 'a min-width 52rem query');
  const rule = /\.session-words\s*\{[^}]*font-size:\s*([\d.]+)rem/.exec(media[1]);
  assert.ok(rule && Number(rule[1]) > 1, 'a size above 1rem');
  const outside = css.replace(media[0], '');
  assert.doesNotMatch(outside, /\.session-words\s*\{[^}]*font-size/);
});

test('R17.2 the old screenshot file is gone and nothing in site/ names it', () => {
  assert.equal(fs.existsSync(new URL('site/kiro-session-nov8.webp', root)), false);
  for (const name of ['index.html', 'style.css', 'app.js', 'main.js']) {
    assert.doesNotMatch(fs.readFileSync(new URL(`site/${name}`, root), 'utf8'), /kiro-session-nov8/, name);
  }
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
