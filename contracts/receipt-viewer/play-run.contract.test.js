// Contracts for R13.2, R13.3, R13.6, R13.7 and R13.8 of the receipt-viewer spec: the worker runs the ledger's seven
// JavaScript-only contracts in a browser, and the page code ends every run.
//
// Every contract here runs the real worker (site/lib/play-worker.js) in a headless Chrome or Chromium, through the loader the
// page uses (site/lib/play-loader.js, runPlay). The file serves site/ the way GitHub Pages does: from a server on 127.0.0.1
// whose pages sit under /contract-necromancer/, with no Content-Security-Policy header on any response, so the worker has
// no policy of its own. The page it opens is the real index.html, so the page's own policy (the meta tag) applies to the
// page that starts the worker, as in production. The browser is driven over the DevTools protocol with Node's built-in
// WebSocket, no dependencies. Set CHROME_PATH if the browser is somewhere unusual. With no browser these contracts fail and
// say so: a run that was not made in a browser is not a pass.
//
// R13.7 compares the browser's seven results, name by name, with real `necro check ledger` runs in scratch copies of
// examples/pumpkin-ledger, with and without the planted change. R13.6 and R13.8 serve changed copies (and, to get past the
// hash check to what comes after it, a receipt that a test made consistent with the changed copy) to show what the worker
// refuses and what the page says.
//
// There is no shared helper file (a helper would not be frozen), so the browser code is carried in this file. The site
// modules are loaded in the browser, and canon.js is loaded with a dynamic import in Node, so this file always loads and
// every contract name is registered. Dynamic imports are not followed by necro's import tracing, so the modules are also
// named below the way a static import would name them. Keep these lines: the receipt pins files it finds this way.
//   import {} from '../../site/lib/play-worker.js';
//   import {} from '../../site/lib/play-loader.js';
//   import {} from '../../site/lib/play-node-test.js';
//   import {} from '../../site/lib/play-node-assert.js';
//   import {} from '../../site/lib/canon.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const SITE = fileURLToPath(new URL('../../site/', import.meta.url));
const EXAMPLE = path.join(ROOT, 'examples', 'pumpkin-ledger');
const CANON_URL = new URL('../../site/lib/canon.js', import.meta.url);
const PREFIX = '/contract-necromancer/';
const LIB = `${PREFIX}lib/`;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// The ids of the seven contracts, in the order the worker reports them, and the two files they live in.
const SEVEN = ['R2.1', 'R2.2', 'R5.1', 'R5.2', 'R5.3', 'R5.4', 'R5.5'];
const TWO_FILES = ['contracts/ledger/requirement-2-split.contract.test.js', 'contracts/ledger/properties.contract.test.js'];
const PLANTED = [
  ['Math.floor(cents / n)', 'Math.round(cents / n)'],
  ['const extra = cents % n;', 'const extra = 0;'],
];
// The ten files a run loads: the two contract files and what they load. Each has a copy under site/play/.
const TEN = [
  ...TWO_FILES,
  'src/errors.js',
  'src/money.js',
  'src/parse.js',
  'src/split.js',
  'src/balances.js',
  'src/settle.js',
  'src/report.js',
  'test/gen.js',
];

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const BURIED = readJson(path.join(SITE, 'sample-buried.json'));
const RISEN = readJson(path.join(SITE, 'play', 'risen-receipt.json'));
const idOf = (name) => name.split(' ')[0];
const oneSentence = (text) => typeof text === 'string' && /^[^\n]+\.$/.test(text);

