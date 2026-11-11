import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  PLAY_RUNS,
  PLAY_TIMEOUT_MS,
  PLAY_CONTRACT_FILES,
  PLAY_SOURCE_FILES,
  PLAY_CONTRACTS,
  STAND_INS,
  PlayError,
  findImports,
  planModules,
  buildModules,
  receiptUrl,
  loadVerified,
  runPlayContracts,
  parseRunMessage,
  handleMessage,
  fullRunFor,
  runPlay,
} from '../site/lib/play-loader.js';
import { computeReceiptHash } from '../site/lib/canon.js';

const SITE = fileURLToPath(new URL('../site/', import.meta.url));
const BASE = 'http://play.test/';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const disk = (rel) => fs.readFileSync(`${SITE}${rel}`);
// Each call gives a new address, as URL.createObjectURL does, so Node does not reuse a module it has already run.
let urlCounter = 0;
const dataUrl = (text) => `data:text/javascript;base64,${Buffer.from(`${text}\n// ${++urlCounter}\n`, 'utf8').toString('base64')}`;

// A fetch that serves site/ on disk under BASE, lets a test replace or remove files, and records the requests.
function serve({ replace = {}, missing = [] } = {}) {
  const calls = [];
  const options = [];
  const fetchFn = async (url, opts) => {
    const text = String(url);
    calls.push(text);
    options.push(opts);
    let rel = null;
    if (text.startsWith(BASE)) rel = decodeURIComponent(text.slice(BASE.length));
    if (rel === null || missing.includes(rel)) return new Response('Not Found', { status: 404 });
    if (rel in replace) return new Response(replace[rel], { status: 200 });
    const file = `${SITE}${rel}`;
    return fs.existsSync(file) ? new Response(disk(rel), { status: 200 }) : new Response('Not Found', { status: 404 });
  };
  fetchFn.calls = calls;
  fetchFn.options = options;
  return fetchFn;
}

// The pin receipt for a run, changed so that `path` has new text, with the pin and the receipt hash made consistent.
// This is a receipt nobody wrote: it lets a test get past the hash check to what comes after it.
async function withNewText(run, path, newText) {
  const receiptRel = run === 'planted' ? 'sample-buried.json' : 'play/risen-receipt.json';
  const receipt = JSON.parse(disk(receiptRel).toString('utf8'));
  const all = [...receipt.contracts, ...(receipt.sources || [])].filter((p) => p.path === path);
  assert.ok(all.length > 0, `the receipt pins ${path}`);
  for (const pin of all) pin.sha256 = sha(Buffer.from(newText, 'utf8'));
  receipt.receiptHash = await computeReceiptHash(receipt);
  const copyRel = `play/${path}`;
  return { [receiptRel]: JSON.stringify(receipt), [copyRel]: newText };
}

const env = (fetchFn, extra = {}) => ({
  base: BASE,
  libBase: `${BASE}lib/`,
  fetchFn,
  makeUrl: dataUrl,
  importModule: (url) => import(url),
  ...extra,
});

const paths = (found) => found.map((f) => f.spec);

// ---- constants ----

test('the fixed lists: two runs, the 10 second limit, two contract files, the sources, the seven contracts and the two stand-ins', () => {
  assert.deepEqual(PLAY_RUNS, ['planted', 'fixed']);
  assert.equal(PLAY_TIMEOUT_MS, 10000);
  assert.deepEqual(PLAY_CONTRACT_FILES, [
    'contracts/ledger/requirement-2-split.contract.test.js',
    'contracts/ledger/properties.contract.test.js',
  ]);
  assert.deepEqual(PLAY_SOURCE_FILES, [
    'src/errors.js',
    'src/money.js',
    'src/parse.js',
    'src/split.js',
    'src/balances.js',
    'src/settle.js',
    'src/report.js',
    'test/gen.js',
  ]);
  assert.deepEqual(PLAY_CONTRACTS.map((c) => c.id), ['R2.1', 'R2.2', 'R5.1', 'R5.2', 'R5.3', 'R5.4', 'R5.5']);
  assert.deepEqual(Object.keys(STAND_INS), ['node:test', 'node:assert/strict']);
});

