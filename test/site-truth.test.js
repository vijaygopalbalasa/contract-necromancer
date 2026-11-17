import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PLAY_CONTRACTS } from '../site/lib/play-loader.js';

// Task 34: the truth fixes on the page (Req 10.1, 10.2, 10.4, 11.2, 13.5, 14.1). Read as text.
const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('site/index.html');
const css = read('site/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const textOf = (h) => h.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

test('R10.2 step 3 says every passing task leaves a receipt you can re-run, with no "anyone"', () => {
  const how = html.slice(html.indexOf('id="how"'));
  const items = [...how.slice(how.indexOf('<ol'), how.indexOf('</ol>')).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
  assert.equal(items.length, 3);
  assert.equal(items[2], 'Every passing task leaves a receipt you can re-run.');
  assert.doesNotMatch(items.join(' '), /anyone/i);
});

test('R11.2 each beat is fully drawn within 500 ms under no-preference, and reduce still turns animation off', () => {
  const blocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*{([\s\S]*?)\n}\n/g)].map((m) => m[1]).join('\n');
  const ms = (v) => (/ms$/.test(v) ? parseFloat(v) : parseFloat(v) * 1000);
  const rules = [...blocks.matchAll(/(\.beat[^{,]*){([^}]*)}/g)];
  assert.ok(rules.length >= 3);
  const dur = ms(/animation:\s*rise\s+([\d.]+m?s)/.exec(rules.find((r) => r[1].trim() === '.beat')[2])[1]);
  const dm = /animation-duration:\s*([\d.]+m?s)/.exec(rules.map((r) => r[2]).join(';'));
  const duration = dm ? ms(dm[1]) : dur;
  const delay = (sel) => {
    const r = rules.find((x) => x[1].trim() === sel);
    const d = r && /animation-delay:\s*([\d.]+m?s)/.exec(r[2]);
    return d ? ms(d[1]) : 0;
  };
  for (const sel of ['.beat', '.beat:nth-child(2)', '.beat:nth-child(3)']) {
    assert.ok(delay(sel) + duration <= 500, `${sel}: delay ${delay(sel)} plus duration ${duration} is at most 500 ms`);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*{\s*\*,[\s\S]*?animation:\s*none !important/);
});

test('R10.4 the demo command is on one line in its own scrolling box, in both places', () => {
  assert.match(css, /\.demo\s*{[^}]*white-space:\s*pre;[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.try code\s*{[^}]*white-space:\s*nowrap;[^}]*overflow-x:\s*auto/);
  assert.match(css, /(^|\n)pre\s*{[^}]*white-space:\s*pre-wrap/);
});

test('R13.5 the sentence before the play steps carries the numbers of the sentence after a run', () => {
  const play = html.slice(html.indexOf('id="play"'));
  const at = play.indexOf('<ol class="play-steps">');
  const before = /<p class="play-before">([\s\S]*?)<\/p>\s*$/.exec(play.slice(0, at));
  assert.ok(before, 'a p.play-before stands directly before ol.play-steps');
  const text = textOf(before[1]);
  const m = /^The browser runs (\d+) of the ledger's (\d+) contracts, and the other (\d+) need the ledger's command line\.$/.exec(text);
  assert.ok(m, text);
  const total = JSON.parse(read('site/play/risen-receipt.json')).contracts.length;
  assert.equal(Number(m[1]), PLAY_CONTRACTS.length);
  assert.equal(Number(m[2]), total);
  assert.equal(Number(m[3]), total - PLAY_CONTRACTS.length);
  assert.doesNotMatch(text, /[\u2013\u2014\u2019]/);
  assert.match(text, /ledger's/);
});