function findBrowser() {
  const fixed = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  for (const p of fixed) if (p && fs.existsSync(p)) return p;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

// Serve site/ under /contract-necromancer/, as GitHub Pages serves a project site. Nothing outside that folder exists. No
// response carries a Content-Security-Policy header. `change(rel)` may replace a file: it returns text or bytes to serve in its
// place (also for a file that is not on disk), { status } to answer with that status, or null to serve the file on disk.
function serveSite(requests, change) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const inside = url.pathname.startsWith(PREFIX);
    const rel = inside ? decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html' : null;
    const send = (status, type, body) => {
      requests.push({ rel, status });
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (rel === null) return send(404, 'text/plain', 'not found');
    const changed = change(rel);
    if (changed && typeof changed === 'object' && !Buffer.isBuffer(changed) && changed.status) return send(changed.status, 'text/plain', 'changed');
    if (changed !== null && changed !== undefined) return send(200, TYPES[path.extname(rel)] || 'application/octet-stream', changed);
    const file = path.resolve(SITE, rel);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'text/plain', 'not found');
    return send(200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function connect(url) {
  const ws = new WebSocket(url);
  let next = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const wait = pending.get(message.id);
      pending.delete(message.id);
      if (!wait) return;
      if (message.error) wait.reject(new Error(`${message.error.message}`));
      else wait.resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  };
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('Could not connect to the browser.'));
  });
  return {
    opened,
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      }),
    close: () => ws.close(),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Start a headless browser and the site server, open the real page, and give `run` a function that evaluates an expression
// in that page (it may be async) and returns its value. `requests` lists what the server was asked for.
async function withBrowser({ change = () => null } = {}, run) {
  const chrome = findBrowser();
  if (!chrome) {
    throw new Error('No Chrome or Chromium found. Install one, or set CHROME_PATH to its program, and run this again.');
  }
  const requests = [];
  const server = await serveSite(requests, change);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-run-'));
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let client = null;
  let targetId = null;
  try {
    let endpoint = null;
    for (let i = 0; i < 200 && !endpoint; i += 1) {
      try {
        const [port, wsPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n');
        if (port && wsPath) endpoint = `ws://127.0.0.1:${port}${wsPath}`;
      } catch {
        await sleep(100);
      }
    }
    if (!endpoint) throw new Error('The browser did not start. Check that it runs headless, then run this again.');
    client = connect(endpoint);
    await client.opened;

    ({ targetId } = await client.send('Target.createTarget', { url: 'about:blank' }));
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => client.send(method, params, sessionId);
    await call('Page.enable');
    const loaded = new Promise((resolve) => {
      const stop = client.on((m) => {
        if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') {
          stop();
          resolve();
        }
      });
    });
    await call('Page.navigate', { url: `${origin}${PREFIX}` });
    await loaded;
    const evaluate = async (expression) => {
      const out = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (out.exceptionDetails) throw new Error(`The page script failed: ${out.exceptionDetails.exception?.description || out.exceptionDetails.text}`);
      return out.result.value;
    };
    return await run({ evaluate, requests });
  } finally {
    if (client) {
      if (targetId) await client.send('Target.closeTarget', { targetId }).catch(() => {});
      client.close();
    }
    child.kill('SIGKILL');
    server.closeAllConnections();
    server.close();
    await sleep(100);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// An expression that runs the page's own runPlay for a run, with a Worker class that records every message the worker
// sends. `options` is JavaScript text for extra runPlay options (for example a different worker address).
const play = (run, options = '') => `(async () => {
  const { runPlay } = await import('${LIB}play-loader.js');
  const posted = [];
  const heard = [];
  class Spy extends Worker {
    constructor(url, settings) {
      super(url, settings);
      this.addEventListener('message', (e) => posted.push(e.data));
    }
  }
  const began = performance.now();
  const out = await runPlay({ run: ${JSON.stringify(run)}, WorkerCtor: Spy, onResult: (r) => heard.push(r.name), ${options} });
  return { out, posted, heard, took: performance.now() - began };
})()`;

const onDisk = (rel) => fs.readFileSync(path.join(SITE, 'play', ...rel.split('/')));

// The files of a run changed on the server, and (when `pin` is set) the receipt for that run made to agree with the change,
// so that the hash check passes and the next check is the one under test. The receipt hash is recomputed with the page's
// own canon.js, so it is a receipt that nobody wrote and that is internally consistent.
async function changed(run, rel, text, { pin = false } = {}) {
  const { computeReceiptHash } = await import(CANON_URL.href);
  const out = { [`play/${rel}`]: text };
  if (pin) {
    const receiptRel = run === 'planted' ? 'sample-buried.json' : 'play/risen-receipt.json';
    const receipt = readJson(path.join(SITE, ...receiptRel.split('/')));
    for (const p of [...receipt.contracts, ...(receipt.sources || [])]) if (p.path === rel) p.sha256 = sha(Buffer.from(text, 'utf8'));
    receipt.receiptHash = await computeReceiptHash(receipt);
    out[receiptRel] = JSON.stringify(receipt);
  }
  return (r) => (Object.hasOwn(out, r) ? out[r] : null);
}

function necroCheck(planted) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `necro-run-ledger-${planted ? 'planted' : 'fixed'}-`));
  try {
    fs.cpSync(EXAMPLE, scratch, { recursive: true });
    if (planted) {
      const file = path.join(scratch, 'src', 'split.js');
      let text = fs.readFileSync(file, 'utf8');
      for (const [from, to] of PLANTED) {
        assert.ok(text.includes(from), `src/split.js has no "${from}" to change`);
        text = text.replace(from, () => to);
      }
      fs.writeFileSync(file, text);
    }
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
    const run = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'necro.js'), 'check', 'ledger'], { cwd: scratch, encoding: 'utf8', env, timeout: 240_000 });
    const results = new Map();
    for (const line of run.stdout.split('\n')) {
      const m = /^(pass|fail) (.+)$/.exec(line);
      if (m) results.set(m[2], m[1]);
    }
    return { status: run.status, results, output: `${run.stdout}${run.stderr}` };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// ---- R13.2 and R13.3 ----