test('the seven contract names are the ones the buried sample and the risen receipt list, in those files', () => {
  const buried = JSON.parse(disk('sample-buried.json').toString('utf8'));
  const risen = JSON.parse(disk('play/risen-receipt.json').toString('utf8'));
  for (const receipt of [buried, risen]) {
    for (const c of PLAY_CONTRACTS) {
      const listed = receipt.contracts.find((x) => x.name === c.name);
      assert.ok(listed, `${c.id} is listed by name`);
      assert.equal(listed.path, c.file, `${c.id} lives in ${c.file}`);
    }
    const inTheTwoFiles = receipt.contracts.filter((x) => PLAY_CONTRACT_FILES.includes(x.path));
    assert.equal(inTheTwoFiles.length, 7, 'the two files hold exactly the seven');
  }
});

// ---- reading imports ----

test('findImports finds static, side-effect, re-export and dynamic specifiers', () => {
  const src = [
    "import test from 'node:test';",
    "import { a, b as c } from './x.js';",
    "import * as ns from '../y.js';",
    "import d, { e } from './z.js';",
    "import './side.js';",
    "export { f } from './f.js';",
    "export * from './g.js';",
    "export * as h from './h.js';",
    "const m = await import('./dyn.js');",
    "export const own = 1; export { own as renamed };",
  ].join('\n');
  assert.deepEqual(paths(findImports(src)), [
    'node:test',
    './x.js',
    '../y.js',
    './z.js',
    './side.js',
    './f.js',
    './g.js',
    './h.js',
    './dyn.js',
  ]);
});

test('findImports reports where each specifier is, so it can be replaced exactly', () => {
  const src = "import { a } from './x.js';\nconst b = await import(\"./y.js\");\n";
  assert.deepEqual(findImports(src).map((f) => src.slice(f.start, f.end)), ["'./x.js'", '"./y.js"']);
});

test('findImports ignores comments, strings, templates and regular expressions', () => {
  const src = [
    "// import x from './comment.js';",
    "/* import y from './block.js'; import('./block2.js') */",
    "const s = \"import z from './string.js'\";",
    "const t = `import w from './template.js' ${1 + 1}`;",
    "const r = /import 'q' from '.\\/regex.js'/;",
    "const q = /['\"]/.test('x');",
    "const half = 4 / 2; const more = 8 / 2 / 1;",
    "const obj = { from: 1 }; const { from } = obj; obj.import = 2;",
    "import real from './real.js';",
  ].join('\n');
  assert.deepEqual(paths(findImports(src)), ['./real.js']);
});

test('findImports sees an import inside a template substitution', () => {
  assert.deepEqual(paths(findImports("const t = `${await import('./inner.js')}`;")), ['./inner.js']);
});

test('findImports refuses a dynamic import it cannot read: a variable, a template, a concatenation', () => {
  for (const src of ['import(name)', 'import(`./x.js`)', "import('./x' + '.js')", 'import(...args)', 'import()']) {
    assert.throws(() => findImports(src), (e) => e instanceof PlayError && e.kind === 'import', src);
  }
});

test('findImports refuses a specifier with an escape in it', () => {
  assert.throws(() => findImports("import x from './a\\u002ejs';"), (e) => e instanceof PlayError && e.kind === 'import');
});

test('findImports leaves import.meta alone and reads every real ledger file without error', () => {
  assert.deepEqual(findImports('const u = import.meta.url;'), []);
  for (const rel of [...PLAY_CONTRACT_FILES, ...PLAY_SOURCE_FILES]) {
    assert.doesNotThrow(() => findImports(disk(`play/${rel}`).toString('utf8')), rel);
  }
  // The two contract files import the test module and the assert module statically, and the sources dynamically.
  const split = findImports(disk('play/contracts/ledger/requirement-2-split.contract.test.js').toString('utf8'));
  assert.deepEqual(paths(split), [
    'node:test',
    'node:assert/strict',
    '../../src/split.js',
    '../../src/parse.js',
    '../../src/balances.js',
    '../../src/parse.js',
    '../../src/balances.js',
  ]);
});

