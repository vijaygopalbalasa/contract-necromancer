import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { SAMPLES, chooseInitialView, scrollOptions } from '../site/lib/samples.js';
import { parseReceipt, summarize, verdict } from '../site/lib/receipt.js';
import { computeReceiptHash } from '../site/lib/canon.js';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const bytes = (p) => fs.readFileSync(new URL(p, root));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const html = read('site/index.html');

// ---- the two samples ----

test('there are two samples, risen first, each with a label and a note that says it is a sample', () => {
  assert.deepEqual(SAMPLES.map((s) => s.id), ['risen', 'buried']);
  const app = read('site/app.js');
  assert.match(app, /risen: '\.\/sample-receipt\.json'/);
  assert.match(app, /buried: '\.\/sample-buried\.json'/);
  for (const s of SAMPLES) assert.ok(fs.existsSync(new URL(`site/sample-${s.id === 'risen' ? 'receipt' : 'buried'}.json`, root)));
  for (const s of SAMPLES) {
    assert.match(s.label, /sample/i);
    assert.match(s.note, /\bsample\b/i);
  }
  assert.notEqual(SAMPLES[0].note, SAMPLES[1].note);
});

test('index.html has one button per sample with the sample label, and the page can reach both without scrolling a hidden row', () => {
  const first = /<button[^>]*id="sample"[^>]*>([^<]*)<\/button>/.exec(html);
  const second = /<button[^>]*id="sample-buried"[^>]*>([^<]*)<\/button>/.exec(html);
  assert.ok(first && second, 'two sample buttons');
  assert.equal(first[1].trim(), SAMPLES[0].label);
  assert.equal(second[1].trim(), SAMPLES[1].label);
  assert.doesNotMatch(/<[^>]*id="sample-row"[^>]*>/.exec(html)[0], /\bhidden\b/, 'the sample row is visible from the start');
  assert.match(html, /<p[^>]*id="sample-note"/);
});

test('the first button whose label has "sample" is the risen one and the first with "show" is Show receipt', () => {
  const buttons = [...html.matchAll(/<button[^>]*id="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map((m) => ({ id: m[1], label: m[2].trim() }));
  assert.equal(buttons.find((b) => /sample/i.test(b.label)).id, 'sample');
  assert.equal(buttons.find((b) => /show/i.test(b.label)).id, 'show');
});

test('the banner comes before the receipt list in index.html', () => {
  assert.ok(html.indexOf('id="verdict"') > 0);
  assert.ok(html.indexOf('id="verdict"') < html.indexOf('id="receipt"'));
  assert.ok(html.indexOf('id="sample-note"') < html.indexOf('id="verdict"'), 'the note says "sample" before the banner');
});

test('the risen sample is a receipt where every required contract passes', () => {
  const parsed = parseReceipt(read('site/sample-receipt.json'));
  assert.equal(parsed.ok, true, parsed.message);
  const v = verdict(summarize(parsed.receipt).contracts);
  assert.equal(v.risen, true);
  assert.ok(v.living > 0);
});

test('sample-buried.json is a real necro check receipt for pumpkin-ledger with the README rounding bug planted', async () => {
  const parsed = parseReceipt(read('site/sample-buried.json'));
  assert.equal(parsed.ok, true, parsed.message);
  const r = parsed.receipt;

  assert.equal(await computeReceiptHash(r), r.receiptHash, 'not edited by hand');
  assert.equal(r.spec, 'ledger');
  assert.equal(r.gitCommit, null, 'written in a scratch copy outside git');
  assert.equal(r.task, null, 'necro check writes task null');
  assert.deepEqual([...r.required].sort(), r.contracts.map((c) => c.name).sort(), 'necro check requires every contract');

  const s = summarize(r);
  const v = verdict(s.contracts);
  assert.equal(v.risen, false);
  assert.equal(v.buried, s.failed);
  assert.ok(s.passed > 0, 'a buried receipt still has living contracts');
  // The README says the bug breaks R2.1, R2.2, R3.1, R4.1, R4.2 and R5.1 to R5.4.
  const failing = s.contracts.filter((c) => c.result === 'fail').map((c) => c.name.split(' ')[0]).sort();
  assert.deepEqual(failing, ['R2.1', 'R2.2', 'R3.1', 'R4.1', 'R4.2', 'R5.1', 'R5.2', 'R5.3', 'R5.4']);

  // It pins the files of examples/pumpkin-ledger, and only src/split.js differs, by exactly the planted bug.
  const ex = 'examples/pumpkin-ledger/';
  assert.equal(r.requirements.sha256, sha(bytes(ex + r.requirements.path)));
  for (const c of r.contracts) assert.equal(c.sha256, sha(bytes(ex + c.path)), c.path);
  const planted = read(ex + 'src/split.js')
    .replace('Math.floor(cents / n)', 'Math.round(cents / n)')
    .replace('const extra = cents % n;', 'const extra = 0;');
  assert.notEqual(planted, read(ex + 'src/split.js'));
  for (const src of r.sources) {
    const expected = src.path === 'src/split.js' ? sha(planted) : sha(bytes(ex + src.path));
    assert.equal(src.sha256, expected, src.path);
  }
  assert.ok(r.sources.some((x) => x.path === 'src/split.js'));
});

// ---- what to show on load ----

const url = { ok: true, url: 'https://raw.githubusercontent.com/o/n/main/r.json', repo: 'o/n' };

test('no ?receipt= and nothing pasted: show the risen sample', () => {
  assert.deepEqual(chooseInitialView({ requested: null, pasted: '' }), { action: 'sample', sample: 'risen' });
  assert.deepEqual(chooseInitialView({ requested: null, pasted: '  \n ' }), { action: 'sample', sample: 'risen' });
  assert.deepEqual(chooseInitialView({ requested: null }), { action: 'sample', sample: 'risen' });
});

test('a ?receipt= link wins over everything, and a bad one shows its message and no sample', () => {
  assert.deepEqual(chooseInitialView({ requested: url, pasted: '' }), { action: 'url', url: url.url, repo: 'o/n' });
  assert.deepEqual(chooseInitialView({ requested: url, pasted: '{"a":1}' }), { action: 'url', url: url.url, repo: 'o/n' });
  assert.deepEqual(chooseInitialView({ requested: { ok: false, message: 'Nope.' }, pasted: '' }), { action: 'error', message: 'Nope.' });
});

test('something already pasted (for example a form the browser restored) is left alone', () => {
  assert.deepEqual(chooseInitialView({ requested: null, pasted: '{"spec":"x"}' }), { action: 'none' });
});

// ---- scrolling the banner into view ----

test('scrollOptions animates only when the visitor has not asked for less motion', () => {
  assert.deepEqual(scrollOptions({ reducedMotion: false }), { behavior: 'smooth', block: 'start' });
  assert.deepEqual(scrollOptions({ reducedMotion: true }), { behavior: 'auto', block: 'start' });
  assert.deepEqual(scrollOptions({}), { behavior: 'auto', block: 'start' }, 'unknown preference means no animation');
});
