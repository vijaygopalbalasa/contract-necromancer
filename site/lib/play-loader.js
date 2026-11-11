// The play's loader (Req 13.2, 13.3, 13.6, 13.8). It does three jobs and runs no ledger code itself.
//
//   1. Worker side. Fetch the ledger's copies from the page's own origin, check every one against the pin in the receipt for
//      the run, find every import in the checked text, refuse any it does not know, and only then build modules from the
//      checked text and the two stand-ins (blob URLs in the worker). runPlayContracts does this and runs the seven contracts.
//   2. Message side. parseRunMessage and handleMessage: the worker takes a run name and nothing else.
//   3. Page side. runPlay starts the worker, stops it after the time limit, and turns every way a run can end into a result
//      or one plain sentence, together with the gate's full run from the receipts. It never leaves a run pending.
//
// Everything with a side effect is injected (fetch, the blob maker, the importer, the Worker class, timers), so the same
// code runs under `node --test` and in the browser. The seven contracts are a fixed list here, never inferred from an error.

import { sha256Hex, computeReceiptHash } from './canon.js';
import { parseReceipt } from './receipt.js';
import { PLAY_DIR, RISEN_RECEIPT, applyPlanted, copyUrl, playPins } from './play.js';

// The two runs, and the time after which the page stops a run (Req 13.8).
export const PLAY_RUNS = ['planted', 'fixed'];
export const PLAY_TIMEOUT_MS = 10_000;

// The two ledger contract files the browser can run, in the order they run, and the files they load.
export const PLAY_CONTRACT_FILES = [
  'contracts/ledger/requirement-2-split.contract.test.js',
  'contracts/ledger/properties.contract.test.js',
];
export const PLAY_SOURCE_FILES = [
  'src/errors.js',
  'src/money.js',
  'src/parse.js',
  'src/split.js',
  'src/balances.js',
  'src/settle.js',
  'src/report.js',
  'test/gen.js',
];

// The seven contracts, in the order they report (Req 13.2, 13.5). The names are the ones the receipts list.
export const PLAY_CONTRACTS = [
  { id: 'R2.1', file: PLAY_CONTRACT_FILES[0], name: 'R2.1 gives each sharer the floor and the extra cents to the first names alphabetically' },
  { id: 'R2.2', file: PLAY_CONTRACT_FILES[0], name: 'R2.2 makes balances paid minus shares and sums them to exactly zero' },
  { id: 'R5.1', file: PLAY_CONTRACT_FILES[1], name: 'R5.1 shares of every expense sum to its amount and differ by at most one cent' },
  { id: 'R5.2', file: PLAY_CONTRACT_FILES[1], name: 'R5.2 balances are paid minus shares and sum to exactly zero' },
  { id: 'R5.3', file: PLAY_CONTRACT_FILES[1], name: 'R5.3 settling zeroes every balance with positive whole-cent payments, at most one fewer than people owing or owed' },
  { id: 'R5.4', file: PLAY_CONTRACT_FILES[1], name: 'R5.4 reading the same file twice, or its lines in another order, gives the same balances' },
  { id: 'R5.5', file: PLAY_CONTRACT_FILES[1], name: 'R5.5 a failing property reports the seed and the smallest failing party so it can be replayed' },
];

// The only module names a loaded file may import besides the other loaded files, and the stand-in file that answers each.
// This is the one place in site/ that names the Node modules.
export const STAND_INS = {
  'node:test': 'play-node-test.js',
  'node:assert/strict': 'play-node-assert.js',
};

const FETCH_OPTIONS = { credentials: 'omit', referrerPolicy: 'no-referrer' };
const FULL_RUN_TIMEOUT_MS = 3000;

// Keywords as data, so that no line of this file reads like an import of its own (the site scan looks at quote placement).
// IMPORT is also the name of the error kind for a refused import.
const [FROM, IMPORT, EXPORT] = 'from import export'.split(' ');