// ---- planning: only known imports ----

const FILES = (extra = {}) =>
  new Map(
    Object.entries({
      'src/a.js': "import { b } from './b.js';\nexport const a = b;\n",
      'src/b.js': 'export const b = 1;\n',
      'contracts/c.js': "import test from 'node:test';\nconst m = await import('../src/a.js');\n",
      ...extra,
    }),
  );

test('planModules orders dependencies before the files that import them, from the entry files only', () => {
  const plan = planModules(FILES({ 'src/unused.js': 'export const u = 1;\n' }), ['contracts/c.js']);
  assert.deepEqual(plan.order, ['src/b.js', 'src/a.js', 'contracts/c.js']);
});

test('planModules refuses an import it does not know', () => {
  const bad = {
    'node:fs': "import fs from 'node:fs';",
    'node:assert (not strict)': "import assert from 'node:assert';",
    'bare name': "import x from 'left-pad';",
    'absolute url': "import x from 'https://evil.example/x.js';",
    'data url': "import x from 'data:text/javascript,1';",
    'blob url': "import x from 'blob:null/abc';",
    'root path': "import x from '/src/b.js';",
    'a file that is not loaded': "import x from './missing.js';",
    'above the root': "import x from '../../../etc.js';",
    'no extension': "import x from './b';",
    'dynamic': "await import('node:child_process');",
    're-export': "export * from 'node:os';",
    'query on a known file': "import x from './b.js?x=1';",
    'a backslash': "import x from '.\\\\b.js';",
  };
  for (const [what, line] of Object.entries(bad)) {
    const files = FILES({ 'src/a.js': `${line}\nexport const a = 1;\n` });
    assert.throws(() => planModules(files, ['contracts/c.js']), (e) => e instanceof PlayError && e.kind === 'import', what);
  }
});

test('the refusal names the file and the import in one plain sentence', () => {
  const files = FILES({ 'src/a.js': "import fs from 'node:fs';\n" });
  try {
    planModules(files, ['contracts/c.js']);
    assert.fail('should refuse');
  } catch (e) {
    assert.equal(e.kind, 'import');
    assert.match(e.message, /src\/a\.js/);
    assert.match(e.message, /node:fs/);
    assert.match(e.message, /^[^\n]+\.$/);
  }
});

test('planModules refuses a cycle', () => {
  const files = FILES({ 'src/b.js': "import { a } from './a.js';\nexport const b = a;\n" });
  assert.throws(() => planModules(files, ['contracts/c.js']), (e) => e instanceof PlayError && e.kind === 'import');
});

test('planModules accepts the two stand-in names only', () => {
  const plan = planModules(FILES(), ['contracts/c.js']);
  assert.deepEqual(plan.standIns, ['node:test']);
});

// ---- building ----

test('buildModules makes nothing until every import is known, then builds in order with the specifiers replaced', () => {
  const made = [];
  const makeUrl = (text) => {
    made.push(text);
    return `mem:${made.length}`;
  };
  const bad = FILES({ 'src/b.js': "import fs from 'node:fs';\n" });
  assert.throws(() => buildModules({ files: bad, entries: ['contracts/c.js'], standIns: new Map([['node:test', 'export default 1;']]), makeUrl }), (e) => e.kind === 'import');
  assert.equal(made.length, 0, 'nothing was built because one import is unknown');

  const built = buildModules({ files: FILES(), entries: ['contracts/c.js'], standIns: new Map([['node:test', 'export default 1;']]), makeUrl });
  assert.equal(made.length, 4, 'the stand-in and the three files');
  assert.equal(built.standInUrls.get('node:test'), 'mem:1');
  assert.equal(built.urls.get('src/b.js'), 'mem:2');
  assert.equal(built.urls.get('src/a.js'), 'mem:3');
  assert.equal(built.urls.get('contracts/c.js'), 'mem:4');
  assert.match(made[2], /from "mem:2"/, 'the relative import now points at the built module');
  assert.match(made[3], /import\("mem:3"\)/);
  assert.match(made[3], /from "mem:1"/);
  assert.doesNotMatch(made.join('\n'), /\.\/b\.js|\.\.\/src|node:test/);
});

