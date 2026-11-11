// Contracts for R13.1 and R13.4 of the receipt-viewer spec: the files the play serves, and the one-byte check.
//
// R13.1 reads the files under site/play/ and examples/pumpkin-ledger as bytes and hashes them with node:crypto. It does not
// use the page's code to decide what the receipts pin: it lists the pins itself. It uses site/lib/play.js only for the map
// from a pinned path to its copy, and checks on disk that no copy path has a segment that starts with a dot.
//
// R13.4 works in a scratch copy of the example, changes one byte of src/split.js, runs the real `necro verify` on the
// risen receipt, and compares its MISMATCH line with the line site/lib/play.js gives for the same change.
//
// The module under test is loaded with a dynamic import so this file always loads and the contract names are always
// registered. Dynamic imports are not followed by necro's import tracing, so the modules are also named below the way a
// static import would name them. Keep these lines: the receipt pins files it finds this way.
//   import {} from '../../site/lib/play.js';
//   import {} from '../../site/lib/canon.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const PLAY_URL = new URL('../../site/lib/play.js', import.meta.url);
const CANON_URL = new URL('../../site/lib/canon.js', import.meta.url);
const EXAMPLE = path.join(ROOT, 'examples', 'pumpkin-ledger');
const PLAY_DIR = path.join(ROOT, 'site', 'play');
const RISEN_FILE = path.join(PLAY_DIR, 'risen-receipt.json');
const BURIED_FILE = path.join(ROOT, 'site', 'sample-buried.json');
const SPLIT = 'src/split.js';
const PLANTED = [
  ['Math.floor(cents / n)', 'Math.round(cents / n)'],
  ['const extra = cents % n;', 'const extra = 0;'],
];

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Every file a ledger receipt pins, as `necro verify` counts them.
function pins(receipt) {
  const out = [{ path: receipt.requirements.path, sha256: receipt.requirements.sha256 }];
  for (const c of receipt.contracts) out.push({ path: c.path, sha256: c.sha256 });
  for (const s of receipt.sources || []) out.push({ path: s.path, sha256: s.sha256 });
  if (receipt.runners) out.push({ path: receipt.runners.path, sha256: receipt.runners.sha256 });
  for (const f of receipt.frozen || []) out.push({ path: f.path, sha256: f.sha256 });
  return out;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

test('R13.1 site/play holds byte for byte copies of every file the risen and buried ledger receipts pin, the risen receipt is the gate\'s for task 4, and every pin matches the copies (the buried split.js with the planted change)', async () => {
  const { copyPath } = await import(PLAY_URL.href);
  const { computeReceiptHash } = await import(CANON_URL.href);

  assert.ok(fs.existsSync(RISEN_FILE), 'site/play/risen-receipt.json is missing; copy the receipt that `node bin/necro.js demo` prints');
  const risen = readJson(RISEN_FILE);
  const buried = readJson(BURIED_FILE);

  // The risen receipt is one the gate wrote when it accepted task 4 of the ledger: every contract passes, the task is 4,
  // and its hash is the hash of its content (it was not edited by hand).
  assert.equal(risen.spec, 'ledger');
  assert.equal(risen.task && risen.task.id, '4', 'the risen receipt must be for task 4');
  assert.equal(risen.contracts.length, 18);
  assert.deepEqual(risen.contracts.filter((c) => c.result !== 'pass').map((c) => c.name), [], 'every contract of the risen receipt passes');
  assert.equal(await computeReceiptHash(risen), risen.receiptHash, 'the risen receipt hash must recompute');
  assert.equal(buried.spec, 'ledger');

  // Every file either receipt pins has a copy that is byte for byte the example's file, at a path with no dotted segment.
  const all = new Map();
  for (const p of [...pins(risen), ...pins(buried)]) all.set(p.path, true);
  assert.ok(all.size >= 14, `expected at least 14 pinned files, found ${all.size}`);
  const copies = new Set();
  for (const p of all.keys()) {
    const copy = copyPath(p);
    assert.ok(copy.split('/').every((s) => s !== '' && !s.startsWith('.')), `the copy path ${copy} has a segment that starts with a dot`);
    assert.ok(!copies.has(copy), `two pinned paths map to ${copy}`);
    copies.add(copy);
    const copyFile = path.join(PLAY_DIR, ...copy.split('/'));
    assert.ok(fs.existsSync(copyFile), `there is no copy of ${p} at site/play/${copy}`);
    assert.ok(fs.readFileSync(path.join(EXAMPLE, ...p.split('/'))).equals(fs.readFileSync(copyFile)), `site/play/${copy} is not byte for byte examples/pumpkin-ledger/${p}`);
  }
  assert.deepEqual(
    listFiles(PLAY_DIR).filter((f) => f !== 'risen-receipt.json' && !copies.has(f)),
    [],
    'site/play holds a file that neither receipt pins',
  );
  assert.ok(listFiles(PLAY_DIR).every((f) => f.split('/').every((s) => !s.startsWith('.'))), 'no path under site/play may have a segment that starts with a dot');

  // Every pin of the risen receipt matches its copy.
  for (const p of pins(risen)) {
    assert.equal(sha(fs.readFileSync(path.join(PLAY_DIR, ...copyPath(p.path).split('/')))), p.sha256, `the copy of ${p.path} does not match the risen receipt`);
  }

  // Every pin of the buried sample matches its copy, except src/split.js, which matches with the planted change applied.
  for (const p of pins(buried)) {
    const bytes = fs.readFileSync(path.join(PLAY_DIR, ...copyPath(p.path).split('/')));
    if (p.path === SPLIT) {
      assert.notEqual(sha(bytes), p.sha256, 'the copy of src/split.js is the fixed code, so it must not match the buried pin as it is');
      let text = bytes.toString('utf8');
      for (const [from, to] of PLANTED) {
        assert.ok(text.includes(from), `src/split.js has no "${from}" to change`);
        text = text.replace(from, () => to);
      }
      assert.equal(sha(Buffer.from(text, 'utf8')), p.sha256, 'the copy of src/split.js with the planted change must match the buried pin');
    } else {
      assert.equal(sha(bytes), p.sha256, `the copy of ${p.path} does not match the buried sample`);
    }
  }

  // The risen receipt is real, not a hand-made one with a recomputed hash: the real `necro verify` confirms it in a scratch
  // copy of the example. The environment has no NODE_TEST_ variables, as in R13.4.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-play-risen-'));
  try {
    fs.cpSync(EXAMPLE, scratch, { recursive: true });
    const receiptDir = path.join(scratch, '.necro', 'receipts', 'ledger');
    fs.mkdirSync(receiptDir, { recursive: true });
    const receiptFile = path.join(receiptDir, `${risen.receiptHash}.json`);
    fs.copyFileSync(RISEN_FILE, receiptFile);
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
    const run = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'necro.js'), 'verify', receiptFile], { cwd: scratch, encoding: 'utf8', env, timeout: 120_000 });
    assert.equal(run.status, 0, `necro verify must exit 0 for the risen receipt. Output:\n${run.stdout}${run.stderr}`);
    assert.ok(
      run.stdout.split('\n').includes(`CONFIRMED ${risen.receiptHash}.`),
      `necro verify must print "CONFIRMED ${risen.receiptHash}." for the risen receipt. Output:\n${run.stdout}${run.stderr}`,
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('R13.4 one changed byte of src/split.js gives the line necro verify prints, and the page code gives the same line', async () => {
  const { copyPath, changeOneByte, checkPlayFiles, mismatchLine } = await import(PLAY_URL.href);
  const risen = readJson(RISEN_FILE);

  // The page code: re-hash the copies with one byte of src/split.js changed.
  const fetchFn = async (url) => {
    const text = String(url);
    assert.ok(text.startsWith('./play/'), `the check may only fetch from the page's own folder, it asked for ${text}`);
    const file = path.join(PLAY_DIR, ...decodeURIComponent(text.slice('./play/'.length)).split('/'));
    return fs.existsSync(file) ? new Response(fs.readFileSync(file), { status: 200 }) : new Response('Not Found', { status: 404 });
  };
  const result = await checkPlayFiles({ receipt: risen, fetchFn, change: { [SPLIT]: changeOneByte } });
  const pageLine = mismatchLine(result);
  assert.equal(pageLine, 'MISMATCH. Files changed: src/split.js.');
  assert.deepEqual(result.files.filter((f) => f.status !== 'match').map((f) => f.path), [SPLIT]);

  // necro verify, in a scratch copy of the example, with the same one byte changed.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-play-'));
  try {
    fs.cpSync(EXAMPLE, scratch, { recursive: true });
    const receiptDir = path.join(scratch, '.necro', 'receipts', 'ledger');
    fs.mkdirSync(receiptDir, { recursive: true });
    const receiptFile = path.join(receiptDir, `${risen.receiptHash}.json`);
    fs.copyFileSync(RISEN_FILE, receiptFile);
    const split = path.join(scratch, ...SPLIT.split('/'));
    assert.ok(fs.readFileSync(split).equals(fs.readFileSync(path.join(PLAY_DIR, ...copyPath(SPLIT).split('/')))), 'the scratch src/split.js must be the copy the page serves');
    fs.writeFileSync(split, changeOneByte(new Uint8Array(fs.readFileSync(split))));

    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
    const run = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'necro.js'), 'verify', receiptFile], { cwd: scratch, encoding: 'utf8', env, timeout: 120_000 });
    assert.equal(run.status, 1, `necro verify must exit 1 for a changed file. Output:\n${run.stdout}${run.stderr}`);
    const verifyLine = run.stdout.trim().split('\n').filter((l) => l.startsWith('MISMATCH')).join('\n');
    assert.equal(verifyLine, pageLine, 'the page must give the same MISMATCH line as necro verify');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
