import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  PLAY_DIR,
  RISEN_RECEIPT,
  PLANTED_CHANGE,
  copyPath,
  copyUrl,
  playPins,
  applyPlanted,
  changeOneByte,
  mismatchLine,
  checkPlayFiles,
} from '../site/lib/play.js';
import { parseReceipt } from '../site/lib/receipt.js';
import { computeReceiptHash } from '../site/lib/canon.js';

const root = new URL('../', import.meta.url);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const disk = (p) => fs.readFileSync(new URL(p, root));
const SPLIT = 'src/split.js';

const buried = JSON.parse(disk('site/sample-buried.json').toString('utf8'));
const risen = () => JSON.parse(disk(`site/${PLAY_DIR}/${RISEN_RECEIPT}`).toString('utf8'));

// A fetch that serves the copies from site/play/ on disk and records what it was asked for.
function serve({ missing = [], override = {} } = {}) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), options });
    const text = String(url);
    const prefix = `./${PLAY_DIR}/`;
    if (!text.startsWith(prefix)) return new Response('Not Found', { status: 404 });
    const rel = text.slice(prefix.length);
    if (missing.includes(rel)) return new Response('Not Found', { status: 404 });
    if (rel in override) return new Response(override[rel], { status: 200 });
    const file = new URL(`site/${PLAY_DIR}/${rel}`, root);
    if (!fs.existsSync(file)) return new Response('Not Found', { status: 404 });
    return new Response(fs.readFileSync(file), { status: 200 });
  };
  return { fetchFn, calls };
}

// ---- the path map ----

test('copyPath drops the leading dot of a folder and leaves other paths as they are', () => {
  assert.equal(copyPath('.kiro/specs/ledger/requirements.md'), 'kiro/specs/ledger/requirements.md');
  assert.equal(copyPath('src/split.js'), 'src/split.js');
  assert.equal(copyPath('contracts/ledger/properties.contract.test.js'), 'contracts/ledger/properties.contract.test.js');
  assert.equal(copyPath('test/gen.js'), 'test/gen.js');
});

test('copyUrl puts the copy under the play folder of the base, one encoded segment at a time', () => {
  assert.equal(copyUrl('.kiro/specs/ledger/requirements.md'), './play/kiro/specs/ledger/requirements.md');
  assert.equal(copyUrl('src/split.js', 'https://example.org/site/'), 'https://example.org/site/play/src/split.js');
  assert.equal(copyUrl('src/a b.js'), './play/src/a%20b.js');
});

test('no pinned path of either receipt maps to a copy path with a segment that starts with a dot, and no two map to one', () => {
  const paths = [...playPins(buried), ...playPins(risen())].map((p) => p.path);
  const copies = new Map();
  for (const p of paths) {
    const c = copyPath(p);
    assert.ok(c.split('/').every((s) => !s.startsWith('.')), `${p} maps to ${c}`);
    if (copies.has(c)) assert.equal(copies.get(c), p, `${c} is the copy of two different paths`);
    copies.set(c, p);
  }
});

// ---- the risen receipt ----

test('the risen receipt is for task 4, every contract passes and its receipt hash recomputes', async () => {
  const text = disk(`site/${PLAY_DIR}/${RISEN_RECEIPT}`).toString('utf8');
  const parsed = parseReceipt(text);
  assert.equal(parsed.ok, true, parsed.message);
  const r = parsed.receipt;
  assert.equal(r.spec, 'ledger');
  assert.equal(r.task && r.task.id, '4');
  assert.equal(r.contracts.length, 18);
  assert.ok(r.contracts.every((c) => c.result === 'pass'), 'every contract passes');
  assert.equal(await computeReceiptHash(r), r.receiptHash);
});