test('R13.2 with the planted change the worker runs the two JavaScript-only ledger contract files against the copies and reports R2.1, R2.2 and R5.1 to R5.4 failing, each with its assertion message, and R5.5 passing', async () => {
  await withBrowser({}, async ({ evaluate }) => {
    // The server is built like GitHub Pages: no policy header on the worker script, so the worker has no policy of its own.
    const header = await evaluate(`fetch('${LIB}play-worker.js').then((r) => ({ ok: r.ok, csp: r.headers.get('content-security-policy'), type: r.headers.get('content-type') }))`);
    assert.deepEqual(header, { ok: true, csp: null, type: 'text/javascript; charset=utf-8' });

    const { out, posted, heard, took } = await evaluate(play('planted'));
    assert.equal(out.ok, true, `the planted run must give results, it gave: ${JSON.stringify(out)}`);
    assert.deepEqual(out.results.map((r) => idOf(r.name)), SEVEN, 'seven results in the fixed order');
    assert.deepEqual(
      Object.fromEntries(out.results.map((r) => [idOf(r.name), r.result])),
      { 'R2.1': 'fail', 'R2.2': 'fail', 'R5.1': 'fail', 'R5.2': 'fail', 'R5.3': 'fail', 'R5.4': 'fail', 'R5.5': 'pass' },
    );
    for (const r of out.results.filter((x) => x.result === 'fail')) {
      assert.ok(typeof r.message === 'string' && r.message.trim() !== '', `${idOf(r.name)} fails with an assertion message`);
    }
    // The messages say what went wrong with the planted code (a share that is off, or balances that do not add up).
    assert.ok(out.results.find((r) => idOf(r.name) === 'R2.1').message.length > 0);

    // The names are the ones the buried sample lists for the same two files, and each result was reported as it was known.
    const listed = BURIED.contracts.filter((c) => TWO_FILES.includes(c.path)).map((c) => c.name).sort();
    assert.deepEqual(out.results.map((r) => r.name).sort(), listed);
    assert.deepEqual(heard, out.results.map((r) => r.name), 'each result reached the page as it finished, in order');
    assert.deepEqual(posted.map((m) => m.type), [...Array(7).fill('result'), 'done']);
    assert.ok(took < 10_000, `the run took ${Math.round(took)} ms`);
  });
});

