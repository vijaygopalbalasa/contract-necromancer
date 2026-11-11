// The play (Req 13): the ledger's files and receipts that the page serves from its own origin, and the pure checks on
// them. Nothing here runs a contract. The files under site/play/ are byte copies of examples/pumpkin-ledger; this module
// maps a pinned path to its copy, hashes the copy against the pin, applies the planted change, and words the result the
// way `necro verify` does.

import { sha256Hex } from './canon.js';
import { isSafeRepoPath } from './repo.js';

// The folder of copies, relative to the page, and the receipt the gate wrote when it accepted task 4.
export const PLAY_DIR = 'play';
export const RISEN_RECEIPT = 'risen-receipt.json';

// The change `necro demo` plants in src/split.js (src/demo.js): round each share, so cents are lost.
export const PLANTED_CHANGE = [
  ['Math.floor(cents / n)', 'Math.round(cents / n)'],
  ['const extra = cents % n;', 'const extra = 0;'],
];

// Where a pinned path lives under site/play/. GitHub Pages may leave out folders whose names start with a dot, so a
// leading dot is dropped from each segment: .kiro/specs/ledger/requirements.md is kiro/specs/ledger/requirements.md.
// This is the only place that maps pinned paths to copy paths.
export function copyPath(pinnedPath) {
  return pinnedPath
    .split('/')
    .map((segment) => segment.replace(/^\./, ''))
    .join('/');
}

// The address of a copy: the base (the page's own folder), the play folder, then the copy path with each segment encoded.
export function copyUrl(pinnedPath, base = './') {
  return `${base}${PLAY_DIR}/${copyPath(pinnedPath).split('/').map(encodeURIComponent).join('/')}`;
}

// Every file a ledger receipt pins, as `verify` counts them: requirements, contract files, sources, runners and locked
// files, once per (path, sha256).
export function playPins(receipt) {
  const out = [];
  const seen = new Set();
  const add = (path, sha256) => {
    const key = `${path}\0${sha256}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path, sha256 });
  };
  add(receipt.requirements.path, receipt.requirements.sha256);
  for (const c of receipt.contracts) add(c.path, c.sha256);
  for (const s of receipt.sources || []) add(s.path, s.sha256);
  if (receipt.runners) add(receipt.runners.path, receipt.runners.sha256);
  for (const f of receipt.frozen || []) add(f.path, f.sha256);
  return out;
}

// The text of src/split.js with the planted change applied. Throws when the code to change is not there, so a copy that
// is not the ledger's is never passed off as the planted version.
export function applyPlanted(text) {
  let out = text;
  for (const [from, to] of PLANTED_CHANGE) {
    if (!out.includes(from)) throw new Error(`The planted change does not fit this src/split.js: "${from}" is not in it.`);
    out = out.replace(from, () => to);
  }
  return out;
}

// A copy of the bytes with one byte changed: the low bit of the first byte is flipped. Same length, one byte differs.
export function changeOneByte(bytes) {
  const out = new Uint8Array(bytes);
  if (out.length > 0) out[0] ^= 1;
  return out;
}

// The line `necro verify` prints when pinned files changed, or null when none did. Files that could not be fetched are not
// changed files: the page did not look, so it says nothing against them.
export function mismatchLine(result) {
  const changed = result.files.filter((f) => f.status === 'different').map((f) => f.path);
  if (changed.length === 0) return null;
  return `MISMATCH. Files changed: ${[...new Set(changed)].sort().join(', ')}.`;
}

async function checkOne(pin, base, fetchFn, change) {
  const result = { path: pin.path, expected: pin.sha256 };
  if (!isSafeRepoPath(pin.path)) {
    return { ...result, status: 'unavailable', detail: 'The path in the receipt is not safe to fetch.' };
  }
  let bytes;
  try {
    const response = await fetchFn(copyUrl(pin.path, base), { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return { ...result, status: 'unavailable', detail: `The page could not load its copy of ${pin.path}.` };
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ...result, status: 'unavailable', detail: `The page could not load its copy of ${pin.path}.` };
  }
  if (change && typeof change[pin.path] === 'function') bytes = change[pin.path](bytes);
  const actual = await sha256Hex(bytes);
  return actual === pin.sha256 ? { ...result, status: 'match' } : { ...result, status: 'different', actual };
}

// checkPlayFiles({ receipt, fetchFn, base, change })
//   Fetches the copy of every file the receipt pins from the page's own folder, applies change[path](bytes) to a copy when
//   given (the planted change, or one changed byte), hashes the bytes and compares them with the pin.
//   → { ok: true, files: [{ path, expected, status: 'match' | 'different' | 'unavailable', actual?, detail? }] }
export async function checkPlayFiles({ receipt, fetchFn = globalThis.fetch, base = './', change = null }) {
  const files = await Promise.all(playPins(receipt).map((pin) => checkOne(pin, base, fetchFn, change)));
  return { ok: true, files };
}