test('a stand-in with an import of its own is refused', () => {
  const standIns = new Map([['node:test', "import x from './x.js';"]]);
  assert.throws(() => buildModules({ files: FILES(), entries: ['contracts/c.js'], standIns, makeUrl: () => 'mem:1' }), (e) => e.kind === 'import');
});

test('a stand-in the files need but the caller did not give is refused', () => {
  assert.throws(() => buildModules({ files: FILES(), entries: ['contracts/c.js'], standIns: new Map(), makeUrl: () => 'mem:1' }), (e) => e.kind === 'import');
});

// ---- the hash check ----

test('receiptUrl: the buried sample for the planted change, the risen receipt for the fix', () => {
  assert.equal(receiptUrl('planted', BASE), `${BASE}sample-buried.json`);
  assert.equal(receiptUrl('fixed', BASE), `${BASE}play/risen-receipt.json`);
  assert.throws(() => receiptUrl('other', BASE));
});

test('loadVerified gives the text of the ten files when every hash matches the pin, for both runs', async () => {
  for (const run of PLAY_RUNS) {
    const loaded = await loadVerified({ run, base: BASE, fetchFn: serve() });
    assert.deepEqual([...loaded.files.keys()].sort(), [...PLAY_CONTRACT_FILES, ...PLAY_SOURCE_FILES].sort());
    for (const rel of PLAY_CONTRACT_FILES) assert.equal(loaded.files.get(rel), disk(`play/${rel}`).toString('utf8'));
    assert.ok(loaded.receipt.receiptHash);
  }
});

test('for the planted run src/split.js has the planted change; for the fix it is the copy as it is', async () => {
  const planted = await loadVerified({ run: 'planted', base: BASE, fetchFn: serve() });
  assert.match(planted.files.get('src/split.js'), /Math\.round\(cents \/ n\)/);
  assert.match(planted.files.get('src/split.js'), /const extra = 0;/);
  const fixed = await loadVerified({ run: 'fixed', base: BASE, fetchFn: serve() });
  assert.match(fixed.files.get('src/split.js'), /Math\.floor\(cents \/ n\)/);
  assert.match(fixed.files.get('src/split.js'), /const extra = cents % n;/);
});

test('a changed copy is refused with a plain sentence that names the file', async () => {
  for (const run of PLAY_RUNS) {
    for (const rel of [...PLAY_CONTRACT_FILES, ...PLAY_SOURCE_FILES]) {
      const original = disk(`play/${rel}`).toString('utf8');
      const fetchFn = serve({ replace: { [`play/${rel}`]: `${original}// one more line\n` } });
      await assert.rejects(
        loadVerified({ run, base: BASE, fetchFn }),
        (e) => {
          assert.ok(e instanceof PlayError);
          assert.equal(e.kind, 'hash');
          assert.ok(e.message.includes(rel), e.message);
          assert.match(e.message, /^[^\n]+\.$/);
          return true;
        },
        `${run} ${rel}`,
      );
    }
  }
});

test('one changed byte is enough', async () => {
  const bytes = Buffer.from(disk('play/src/money.js'));
  bytes[0] ^= 1;
  await assert.rejects(loadVerified({ run: 'fixed', base: BASE, fetchFn: serve({ replace: { 'play/src/money.js': bytes } }) }), (e) => e.kind === 'hash');
});

test('the planted change on a split.js that does not hold the code to change is a hash failure, not a run', async () => {
  const fetchFn = serve({ replace: { 'play/src/split.js': '// something else\nexport const x = 1;\n' } });
  await assert.rejects(loadVerified({ run: 'planted', base: BASE, fetchFn }), (e) => e.kind === 'hash' && e.message.includes('src/split.js'));
});

test('the planted run does not accept the fixed code, and the fixed run does not accept the planted code', async () => {
  // Serve the planted bytes for the fixed run: they match the buried pin but not the risen one.
  const planted = (await loadVerified({ run: 'planted', base: BASE, fetchFn: serve() })).files.get('src/split.js');
  await assert.rejects(loadVerified({ run: 'fixed', base: BASE, fetchFn: serve({ replace: { 'play/src/split.js': planted } }) }), (e) => e.kind === 'hash');
});