// ---- errors and sentences ----

// An error the play can say in one plain sentence. `kind` says what happened: request (a bad message), fetch (a file or
// receipt could not be loaded), hash (a hash did not match, or the planted change did not fit), import (an import the
// play does not know), run (the contracts could not be run).
export class PlayError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'PlayError';
    this.kind = kind;
  }
}

// Text from outside (a path, an import, an error message) made safe to put inside a sentence: one line, short.
function clip(value, max = 80) {
  const text = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// A message as one sentence: one line, ending with a full stop.
function oneSentence(message, fallback) {
  const text = clip(typeof message === 'string' ? message : '', 300);
  if (text === '') return fallback;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

// ---- reading imports ----

// Words after which a slash starts a regular expression and not a division.
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'delete', 'void', 'in', 'of', 'instanceof', 'new', 'do', 'else', 'yield', 'await', 'throw']);
const isIdStart = (c) => /[\p{ID_Start}$_]/u.test(c);
const isIdPart = (c) => /[\p{ID_Continue}$\u200c\u200d]/u.test(c);

// Split source text into the tokens that matter for finding imports: words, strings, template starts, regular expressions
// and single punctuation characters. Comments and white space are skipped. Strings, templates and regular expressions are
// each one token, so nothing inside them is read as code. The text of a template substitution is scanned as code.
function tokenize(text) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  if (text.startsWith('#!')) while (i < n && text[i] !== '\n') i += 1;

  function regexAllowed(prev) {
    if (!prev) return true;
    if (prev.type === 'punct') return prev.value !== ')' && prev.value !== ']';
    if (prev.type === 'word') return REGEX_AFTER_WORD.has(prev.value);
    return false;
  }

  function template() {
    tokens.push({ type: 'template', value: '`', start: i, end: i + 1 });
    i += 1;
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
      } else if (c === '`') {
        i += 1;
        return;
      } else if (c === '$' && text[i + 1] === '{') {
        i += 2;
        code(true);
      } else {
        i += 1;
      }
    }
  }

  // Scan code. With `nested`, stop after the brace that closes a template substitution.
  function code(nested) {
    let depth = 0;
    let prev = null;
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\u00a0' || c === '\ufeff' || c === '\u2028' || c === '\u2029') {
        i += 1;
      } else if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n' && text[i] !== '\r' && text[i] !== '\u2028' && text[i] !== '\u2029') i += 1;
      } else if (c === '/' && text[i + 1] === '*') {
        const close = text.indexOf('*/', i + 2);
        i = close < 0 ? n : close + 2;
      } else if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
        const token = { type: 'string', value: text.slice(i + 1, j), start: i, end: Math.min(j + 1, n) };
        tokens.push(token);
        prev = token;
        i = token.end;
      } else if (c === '`') {
        template();
        prev = { type: 'template' };
      } else if (c === '/' && regexAllowed(prev)) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < n && text[j] !== '\n') {
          if (text[j] === '\\') j += 2;
          else if (text[j] === '[') { inClass = true; j += 1; }
          else if (text[j] === ']') { inClass = false; j += 1; }
          else if (text[j] === '/' && !inClass) { closed = true; break; }
          else j += 1;
        }
        if (!closed) {
          prev = { type: 'punct', value: '/' };
          tokens.push({ type: 'punct', value: '/', start: i, end: i + 1 });
          i += 1;
        } else {
          j += 1;
          while (j < n && isIdPart(text[j])) j += 1;
          prev = { type: 'regex' };
          tokens.push({ type: 'regex', value: text.slice(i, j), start: i, end: j });
          i = j;
        }
      } else if (isIdStart(c)) {
        let j = i + 1;
        while (j < n && isIdPart(text[j])) j += 1;
        const token = { type: 'word', value: text.slice(i, j), start: i, end: j };
        tokens.push(token);
        prev = token;
        i = j;
      } else if (c >= '0' && c <= '9') {
        let j = i + 1;
        while (j < n && /[0-9A-Za-z_.]/.test(text[j])) j += 1;
        prev = { type: 'number' };
        tokens.push({ type: 'number', value: text.slice(i, j), start: i, end: j });
        i = j;
      } else {
        if (c === '{') depth += 1;
        if (c === '}') {
          if (nested && depth === 0) {
            i += 1;
            return;
          }
          depth -= 1;
        }
        const token = { type: 'punct', value: c, start: i, end: i + 1 };
        tokens.push(token);
        prev = token;
        i += 1;
      }
    }
  }

  code(false);
  return tokens;
}