test('R13.3 with the fix the worker runs the same seven contracts against the copies as they are and all seven pass', async () => {
  await withBrowser({}, async ({ evaluate, requests }) => {
    const { out, posted, heard } = await evaluate(play('fixed'));
    assert.equal(out.ok, true, `the fixed run must give results, it gave: ${JSON.stringify(out)}`);
    assert.deepEqual(out.results.map((r) => idOf(r.name)), SEVEN);
    assert.deepEqual(out.results.map((r) => r.result), Array(7).fill('pass'), JSON.stringify(out.results.filter((r) => r.result !== 'pass')));
    assert.deepEqual(heard.map(idOf), SEVEN);
    assert.deepEqual(posted.map((m) => m.type), [...Array(7).fill('result'), 'done']);

    // It ran the copies as they are: the worker asked for the risen receipt and for the ten copies, not for anything else.
    const wanted = requests.filter((r) => r.rel === 'play/risen-receipt.json' || r.rel.startsWith('play/') || r.rel.startsWith('lib/play-node-'));
    assert.deepEqual(
      wanted.map((r) => r.rel).sort(),
      ['play/risen-receipt.json', ...TEN.map((f) => `play/${f}`), 'lib/play-node-assert.js', 'lib/play-node-test.js'].sort(),
    );
    assert.ok(wanted.every((r) => r.status === 200));
  });
});

// ---- R13.6 ----