test('playPins lists requirements, contract files, sources, runners and locked files once per path and hash', () => {
  const r = risen();
  const pins = playPins(r);
  const keys = pins.map((p) => `${p.path}\0${p.sha256}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(pins.some((p) => p.path === r.requirements.path));
  for (const c of r.contracts) assert.ok(pins.some((p) => p.path === c.path && p.sha256 === c.sha256));
  for (const s of r.sources || []) assert.ok(pins.some((p) => p.path === s.path && p.sha256 === s.sha256));
  if (r.runners) assert.ok(pins.some((p) => p.path === r.runners.path));
  for (const f of r.frozen || []) assert.ok(pins.some((p) => p.path === f.path));
});

test('every pin of the risen receipt matches its copy, fetched from the page origin only', async () => {
  const { fetchFn, calls } = serve();
  const result = await checkPlayFiles({ receipt: risen(), fetchFn });
  assert.equal(result.ok, true);
  assert.ok(result.files.length >= 8);
  assert.deepEqual(result.files.filter((f) => f.status !== 'match'), []);
  assert.equal(mismatchLine(result), null);
  assert.ok(calls.every((c) => c.url.startsWith('./play/')), 'only files under ./play/ are requested');
  assert.equal(new Set(calls.map((c) => c.url)).size, calls.length, 'each file once');
});

// ---- the buried sample and the planted change ----

test('the planted change turns the copied src/split.js into the bytes the buried sample pins', () => {
  const copy = disk(`site/${PLAY_DIR}/${copyPath(SPLIT)}`).toString('utf8');
  const planted = applyPlanted(copy);
  assert.notEqual(planted, copy);
  assert.equal(sha(Buffer.from(planted, 'utf8')), buried.sources.find((s) => s.path === SPLIT).sha256);
  assert.deepEqual(PLANTED_CHANGE, [
    ['Math.floor(cents / n)', 'Math.round(cents / n)'],
    ['const extra = cents % n;', 'const extra = 0;'],
  ]);
});

test('applyPlanted refuses text that does not hold the code it changes', () => {
  assert.throws(() => applyPlanted('export const x = 1;\n'), /split\.js/);
  assert.throws(() => applyPlanted('Math.floor(cents / n)\n'), /split\.js/);
});

test('every pin of the buried sample matches its copy except src/split.js, which matches with the planted change', async () => {
  const { fetchFn } = serve();
  const plain = await checkPlayFiles({ receipt: buried, fetchFn });
  assert.equal(plain.ok, true);
  assert.deepEqual(plain.files.filter((f) => f.status !== 'match').map((f) => [f.path, f.status]), [[SPLIT, 'different']]);
  assert.equal(mismatchLine(plain), 'MISMATCH. Files changed: src/split.js.');

  const planted = await checkPlayFiles({
    receipt: buried,
    fetchFn,
    change: { [SPLIT]: (bytes) => new TextEncoder().encode(applyPlanted(new TextDecoder().decode(bytes))) },
  });
  assert.deepEqual(planted.files.filter((f) => f.status !== 'match'), []);
  assert.equal(mismatchLine(planted), null);
});

// ---- one byte ----

test('one byte changed in src/split.js gives exactly the line necro verify prints', async () => {
  const original = disk(`site/${PLAY_DIR}/${copyPath(SPLIT)}`);
  const changed = changeOneByte(new Uint8Array(original));
  assert.equal(changed.length, original.length);
  let differing = 0;
  for (let i = 0; i < changed.length; i++) if (changed[i] !== original[i]) differing++;
  assert.equal(differing, 1);

  const { fetchFn } = serve();
  const result = await checkPlayFiles({ receipt: risen(), fetchFn, change: { [SPLIT]: changeOneByte } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.files.filter((f) => f.status !== 'match').map((f) => [f.path, f.status]), [[SPLIT, 'different']]);
  assert.equal(mismatchLine(result), 'MISMATCH. Files changed: src/split.js.');
});

test('mismatchLine lists changed paths sorted and joined with a comma and a space', () => {
  const files = [
    { path: 'src/split.js', status: 'different' },
    { path: 'src/balances.js', status: 'different' },
    { path: 'src/money.js', status: 'match' },
  ];
  assert.equal(mismatchLine({ ok: true, files }), 'MISMATCH. Files changed: src/balances.js, src/split.js.');
  assert.equal(mismatchLine({ ok: true, files: [] }), null);
});

// ---- failures are not accusations ----

test('a copy that cannot be fetched is unavailable, not different, and gives no MISMATCH line', async () => {
  const { fetchFn } = serve({ missing: [copyPath(SPLIT)] });
  const result = await checkPlayFiles({ receipt: risen(), fetchFn });
  assert.equal(result.ok, true);
  assert.deepEqual(result.files.filter((f) => f.status !== 'match').map((f) => [f.path, f.status]), [[SPLIT, 'unavailable']]);
  assert.equal(mismatchLine(result), null);
});

test('a fetch that throws is unavailable', async () => {
  const result = await checkPlayFiles({ receipt: risen(), fetchFn: async () => { throw new TypeError('offline'); } });
  assert.equal(result.ok, true);
  assert.ok(result.files.every((f) => f.status === 'unavailable'));
});

test('a pinned path that is not safe is never requested', async () => {
  const r = risen();
  r.sources = [...r.sources, { path: '../secret', sha256: 'a'.repeat(64) }];
  const { fetchFn, calls } = serve();
  const result = await checkPlayFiles({ receipt: r, fetchFn });
  assert.equal(result.files.find((f) => f.path === '../secret').status, 'unavailable');
  assert.ok(!calls.some((c) => c.url.includes('secret')));
});

// ---- the copies ----

test('every file either receipt pins has a copy under site/play/ that is byte for byte the file in examples/pumpkin-ledger', () => {
  const paths = new Set([...playPins(buried), ...playPins(risen())].map((p) => p.path));
  assert.ok(paths.size >= 14);
  for (const p of paths) {
    const copy = new URL(`site/${PLAY_DIR}/${copyPath(p)}`, root);
    assert.ok(fs.existsSync(copy), `no copy of ${p}`);
    assert.ok(disk(`examples/pumpkin-ledger/${p}`).equals(fs.readFileSync(copy)), `${p} differs from its copy`);
  }
});