test('a file that cannot be loaded, or a receipt that cannot be loaded, is a fetch failure in one sentence', async () => {
  await assert.rejects(loadVerified({ run: 'fixed', base: BASE, fetchFn: serve({ missing: ['play/src/parse.js'] }) }), (e) => e.kind === 'fetch' && e.message.includes('src/parse.js') && /^[^\n]+\.$/.test(e.message));
  await assert.rejects(loadVerified({ run: 'planted', base: BASE, fetchFn: serve({ missing: ['sample-buried.json'] }) }), (e) => e.kind === 'fetch');
  await assert.rejects(
    loadVerified({ run: 'fixed', base: BASE, fetchFn: async () => { throw new TypeError('offline'); } }),
    (e) => e.kind === 'fetch',
  );
});

test('a receipt whose own hash does not recompute is refused', async () => {
  const receipt = JSON.parse(disk('play/risen-receipt.json').toString('utf8'));
  receipt.contracts[0].result = 'fail';
  await assert.rejects(loadVerified({ run: 'fixed', base: BASE, fetchFn: serve({ replace: { 'play/risen-receipt.json': JSON.stringify(receipt) } }) }), (e) => e.kind === 'hash' && /receipt/.test(e.message));
});

test('a receipt that is not a receipt, or has no pin for a file, is refused', async () => {
  await assert.rejects(loadVerified({ run: 'fixed', base: BASE, fetchFn: serve({ replace: { 'play/risen-receipt.json': 'not json' } }) }), (e) => e instanceof PlayError);
  const receipt = JSON.parse(disk('play/risen-receipt.json').toString('utf8'));
  receipt.sources = receipt.sources.filter((s) => s.path !== 'src/errors.js');
  receipt.receiptHash = await computeReceiptHash(receipt);
  await assert.rejects(
    loadVerified({ run: 'fixed', base: BASE, fetchFn: serve({ replace: { 'play/risen-receipt.json': JSON.stringify(receipt) } }) }),
    (e) => e.kind === 'hash' && e.message.includes('src/errors.js'),
  );
});

test('the files are requested only from the base given, and the receipts and copies only', async () => {
  const fetchFn = serve();
  await loadVerified({ run: 'planted', base: BASE, fetchFn });
  assert.ok(fetchFn.calls.every((u) => u.startsWith(BASE)), 'every request is under the base');
  assert.ok(fetchFn.calls.includes(`${BASE}sample-buried.json`));
  assert.equal(fetchFn.calls.length, 1 + 10, 'the receipt and the ten files');
  assert.ok(fetchFn.options.every((o) => o && o.credentials === 'omit' && o.referrerPolicy === 'no-referrer'), 'no cookies, no referrer');
});

// ---- the whole run, in Node, with data: URLs standing in for blob: URLs ----

const verdicts = (results) => Object.fromEntries(results.map((r) => [r.name.split(' ')[0], r.result]));

test('the planted run: R2.1, R2.2, R5.1 to R5.4 fail with a message and R5.5 passes', async () => {
  const heard = [];
  const out = await runPlayContracts({ ...env(serve()), run: 'planted', onResult: (r) => heard.push(r.name) });
  assert.deepEqual(out.results.map((r) => r.name), PLAY_CONTRACTS.map((c) => c.name), 'the fixed order');
  assert.deepEqual(verdicts(out.results), { 'R2.1': 'fail', 'R2.2': 'fail', 'R5.1': 'fail', 'R5.2': 'fail', 'R5.3': 'fail', 'R5.4': 'fail', 'R5.5': 'pass' });
  for (const r of out.results) assert.equal(typeof r.message, 'string');
  for (const r of out.results.filter((x) => x.result === 'fail')) assert.ok(r.message.length > 0, `${r.name} has a message`);
  assert.deepEqual(heard, PLAY_CONTRACTS.map((c) => c.name), 'each result was reported as it finished');
});