test('R13.6 the worker runs a copy only after its hash matches the pin, builds modules only from those files and the two stand-ins, refuses an import it does not know, and takes no code from any input', async () => {
  // (a) A changed copy of a source file: refused before anything runs.
  const bytes = fs.readFileSync(path.join(SITE, 'play', 'src', 'parse.js'), 'utf8');
  await withBrowser({ change: (rel) => (rel === 'play/src/parse.js' ? `${bytes}\n// one more line\n` : null) }, async ({ evaluate }) => {
    const { out, posted, heard } = await evaluate(play('fixed'));
    assert.equal(out.ok, false);
    assert.equal(out.kind, 'hash');
    assert.ok(out.message.includes('src/parse.js'), out.message);
    assert.ok(oneSentence(out.message), out.message);
    assert.deepEqual(heard, [], 'no contract ran');
    assert.deepEqual(posted.map((m) => m.type), ['error'], 'the worker said one thing: the error');
  });

  // (b) A changed contract file that would announce itself if it ran: refused, and it never announces itself.
  const contractRel = TWO_FILES[0];
  const contractText = fs.readFileSync(path.join(SITE, 'play', ...contractRel.split('/')), 'utf8');
  const announce = "\nglobalThis.postMessage({ type: 'result', run: 'fixed', name: 'RAN', result: 'pass', message: '' });\n";
  await withBrowser({ change: (rel) => (rel === `play/${contractRel}` ? contractText + announce : null) }, async ({ evaluate }) => {
    const { out, posted } = await evaluate(play('fixed'));
    assert.equal(out.kind, 'hash');
    assert.ok(out.message.includes(contractRel), out.message);
    assert.ok(posted.every((m) => m.name !== 'RAN'), 'the changed contract file did not run');
    assert.deepEqual(posted.map((m) => m.type), ['error']);
  });

  // (c) An import the worker does not know, in a file whose pin was made to match: refused before any module is built.
  const money = fs.readFileSync(path.join(SITE, 'play', 'src', 'money.js'), 'utf8');
  const sneaky = `${money}\nimport fs from 'node:fs';\nglobalThis.postMessage({ type: 'result', run: 'fixed', name: 'RAN', result: 'pass', message: '' });\n`;
  await withBrowser({ change: await changed('fixed', 'src/money.js', sneaky, { pin: true }) }, async ({ evaluate }) => {
    const { out, posted, heard } = await evaluate(play('fixed'));
    assert.equal(out.ok, false);
    assert.equal(out.kind, 'import');
    assert.ok(out.message.includes('src/money.js') && out.message.includes('node:fs'), out.message);
    assert.ok(oneSentence(out.message), out.message);
    assert.deepEqual(heard, []);
    assert.deepEqual(posted.map((m) => m.type), ['error'], 'nothing ran, so nothing but the error was sent');
  });
  // The same for an import of a file the worker does not load, and for a module address.
  for (const line of ["import x from './runtime.js';", "import x from 'https://evil.example/x.js';", "await import(String(globalThis.name));"]) {
    const text = `${money}\n${line}\n`;
    await withBrowser({ change: await changed('fixed', 'src/money.js', text, { pin: true }) }, async ({ evaluate }) => {
      const { out, posted } = await evaluate(play('fixed'));
      assert.equal(out.kind, 'import', `${line}: ${JSON.stringify(out)}`);
      assert.deepEqual(posted.map((m) => m.type), ['error']);
    });
  }

  // (d) The worker takes a run name and nothing else: other fields, other values and other shapes are refused, and nothing
  // is fetched for them.
  await withBrowser({}, async ({ evaluate, requests }) => {
    const before = requests.length;
    const answers = await evaluate(`(async () => {
      const w = new Worker('${LIB}play-worker.js', { type: 'module' });
      const answer = (message) => new Promise((resolve) => {
        const once = (e) => { w.removeEventListener('message', once); resolve(e.data); };
        w.addEventListener('message', once);
        w.postMessage(message);
      });
      const out = [];
      for (const message of [
        { run: 'planted', url: 'https://evil.example/x.js' },
        { run: 'planted', code: 'postMessage(1)' },
        { run: 'planted', files: { 'src/split.js': 'export const x = 1;' } },
        { run: '../../etc/passwd' },
        { run: 'both' },
        'planted',
        { code: 'postMessage(1)' },
        [],
      ]) out.push(await answer(message));
      w.terminate();
      return out;
    })()`);
    assert.equal(answers.length, 8);
    for (const a of answers) {
      assert.equal(a.type, 'error');
      assert.equal(a.kind, 'request');
      assert.ok(oneSentence(a.message), a.message);
    }
    // Starting the worker loads its own script and the modules it imports, and nothing else: no receipt, no copy, no stand-in.
    assert.deepEqual(
      requests.slice(before).map((r) => r.rel).sort(),
      ['lib/canon.js', 'lib/play-loader.js', 'lib/play-worker.js', 'lib/play.js', 'lib/receipt.js', 'lib/repo.js'],
      'no file was fetched for a message that is not a run name',
    );
  });
});

// ---- R13.7 ----

test('R13.7 for the planted change and for the fix, each of the seven contracts has the same result in the browser as in a run of necro check ledger in Node.js on the same code', async () => {
  const names = BURIED.contracts.filter((c) => TWO_FILES.includes(c.path)).map((c) => c.name);
  assert.equal(names.length, 7, 'the buried sample lists seven contracts in the two files');

  const node = { planted: necroCheck(true), fixed: necroCheck(false) };
  assert.equal(node.planted.status, 1, `necro check must refuse the planted change. Output:\n${node.planted.output}`);
  assert.equal(node.fixed.status, 0, `necro check must accept the fix. Output:\n${node.fixed.output}`);
  assert.equal(node.planted.results.size, 18);
  assert.equal([...node.planted.results.values()].filter((r) => r === 'fail').length, 9, 'the gate fails 9 of 18 for the planted change');
  assert.equal([...node.fixed.results.values()].filter((r) => r === 'pass').length, 18);

  await withBrowser({}, async ({ evaluate }) => {
    for (const run of ['planted', 'fixed']) {
      const { out } = await evaluate(play(run));
      assert.equal(out.ok, true, `${run}: ${JSON.stringify(out)}`);
      assert.deepEqual(out.results.map((r) => r.name).sort(), [...names].sort(), `${run}: the browser reports exactly the seven`);
      for (const r of out.results) {
        assert.ok(node[run].results.has(r.name), `necro check ledger (${run}) reported no result for "${r.name}"`);
        assert.equal(r.result, node[run].results.get(r.name), `${run}: ${idOf(r.name)} is ${r.result} in the browser and ${node[run].results.get(r.name)} in Node.js`);
      }
    }
  });
});