const isPunct = (t, value) => Boolean(t) && t.type === 'punct' && t.value === value;
const isWord = (t, value) => Boolean(t) && t.type === 'word' && t.value === value;

// Every module specifier in the text, as { spec, start, end, dynamic }, where start and end bracket the quoted specifier.
// Static imports (with or without a binding), re-exports and dynamic imports are found. A dynamic import whose argument is
// not one plain string, a specifier with an escape, and an import clause that does not read as one are refused, because
// the play cannot say what they would load.
export function findImports(text, label = 'this file') {
  const bad = () => new PlayError(IMPORT, `An import in ${clip(label)} cannot be read, so nothing was run.`);
  const tokens = tokenize(text);
  const found = [];
  const add = (token, dynamic) => {
    if (token.value.includes('\\')) throw bad();
    found.push({ spec: token.value, start: token.start, end: token.end, dynamic });
  };
  // From token k, read an import or export clause (names, braces, stars, commas) up to its from-string.
  const clauseThenSource = (k) => {
    for (let j = k; j < tokens.length; j += 1) {
      const x = tokens[j];
      if (isWord(x, FROM) && tokens[j + 1] && tokens[j + 1].type === 'string') {
        add(tokens[j + 1], false);
        return;
      }
      if (x.type === 'word' || (x.type === 'punct' && (x.value === '{' || x.value === '}' || x.value === '*' || x.value === ','))) continue;
      throw bad();
    }
    throw bad();
  };

  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k];
    if (t.type !== 'word' || (t.value !== IMPORT && t.value !== EXPORT)) continue;
    if (isPunct(tokens[k - 1], '.')) continue; // a property that happens to be called that
    const next = tokens[k + 1];
    if (t.value === IMPORT) {
      if (!next) throw bad();
      if (isPunct(next, '.')) continue; // the module's own address
      if (isPunct(next, '(')) {
        const arg = tokens[k + 2];
        const close = tokens[k + 3];
        if (arg && arg.type === 'string' && (isPunct(close, ')') || isPunct(close, ','))) add(arg, true);
        else throw bad();
      } else if (next.type === 'string') {
        add(next, false);
      } else {
        clauseThenSource(k + 1);
      }
    } else if (isPunct(next, '*')) {
      clauseThenSource(k + 2);
    } else if (isPunct(next, '{')) {
      let depth = 0;
      let j = k + 1;
      for (; j < tokens.length; j += 1) {
        if (isPunct(tokens[j], '{')) depth += 1;
        if (isPunct(tokens[j], '}')) {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (isWord(tokens[j + 1], FROM) && tokens[j + 2] && tokens[j + 2].type === 'string') add(tokens[j + 2], false);
    }
  }
  return found;
}

// ---- planning and building ----

// Where `spec` points when written in the file at `from`, as a path in the loaded set, or null when it points elsewhere.
function resolveRelative(from, spec, known) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const parts = from.split('/').slice(0, -1);
  for (const segment of spec.split('/')) {
    if (segment === '.') continue;
    if (segment === '') return null;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  const path = parts.join('/');
  return known.has(path) ? path : null;
}