test('the fixed run: all seven pass', async () => {
  const out = await runPlayContracts({ ...env(serve()), run: 'fixed' });
  assert.deepEqual(out.results.map((r) => r.result), Array(7).fill('pass'));
  assert.ok(out.ms >= 0);
});

test('an unknown import in a file with a matching pin is refused before any module is built', async () => {
  const text = `${disk('play/src/money.js').toString('utf8')}\nimport fs from 'node:fs';\n`;
  const replace = await withNewText('fixed', 'src/money.js', text);
  let built = 0;
  let imported = 0;
  await assert.rejects(
    runPlayContracts({
      ...env(serve({ replace })),
      run: 'fixed',
      makeUrl: (t) => {
        built += 1;
        return dataUrl(t);
      },
      importModule: (u) => {
        imported += 1;
        return import(u);
      },
    }),
    (e) => e instanceof PlayError && e.kind === 'import' && e.message.includes('src/money.js') && e.message.includes('node:fs'),
  );
  assert.equal(built, 0);
  assert.equal(imported, 0);
});

test('a hash failure builds and runs nothing', async () => {
  let built = 0;
  await assert.rejects(
    runPlayContracts({
      ...env(serve({ replace: { 'play/src/parse.js': '// changed\n' } })),
      run: 'fixed',
      makeUrl: (t) => {
        built += 1;
        return dataUrl(t);
      },
    }),
    (e) => e.kind === 'hash',
  );
  assert.equal(built, 0);
});

test('a contract file that cannot load is a run failure in one sentence', async () => {
  const replace = await withNewText('fixed', 'contracts/ledger/properties.contract.test.js', 'export const broken = ;\n');
  await assert.rejects(runPlayContracts({ ...env(serve({ replace })), run: 'fixed' }), (e) => e.kind === 'run' && /^[^\n]+\.$/.test(e.message));
});

test('the blob URLs are given back after a run, also after a failure', async () => {
  const revoked = [];
  const made = [];
  const hooks = { makeUrl: (t) => { const u = dataUrl(t); made.push(u); return u; }, revokeUrl: (u) => revoked.push(u) };
  await runPlayContracts({ ...env(serve()), ...hooks, run: 'fixed' });
  assert.equal(revoked.length, made.length);
  assert.ok(made.length >= 12);
});

// ---- the message the worker accepts ----

test('parseRunMessage accepts exactly { run: "planted" } or { run: "fixed" } and nothing else', () => {
  assert.equal(parseRunMessage({ run: 'planted' }), 'planted');
  assert.equal(parseRunMessage({ run: 'fixed' }), 'fixed');
  for (const bad of [
    null,
    undefined,
    'planted',
    42,
    [],
    {},
    { run: 'other' },
    { run: '../../etc/passwd' },
    { run: ['planted'] },
    { run: 'planted', url: 'https://evil.example/x.js' },
    { run: 'planted', code: 'postMessage(1)' },
    { run: 'planted', files: { 'src/split.js': 'x' } },
    { run: 'planted', base: '/other/' },
    { Run: 'planted' },
  ]) {
    assert.equal(parseRunMessage(bad), null, JSON.stringify(bad));
  }
  const hostile = Object.create({ run: 'planted' });
  assert.equal(parseRunMessage(hostile), null, 'an inherited run is not a run');
});

test('handleMessage posts results then done, or one error, and never code taken from the message', async () => {
  const posted = [];
  await handleMessage({ run: 'fixed' }, { ...env(serve()), post: (m) => posted.push(m) });
  assert.deepEqual(posted.map((m) => m.type), [...Array(7).fill('result'), 'done']);
  assert.deepEqual(posted.at(-1).results.map((r) => r.result), Array(7).fill('pass'));

  const bad = [];
  const fetchFn = serve();
  await handleMessage({ run: 'planted', url: 'https://evil.example/x.js' }, { ...env(fetchFn), post: (m) => bad.push(m) });
  assert.equal(bad.length, 1);
  assert.equal(bad[0].type, 'error');
  assert.match(bad[0].message, /^[^\n]+\.$/);
  assert.equal(fetchFn.calls.length, 0, 'a bad message fetches nothing');

  const failed = [];
  await handleMessage({ run: 'fixed' }, { ...env(serve({ replace: { 'play/src/money.js': 'x' } })), post: (m) => failed.push(m) });
  assert.deepEqual(failed.map((m) => m.type), ['error']);
  assert.equal(failed[0].kind, 'hash');
  assert.equal(failed[0].run, 'fixed');
});