// ---- R13.8 ----

test('R13.8 a hash failure, a copy that cannot be loaded, a worker that cannot start and a run that takes too long each end in one plain sentence with the gate\'s full run from the receipts, never "running"', async () => {
  const FULL = { planted: { passed: 9, failed: 9, total: 18 }, fixed: { passed: 18, failed: 0, total: 18 } };

  // A hash failure, for each run.
  const settle = onDisk('src/settle.js').toString('utf8');
  for (const run of ['planted', 'fixed']) {
    await withBrowser({ change: (rel) => (rel === 'play/src/settle.js' ? `${settle}\n// changed\n` : null) }, async ({ evaluate }) => {
      const { out, heard } = await evaluate(play(run));
      assert.equal(out.ok, false, `${run}: ${JSON.stringify(out)}`);
      assert.equal(out.kind, 'hash');
      assert.ok(oneSentence(out.message) && out.message.includes('src/settle.js'), out.message);
      assert.deepEqual(out.full, FULL[run], `${run}: the full run of the gate, from the receipt for the step`);
      assert.deepEqual(heard, []);
    });
  }

  // A copy that cannot be loaded.
  await withBrowser({ change: (rel) => (rel === 'play/src/report.js' ? { status: 404 } : null) }, async ({ evaluate }) => {
    const { out } = await evaluate(play('fixed'));
    assert.equal(out.ok, false);
    assert.equal(out.kind, 'fetch');
    assert.ok(oneSentence(out.message) && out.message.includes('src/report.js'), out.message);
    assert.deepEqual(out.full, FULL.fixed);
  });

  await withBrowser({}, async ({ evaluate }) => {
    // A worker that cannot start: its script does not exist.
    for (const run of ['planted', 'fixed']) {
      const { out, posted } = await evaluate(play(run, `workerUrl: '${LIB}no-such-worker.js'`));
      assert.equal(out.ok, false, `${run}: ${JSON.stringify(out)}`);
      assert.equal(out.kind, 'start');
      assert.ok(oneSentence(out.message), out.message);
      assert.deepEqual(out.full, FULL[run]);
      assert.deepEqual(posted, []);
    }
    // A worker that is not a module worker script at all (a syntax error) cannot start either.
  });

  // A run that takes too long: a worker that never answers and never returns. The page stops it and says so.
  await withBrowser(
    { change: (rel) => (rel === 'lib/play-hang.js' ? 'self.addEventListener("message", () => { for (;;) {} });\n' : null) },
    async ({ evaluate }) => {
      const { out, took } = await evaluate(play('planted', `workerUrl: '${LIB}play-hang.js', timeoutMs: 600`));
      assert.equal(out.ok, false, JSON.stringify(out));
      assert.equal(out.kind, 'timeout');
      assert.ok(oneSentence(out.message) && /longer than 0\.6 seconds/.test(out.message), out.message);
      assert.deepEqual(out.full, FULL.planted);
      assert.ok(took < 6000, `the page gave up after ${Math.round(took)} ms`);
    },
  );

  // The limit in the code is ten seconds.
  await withBrowser({}, async ({ evaluate }) => {
    const limit = await evaluate(`import('${LIB}play-loader.js').then((m) => m.PLAY_TIMEOUT_MS)`);
    assert.equal(limit, 10_000);
  });
});