// Plan the modules to build for the entry files: check every import of every file reachable from them, and order the
// files so that each comes after the files it imports. `files` is a Map from path to text. Throws a PlayError of kind
// import for an import that is not another loaded file or one of the two stand-in names, and for an import cycle.
//   → { order: [path], edits: Map(path → [{ start, end, target: { path } | { standIn } }]), standIns: [name] }
export function planModules(files, entries) {
  const order = [];
  const edits = new Map();
  const standIns = [];
  const state = new Map(); // path → 'visiting' | 'done'

  const visit = (path) => {
    if (state.get(path) === 'done') return;
    if (state.get(path) === 'visiting') throw new PlayError(IMPORT, `The files import each other in a circle at ${clip(path)}, so nothing was run.`);
    if (!files.has(path)) throw new PlayError(IMPORT, `The play has no file ${clip(path)} to load, so nothing was run.`);
    state.set(path, 'visiting');
    const list = [];
    for (const found of findImports(files.get(path), path)) {
      if (Object.hasOwn(STAND_INS, found.spec)) {
        if (!standIns.includes(found.spec)) standIns.push(found.spec);
        list.push({ start: found.start, end: found.end, target: { standIn: found.spec } });
        continue;
      }
      const target = resolveRelative(path, found.spec, files);
      if (target === null) throw new PlayError(IMPORT, `${clip(path)} imports ${clip(found.spec)}, which the play does not provide, so nothing was run.`);
      visit(target);
      list.push({ start: found.start, end: found.end, target: { path: target } });
    }
    edits.set(path, list);
    state.set(path, 'done');
    order.push(path);
  };

  for (const entry of entries) visit(entry);
  return { order, edits, standIns };
}

// Replace the quoted specifiers in `text` with the quoted addresses, working from the end so positions stay right.
function rewrite(text, replacements) {
  let out = text;
  for (const r of [...replacements].sort((a, b) => b.start - a.start)) out = out.slice(0, r.start) + JSON.stringify(r.url) + out.slice(r.end);
  return out;
}

// Build modules for the entry files and what they import. Everything is planned and checked first, so one unknown import
// stops the build before makeUrl has been called once. Then the stand-ins are built, then the files in dependency order,
// each with its imports pointing at the addresses already built.
//   files: Map path → text (already hash-checked); standIns: Map name → text; makeUrl(text) → address of a module with that text.
//   → { urls: Map path → address, standInUrls: Map name → address }
export function buildModules({ files, entries, standIns, makeUrl }) {
  const plan = planModules(files, entries);
  for (const name of plan.standIns) {
    if (!standIns.has(name)) throw new PlayError(IMPORT, `The play has no stand-in for ${clip(name)}, so nothing was run.`);
    if (findImports(standIns.get(name), name).length > 0) throw new PlayError(IMPORT, `The stand-in for ${clip(name)} imports something, which it must not, so nothing was run.`);
  }
  const standInUrls = new Map();
  for (const name of plan.standIns) standInUrls.set(name, makeUrl(standIns.get(name)));
  const urls = new Map();
  for (const path of plan.order) {
    const replacements = plan.edits.get(path).map((e) => ({ start: e.start, end: e.end, url: e.target.standIn ? standInUrls.get(e.target.standIn) : urls.get(e.target.path) }));
    urls.set(path, makeUrl(rewrite(files.get(path), replacements)));
  }
  return { urls, standInUrls };
}

// ---- loading and checking the copies ----

// The receipt that holds the pins for a run: the buried sample for the planted change, the risen receipt for the fix.
export function receiptUrl(run, base) {
  if (run === 'planted') return `${base}sample-buried.json`;
  if (run === 'fixed') return `${base}${PLAY_DIR}/${RISEN_RECEIPT}`;
  throw new Error('A run is planted or fixed.');
}

