import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Requirement 16.3 and 16.4: the real-use line after the header, and the size of the experiment in the result element.
// Text checks read site/index.html and site/style.css. No size or position is pinned.

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('site/index.html');
const css = read('site/style.css');

const PR = 'https://github.com/vijaygopalbalasa/judge-protocol/pull/29';
const STUDY = 'https://github.com/vijaygopalbalasa/contract-necromancer/tree/main/case-studies/judge-api-errors';
const textOf = (f) => f.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function element(id, tag) {
  const at = html.indexOf(`id="${id}"`);
  assert.ok(at >= 0, `no #${id}`);
  const start = html.lastIndexOf('<', at);
  assert.match(html.slice(start, at), new RegExp(`^<${tag}\\b`));
  const end = html.indexOf(`</${tag}>`, start) + tag.length + 3;
  return { start, end, text: html.slice(start, end), words: textOf(html.slice(start, end)) };
}

test('R16.3 p#real-use comes directly after the header and before the strip', () => {
  const line = element('real-use', 'p');
  const header = element('brand', 'header');
  assert.equal(html.slice(header.end, line.start).trim(), '', 'nothing between the header and the line');
  assert.ok(line.end < html.indexOf('id="strip"'));
  assert.match(line.text, /^<p class="real-use" id="real-use">/);
});

test('R16.3 the real-use line is plain text with two exact links, no dash, no necro verify', () => {
  const line = element('real-use', 'p');
  assert.doesNotMatch(line.text, /<(script|svg|img|button|input|h\d)\b|\bhidden\b|aria-hidden|\bon\w+=|data-/i);
  assert.doesNotMatch(line.text, /[\u2013\u2014]/);
  assert.doesNotMatch(line.words, /necro verify/);
  for (const w of ['judge-protocol', 'refused', 'first tick', 'half of a criterion', 'all six frozen contracts', 'merged', 'pull request #29']) {
    assert.ok(line.words.includes(w), `says ${w}`);
  }
  const links = [...line.text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ href: /href="([^"]*)"/.exec(m[1])?.[1], text: textOf(m[2]) }));
  assert.deepEqual(links.map((l) => l.href), [PR, STUDY]);
  assert.equal(links[0].text, 'pull request #29');
  assert.match(links[1].text, /case study/i);
});

test('R16.4 span.size sits inside #evidence between .result and .caveat with the words of experiments/README.md', () => {
  const [, a, b] = /(\d+) to (\d+) runs per cell/.exec(read('experiments/README.md'));
  const e = element('evidence', 'p');
  const result = e.text.indexOf('class="result"');
  const size = e.text.indexOf('<span class="size">');
  const caveat = e.text.indexOf('class="caveat"');
  assert.ok(result >= 0 && result < size && size < caveat, 'result, size, caveat in that order');
  const sizeText = textOf(/<span class="size">([\s\S]*?)<\/span>/.exec(e.text)[1]);
  assert.match(sizeText, new RegExp(`^Two models, ${a} to ${b} runs per cell`));
  assert.doesNotMatch(e.text, /[\u2013\u2014]/);
  assert.equal((e.text.match(/<a\b/g) || []).length, 1);
  for (const w of ['11 of 11', '0 of 19', 'one gated run of six']) assert.ok(e.words.includes(w));
  assert.match(e.words, /That hole is closed and the cheat is kept as a test/);
});

test('R16.3 style.css styles .real-use and .evidence .size, with the Kiroween colours', () => {
  assert.match(css, /\.real-use\s*\{/);
  assert.match(css, /\.evidence \.size\s*\{/);
  assert.doesNotMatch(css, /[\u2013\u2014]/);
});

test('the Content Security Policy and the one script are unchanged', () => {
  assert.ok(html.includes(`content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'"`));
  assert.equal((html.match(/<script\b/g) || []).length, 1);
});
