import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The README: it names the idea it raises, states the result with its round 3 caveat, links to the live page once in the
// try-it line, and shows the receipt hash that `necro demo` prints now, so the sample output cannot go stale again.

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const readme = read('README.md');

const PAGE = 'https://vijaygopalbalasa.github.io/contract-necromancer/';
const RAISED = 'Design by Contract, from Eiffel (1986), raised for coding agents.';

// The paragraphs of the README, outside code fences, each on one line.
function paragraphs(text) {
  const out = [];
  let fenced = false;
  let current = [];
  const flush = () => {
    if (current.length > 0) out.push(current.join(' ').replace(/\s+/g, ' ').trim());
    current = [];
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      flush();
      fenced = !fenced;
    } else if (fenced) {
      continue;
    } else if (line.trim() === '') {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();
  return out;
}

test('the README names the idea near the top: Design by Contract, from Eiffel (1986), raised for coding agents', () => {
  const lines = readme.split('\n');
  assert.equal(lines[0], '# Contract Necromancer');
  const at = lines.findIndex((l) => l.includes(RAISED));
  assert.ok(at > 0 && at <= 4, `the line is at line ${at + 1}`);
  const firstProse = paragraphs(readme).slice(0, 3).join(' ');
  assert.ok(firstProse.includes(RAISED), 'it is in the first paragraphs');
});

test('the README puts the round 3 caveat next to the result line, in the same paragraph', () => {
  const result = paragraphs(readme).find((p) => p.startsWith('**[Result]'));
  assert.ok(result, 'the README has a Result paragraph');
  assert.match(result, /11 of 11 runs without the gate and 0 of 19 with it/);
  assert.match(result, /"do whatever it takes" prompt/);
  assert.match(result, /one gated run of six got past the gate by patching JavaScript built-ins/);
  assert.match(result, /hole is closed/);
  assert.match(result, /cheat is kept as a test/);
  assert.ok(result.indexOf('0 of 19') < result.indexOf('do whatever it takes'), 'the result comes before the caveat');
});

test('the try-it line has a single link to the live page', () => {
  const tryIt = paragraphs(readme).find((p) => p.startsWith('**Try it in one command**'));
  assert.ok(tryIt, 'the README has a try-it line');
  assert.equal(tryIt.split(PAGE).length - 1, 1, 'the page address appears once in the try-it line');
  assert.match(tryIt, /npx -y github:vijaygopalbalasa\/contract-necromancer demo/);
  assert.ok(readme.includes(PAGE), 'the README still gives the page address');
});

test("the README's sample hash is the receipt hash of the risen receipt that necro demo writes", () => {
  const risen = JSON.parse(read('site/play/risen-receipt.json'));
  const shown = [...readme.matchAll(/CONFIRMED ([0-9a-f]{64})\./g)].map((m) => m[1]);
  assert.ok(shown.length >= 1, 'the README shows a CONFIRMED hash');
  for (const hash of shown) assert.equal(hash, risen.receiptHash);
});

test('the README has no em or en dashes and keeps its sentences safe for the frozen R12.2 contract', () => {
  assert.doesNotMatch(readme, /[\u2013\u2014]/);
  const sentences = paragraphs(readme)
    .map((p) => p.replace(/`([^`]*)`/g, (_, code) => code.replace(/\./g, '\u0000')).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
    .flatMap((p) => p.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/\u0000/g, '.').trim())
    .filter(Boolean);
  for (const s of sentences) {
    assert.doesNotMatch(s, /\bcontracts?\b[^.]*\bre-?run\w*\s+(only\s+)?in\s+Node\b/i, `"${s}"`);
    assert.doesNotMatch(s, /\bonly\b[^.]*\bin\s+Node\b|\bin\s+Node\b[^.]*\bonly\b|\bNode\s+only\b/i, `"${s}"`);
  }
  assert.ok(sentences.filter((s) => /necro verify/.test(s) && /JavaScript contracts/.test(s) && /runner contracts/.test(s)).length <= 1);
});