async function fetchBytes(fetchFn, url, what) {
  const trouble = new PlayError('fetch', `The page could not load ${clip(what)}, so nothing was run.`);
  let response;
  try {
    response = await fetchFn(url, FETCH_OPTIONS);
  } catch {
    throw trouble;
  }
  if (!response || !response.ok) throw trouble;
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    throw trouble;
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

// Fetch the receipt for the run and the ten files the contracts load, check every file against the receipt's pin, and
// give back their text. The bytes that were hashed are the bytes that are decoded, so a file cannot change between the
// check and the run. For the planted run, the planted change is applied to src/split.js before its hash is compared with
// the buried sample's pin. Nothing is built here.
//   → { receipt, files: Map path → text }
export async function loadVerified({ run, base, fetchFn = globalThis.fetch }) {
  if (!PLAY_RUNS.includes(run)) throw new PlayError('request', 'The run is planted or fixed.');

  const receiptName = run === 'planted' ? 'the buried sample' : 'the risen receipt';
  const receiptBytes = await fetchBytes(fetchFn, receiptUrl(run, base), receiptName);
  let receiptText;
  try {
    receiptText = decoder.decode(receiptBytes);
  } catch {
    throw new PlayError('hash', 'The receipt for this run is not a receipt, so nothing was run.');
  }
  const parsed = parseReceipt(receiptText);
  if (!parsed.ok) throw new PlayError('hash', 'The receipt for this run is not a receipt, so nothing was run.');
  const receipt = parsed.receipt;
  if ((await computeReceiptHash(receipt)) !== receipt.receiptHash) {
    throw new PlayError('hash', 'The receipt for this run does not match its own hash, so nothing was run.');
  }

  const pins = new Map();
  for (const pin of playPins(receipt)) {
    if (!pins.has(pin.path)) pins.set(pin.path, new Set());
    pins.get(pin.path).add(pin.sha256);
  }

  const paths = [...PLAY_CONTRACT_FILES, ...PLAY_SOURCE_FILES];
  const fetched = await Promise.all(paths.map((path) => fetchBytes(fetchFn, copyUrl(path, base), `its copy of ${path}`)));

  const files = new Map();
  for (let k = 0; k < paths.length; k += 1) {
    const path = paths[k];
    let bytes = fetched[k];
    if (run === 'planted' && path === 'src/split.js') {
      try {
        bytes = encoder.encode(applyPlanted(decoder.decode(bytes)));
      } catch {
        throw new PlayError('hash', `The planted change does not fit the copy of ${path}, so nothing was run.`);
      }
    }
    const pinned = pins.get(path);
    if (!pinned) throw new PlayError('hash', `The receipt has no hash for ${path}, so nothing was run.`);
    if (pinned.size !== 1) throw new PlayError('hash', `The receipt lists more than one hash for ${path}, so nothing was run.`);
    if ((await sha256Hex(bytes)) !== [...pinned][0]) {
      throw new PlayError('hash', `The copy of ${path} does not match the hash in the receipt, so nothing was run.`);
    }
    try {
      files.set(path, decoder.decode(bytes));
    } catch {
      throw new PlayError('hash', `The copy of ${path} is not text, so nothing was run.`);
    }
  }
  return { receipt, files };
}

// ---- the run (worker side) ----

// Run the seven contracts for a run: load and check the copies, plan and build the modules, import the two contract files,
// and run the tests the stand-in recorded. makeUrl turns module text into an address (a blob URL in the worker),
// revokeUrl gives it back, importModule imports an address.
//   → { run, results: [{ name, result, message }] in the fixed order, ms }
export async function runPlayContracts({
  run,
  base,
  libBase = new URL('./', import.meta.url).href,
  fetchFn = globalThis.fetch,
  makeUrl,
  revokeUrl = () => {},
  importModule,
  onResult = () => {},
}) {
  const started = Date.now();
  const { files } = await loadVerified({ run, base, fetchFn });

  const standInTexts = new Map();
  for (const [name, file] of Object.entries(STAND_INS)) {
    const text = decoder.decode(await fetchBytes(fetchFn, `${libBase}${file}`, `the stand-in for ${name}`));
    standInTexts.set(name, text);
  }

  const created = [];
  try {
    const built = buildModules({
      files,
      entries: PLAY_CONTRACT_FILES,
      standIns: standInTexts,
      makeUrl: (text) => {
        const url = makeUrl(text);
        created.push(url);
        return url;
      },
    });

    let recorded;
    try {
      recorded = await importModule(built.standInUrls.get('node:test'));
      for (const file of PLAY_CONTRACT_FILES) await importModule(built.urls.get(file));
    } catch (err) {
      throw new PlayError('run', `A contract file could not be loaded (${clip(err && err.message ? err.message : err, 120)}), so nothing was run.`);
    }
    if (!recorded || typeof recorded.runRegistered !== 'function') throw new PlayError('run', 'The stand-in for the test module cannot run tests, so nothing was run.');

    const raw = await recorded.runRegistered(onResult);
    const results = PLAY_CONTRACTS.map((c) => {
      const found = raw.find((r) => r.name === c.name);
      return found ? { name: found.name, result: found.result, message: found.message } : { name: c.name, result: 'fail', message: 'This contract did not run.' };
    });
    return { run, results, ms: Date.now() - started };
  } finally {
    for (const url of created) {
      try {
        revokeUrl(url);
      } catch {
        // Giving back an address is housekeeping.
      }
    }
  }
}

// ---- the message the worker takes ----

// The run name in a message, or null. The message is exactly { run: 'planted' } or { run: 'fixed' }: no other field, no
// inherited field, no other value. Nothing else from a message is ever used.
export function parseRunMessage(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Reflect.ownKeys(data);
  if (keys.length !== 1 || keys[0] !== 'run') return null;
  return typeof data.run === 'string' && PLAY_RUNS.includes(data.run) ? data.run : null;
}

// The worker's whole job for one message. `env` carries post (to the page) and what runPlayContracts needs.
export async function handleMessage(data, env) {
  const { post, ...rest } = env;
  const run = parseRunMessage(data);
  if (run === null) {
    post({ type: 'error', kind: 'request', message: 'The worker takes one run name, planted or fixed, and nothing else.' });
    return;
  }
  try {
    const out = await runPlayContracts({ ...rest, run, onResult: (r) => post({ type: 'result', run, ...r }) });
    post({ type: 'done', run, results: out.results, ms: out.ms });
  } catch (err) {
    if (err instanceof PlayError) post({ type: 'error', run, kind: err.kind, message: err.message });
    else post({ type: 'error', run, kind: 'run', message: oneSentence(`The run stopped with an error (${clip(err && err.message ? err.message : err, 120)})`, 'The run stopped with an error.') });
  }
}

// ---- the page side ----

// The gate's full run for a step, counted from the receipt that step stands on: { passed, failed, total }, or null when the
// receipt cannot be loaded in time. The wait is bounded so a slow answer never keeps a step on "running".
export async function fullRunFor(run, base, fetchFn = globalThis.fetch, { timeoutMs = FULL_RUN_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!PLAY_RUNS.includes(run)) return null;
  let timer;
  const give = new Promise((resolve) => {
    timer = setTimer(() => resolve(null), timeoutMs);
  });
  const look = (async () => {
    try {
      const response = await fetchFn(receiptUrl(run, base), FETCH_OPTIONS);
      if (!response || !response.ok) return null;
      const parsed = parseReceipt(await response.text());
      if (!parsed.ok) return null;
      const total = parsed.receipt.contracts.length;
      const passed = parsed.receipt.contracts.filter((c) => c.result === 'pass').length;
      return { passed, failed: total - passed, total };
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([look, give]);
  } finally {
    clearTimer(timer);
  }
}

// Whether a list is exactly the seven results, in order, and make clean copies of them.
function cleanResults(list) {
  if (!Array.isArray(list) || list.length !== PLAY_CONTRACTS.length) return null;
  const out = [];
  for (let k = 0; k < list.length; k += 1) {
    const r = list[k];
    if (!r || typeof r !== 'object' || r.name !== PLAY_CONTRACTS[k].name) return null;
    if (r.result !== 'pass' && r.result !== 'fail') return null;
    out.push({ name: r.name, result: r.result, message: typeof r.message === 'string' ? r.message : '' });
  }
  return out;
}

const WORKER_KINDS = ['request', 'fetch', 'hash', IMPORT, 'run'];

// Start the worker for a run and wait for it. Always resolves, never rejects, and never waits past the limit:
//   { ok: true, run, results, ms }
//   { ok: false, run, kind, message, full }   kind: start, timeout, request, fetch, hash, import or run; message is one
//                                              plain sentence; full is the gate's full run for this step from the receipts.
// The worker is terminated however the run ends.
export function runPlay({
  run,
  base = new URL('../', import.meta.url).href,
  workerUrl = new URL('./play-worker.js', import.meta.url).href,
  WorkerCtor = globalThis.Worker,
  fetchFn = globalThis.fetch,
  timeoutMs = PLAY_TIMEOUT_MS,
  fullTimeoutMs = FULL_RUN_TIMEOUT_MS,
  onResult = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (!PLAY_RUNS.includes(run)) {
    return Promise.resolve({ ok: false, run, kind: 'request', message: 'The run is planted or fixed.', full: null });
  }
  return new Promise((resolve) => {
    let worker = null;
    let timer = null;
    let settled = false;
    let heard = false;
    const began = Date.now();

    const end = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      try {
        if (worker) worker.terminate();
      } catch {
        // The worker is already gone.
      }
      if (outcome.ok) {
        resolve(outcome);
        return;
      }
      fullRunFor(run, base, fetchFn, { timeoutMs: fullTimeoutMs, setTimer, clearTimer }).then(
        (full) => resolve({ ...outcome, full }),
        () => resolve({ ...outcome, full: null }),
      );
    };
    const fail = (kind, message) => end({ ok: false, run, kind, message });

    try {
      if (typeof WorkerCtor !== 'function') throw new Error('no Worker');
      worker = new WorkerCtor(workerUrl, { type: 'module' });
    } catch {
      fail('start', 'The browser could not start the worker that runs the contracts.');
      return;
    }

    worker.addEventListener('message', (event) => {
      const data = event && event.data;
      if (settled || !data || typeof data !== 'object') return;
      if (data.type === 'result') {
        heard = true;
        if (typeof data.name === 'string' && PLAY_CONTRACTS.some((c) => c.name === data.name) && (data.result === 'pass' || data.result === 'fail')) {
          try {
            onResult({ name: data.name, result: data.result, message: typeof data.message === 'string' ? data.message : '' });
          } catch {
            // A listener that throws must not stop the run.
          }
        }
      } else if (data.type === 'done') {
        heard = true;
        const results = cleanResults(data.results);
        if (results) end({ ok: true, run, results, ms: Date.now() - began });
        else fail('run', 'The worker sent results the page did not expect, so the run was stopped.');
      } else if (data.type === 'error') {
        heard = true;
        fail(WORKER_KINDS.includes(data.kind) ? data.kind : 'run', oneSentence(data.message, 'The run stopped with an error.'));
      }
    });
    worker.addEventListener('error', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (heard) fail('run', 'The worker stopped with an error, so the run was stopped.');
      else fail('start', 'The browser could not start the worker that runs the contracts.');
    });

    timer = setTimer(() => fail('timeout', `The run took longer than ${timeoutMs / 1000} seconds, so it was stopped.`), timeoutMs);
    try {
      worker.postMessage({ run });
    } catch {
      fail('start', 'The browser could not start the worker that runs the contracts.');
    }
  });
}