// ---- the page side: runPlay ----

// A worker that is a script: `behave(worker, data)` is called when the page posts the run.
function fakeWorker(behave, { throwOnCreate = false } = {}) {
  const made = [];
  class FakeWorker {
    constructor(url, options) {
      if (throwOnCreate) throw new Error('blocked');
      this.url = String(url);
      this.options = options;
      this.listeners = { message: [], error: [] };
      this.terminated = false;
      made.push(this);
    }
    addEventListener(type, fn) {
      this.listeners[type].push(fn);
    }
    emit(type, event) {
      if (this.terminated) return;
      for (const fn of this.listeners[type]) fn(event);
    }
    postMessage(data) {
      this.posted = data;
      queueMicrotask(() => behave(this, data));
    }
    terminate() {
      this.terminated = true;
    }
  }
  FakeWorker.made = made;
  return FakeWorker;
}

const goodResults = () => PLAY_CONTRACTS.map((c) => ({ name: c.name, result: 'pass', message: '' }));
const playArgs = (WorkerCtor, extra = {}) => ({ WorkerCtor, base: BASE, workerUrl: `${BASE}lib/play-worker.js`, fetchFn: serve(), ...extra });

test('runPlay starts a module worker, posts only the run name, and gives the results', async () => {
  const W = fakeWorker((w) => {
    for (const r of goodResults()) w.emit('message', { data: { type: 'result', run: 'fixed', ...r } });
    w.emit('message', { data: { type: 'done', run: 'fixed', results: goodResults(), ms: 5 } });
  });
  const heard = [];
  const out = await runPlay({ run: 'fixed', ...playArgs(W), onResult: (r) => heard.push(r.name) });
  assert.equal(out.ok, true);
  assert.deepEqual(out.results, goodResults());
  assert.equal(heard.length, 7);
  assert.deepEqual(W.made[0].posted, { run: 'fixed' });
  assert.deepEqual(W.made[0].options, { type: 'module' });
  assert.equal(W.made[0].url, `${BASE}lib/play-worker.js`);
  assert.equal(W.made[0].terminated, true, 'the worker is stopped when the run is over');
});

test('runPlay refuses a run name it does not know without starting anything', async () => {
  const W = fakeWorker(() => {});
  const out = await runPlay({ run: 'both', ...playArgs(W) });
  assert.equal(out.ok, false);
  assert.equal(W.made.length, 0);
  assert.match(out.message, /^[^\n]+\.$/);
});

test('a worker error message ends the run in that sentence with the gate\'s full run from the receipts', async () => {
  const W = fakeWorker((w) =>
    w.emit('message', { data: { type: 'error', run: 'planted', kind: 'hash', message: 'The copy of src/money.js does not match the hash in the receipt, so nothing was run.' } }),
  );
  const out = await runPlay({ run: 'planted', ...playArgs(W) });
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'hash');
  assert.equal(out.message, 'The copy of src/money.js does not match the hash in the receipt, so nothing was run.');
  assert.deepEqual(out.full, { passed: 9, failed: 9, total: 18 });
  assert.equal(W.made[0].terminated, true);
});

test('a worker that cannot start (an error event, or a constructor that throws) ends the run in one sentence', async () => {
  const W = fakeWorker((w) => w.emit('error', { message: 'x' }));
  const out = await runPlay({ run: 'fixed', ...playArgs(W) });
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'start');
  assert.match(out.message, /^[^\n]+\.$/);
  assert.deepEqual(out.full, { passed: 18, failed: 0, total: 18 });

  const T = fakeWorker(() => {}, { throwOnCreate: true });
  const out2 = await runPlay({ run: 'planted', ...playArgs(T) });
  assert.equal(out2.ok, false);
  assert.equal(out2.kind, 'start');
  assert.deepEqual(out2.full, { passed: 9, failed: 9, total: 18 });

  const none = await runPlay({ run: 'fixed', ...playArgs(undefined) });
  assert.equal(none.kind, 'start', 'no Worker in this browser');
});

test('a run that takes longer than the limit is stopped, the worker is terminated, and the page gets a sentence', async () => {
  const W = fakeWorker(() => {});
  const started = Date.now();
  const out = await runPlay({ run: 'fixed', ...playArgs(W, { timeoutMs: 80 }) });
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'timeout');
  assert.match(out.message, /longer than 0\.08 seconds/);
  assert.equal(W.made[0].terminated, true);
  assert.ok(Date.now() - started < 3000);
  assert.deepEqual(out.full, { passed: 18, failed: 0, total: 18 });
});

test('the default limit is ten seconds, said as "10 seconds"', async () => {
  const W = fakeWorker(() => {});
  const timers = [];
  const out = runPlay({ run: 'fixed', ...playArgs(W), setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
  await new Promise((r) => setImmediate(r));
  const guard = timers.find((t) => t.ms === 10000);
  assert.ok(guard, 'a ten second timer was set');
  guard.fn();
  const result = await out;
  assert.equal(result.kind, 'timeout');
  assert.match(result.message, /longer than 10 seconds/);
});

test('a run ends once: a late message after the timeout changes nothing', async () => {
  const W = fakeWorker((w) => setTimeout(() => w.emit('message', { data: { type: 'done', results: goodResults() } }), 100));
  const out = await runPlay({ run: 'fixed', ...playArgs(W, { timeoutMs: 20 }) });
  assert.equal(out.kind, 'timeout');
  await new Promise((r) => setTimeout(r, 150));
});

test('results the page does not expect end the run instead of being shown', async () => {
  const mixed = goodResults();
  mixed[2].name = 'R5.1 something else';
  const W = fakeWorker((w) => w.emit('message', { data: { type: 'done', run: 'fixed', results: mixed } }));
  const out = await runPlay({ run: 'fixed', ...playArgs(W) });
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'run');
  const short = fakeWorker((w) => w.emit('message', { data: { type: 'done', run: 'fixed', results: goodResults().slice(0, 3) } }));
  assert.equal((await runPlay({ run: 'fixed', ...playArgs(short) })).ok, false);
  const odd = fakeWorker((w) => w.emit('message', { data: 'hello' }));
  const out3 = await runPlay({ run: 'fixed', ...playArgs(odd, { timeoutMs: 50 }) });
  assert.equal(out3.kind, 'timeout', 'a message that is not ours is ignored, so only the timer ends this run');
});

test('an error after the worker has started is a run failure, not a start failure', async () => {
  const W = fakeWorker((w) => {
    w.emit('message', { data: { type: 'result', run: 'fixed', ...goodResults()[0] } });
    w.emit('error', {});
  });
  const out = await runPlay({ run: 'fixed', ...playArgs(W) });
  assert.equal(out.kind, 'run');
});

test('when the receipts cannot be loaded either, full is null and the run still ends', async () => {
  const W = fakeWorker((w) => w.emit('error', {}));
  const out = await runPlay({ run: 'fixed', ...playArgs(W, { fetchFn: serve({ missing: ['play/risen-receipt.json'] }) }) });
  assert.equal(out.ok, false);
  assert.equal(out.full, null);
  const hang = await runPlay({ run: 'fixed', ...playArgs(W, { fetchFn: () => new Promise(() => {}), fullTimeoutMs: 30 }) });
  assert.equal(hang.full, null, 'a receipt fetch that never answers does not keep the step running');
});

test('fullRunFor counts the gate\'s full run from the receipt for the step', async () => {
  assert.deepEqual(await fullRunFor('planted', BASE, serve()), { passed: 9, failed: 9, total: 18 });
  assert.deepEqual(await fullRunFor('fixed', BASE, serve()), { passed: 18, failed: 0, total: 18 });
  assert.equal(await fullRunFor('fixed', BASE, serve({ missing: ['play/risen-receipt.json'] })), null);
});
