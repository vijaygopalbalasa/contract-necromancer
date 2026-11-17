// Contracts for the play as the page shows it: R13.2 to R13.5 (what each step shows), R13.8 (a run that cannot finish), R13.9
// (the start control and where the play opens) and R13.10 (keyboard, announcements, motion, phone width, policy, origin).
//
// Every contract here drives the real page, index.html with site/app.js, in a headless Chrome or Chromium, and the real
// worker behind it. The file serves site/ the way GitHub Pages does: from a server on 127.0.0.1 whose pages sit under
// /contract-necromancer/, with no Content-Security-Policy header on any response, so the page's own policy is the one in its
// meta tag and the worker has none, as in production. The browser is driven over the DevTools protocol with Node's built-in
// WebSocket, no dependencies, and keys are pressed with real key events. Set CHROME_PATH if the browser is somewhere
// unusual. With no browser (Requirement 16.7) a test skips with a reason that starts with "cannot run:"; a skip is never a pass.
//
// What each step must show is taken from the receipts, not typed in here: the buried sample and the risen receipt give the
// 9 failing and the 18 passing, and the risen receipt gives the pinned files. R13.7 (the browser result equals necro check)
// and R13.1 and R13.4 (the files and the one-byte line) are in play-run.contract.test.js and play-files.contract.test.js.
//
// There is no shared helper file (a helper would not be frozen), so the browser code is carried in this file. The site
// modules are named below the way a static import would name them, because the receipt pins files it finds that way. Keep
// these lines.
//   import {} from '../../site/app.js';
//   import {} from '../../site/lib/play.js';
//   import {} from '../../site/lib/play-loader.js';
//   import {} from '../../site/lib/play-worker.js';
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
const PREFIX = '/contract-necromancer/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const SEVEN = ['R2.1', 'R2.2', 'R5.1', 'R5.2', 'R5.3', 'R5.4', 'R5.5'];
const TWO_FILES = ['contracts/ledger/requirement-2-split.contract.test.js', 'contracts/ledger/properties.contract.test.js'];
const MISMATCH = 'MISMATCH. Files changed: src/split.js.';
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'";
const STAND_INS = 'The browser runs the contracts with small stand-ins for node:test and node:assert, while the gate runs them in Node.js.';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const BURIED = readJson(path.join(SITE, 'sample-buried.json'));
const RISEN = readJson(path.join(SITE, 'play', 'risen-receipt.json'));
const HTML = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const countOf = (receipt) => {
  const failed = receipt.contracts.filter((c) => c.result === 'fail').length;
  return { failed, passed: receipt.contracts.length - failed, total: receipt.contracts.length };
};
const FULL = { planted: countOf(BURIED), fixed: countOf(RISEN) };
// Every file the risen receipt pins, once per path, as the page re-hashes them.
const RISEN_PINS = new Set([RISEN.requirements.path, ...RISEN.contracts.map((c) => c.path), ...RISEN.sources.map((s) => s.path), RISEN.runners.path, ...RISEN.frozen.map((f) => f.path)]);
// The criterion ids of the failing contracts of a receipt, in criterion order, as the full-run line names them.
const failingIds = (receipt) =>
  receipt.contracts
    .filter((c) => c.result === 'fail')
    .map((c) => /^R(\d+)\.(\d+)/.exec(c.name))
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .map((m) => m[0]);
const idList = (ids) => (ids.length < 2 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`);
const FAILING = { planted: failingIds(BURIED), fixed: failingIds(RISEN) };
// "9 of 18 failing: R2.1, ... and R5.4" for the planted change, "18 of 18 passing" for the fix. It names what failed.
const fullLine = (n, ids = []) =>
  `The gate's full run on the same code gave ${n.failed === 0 ? `${n.passed} of ${n.total} passing` : `${n.failed} of ${n.total} failing: ${idList(ids)}`}.`;
const scopeLine = (n) =>
  `The browser ran 7 of the ledger's ${n.total} contracts. The other ${n.total - 7} start the ledger's command line, which a browser cannot do.`;

// Requirement 16.7: when CHROME_PATH is set only that path is tried; otherwise the usual macOS, Linux and Windows install
// paths, then the folders of PATH. A machine with no browser gives null, and every test that needs one skips (NO_BROWSER).
function findBrowser() {
  const isFile = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (process.env.CHROME_PATH) return isFile(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const windows = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap((base) => [
    path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(base, 'Chromium', 'Application', 'chrome.exe'),
    path.join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
  const fixed = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    ...windows,
  ];
  for (const p of fixed) if (isFile(p)) return p;
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge'];
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) for (const extension of extensions) if (isFile(path.join(dir, name + extension))) return path.join(dir, name + extension);
  }
  return null;
}

// What a missing browser looks like to the gate: a skip whose reason starts with "cannot run:" (necro-core 6.17).
const NO_BROWSER = findBrowser() ? false : 'cannot run: no Chrome or Chromium found (set CHROME_PATH)';

// Serve site/ under /contract-necromancer/. No response carries a Content-Security-Policy header. `change(rel)` may replace
// a file: it returns text to serve in its place, { status } to answer with that status, or null to serve the file on disk.
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
    if (changed && typeof changed === 'object' && changed.status) return send(changed.status, 'text/plain', 'changed');
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

// Start a headless browser and the site server. `browser.open(settings)` opens the real page in a fresh tab and gives
// { evaluate, key }. `evaluate(expression)` runs an expression in the page (it may be async). `key(name)` presses a key
// with a real key event. `browser.requests` lists what the server was asked for.
async function withBrowser({ change = () => null } = {}, run) {
  const chrome = findBrowser();
  if (!chrome) {
    throw new Error(NO_BROWSER);
  }
  const requests = [];
  const server = await serveSite(requests, change);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-page-'));
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
  try {
    let endpoint = null;
    for (let i = 0; i < 200 && !endpoint; i += 1) {
      try {
        const [port, wsPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n');
        if (port && wsPath) endpoint = `ws://127.0.0.1:${port}${wsPath}`;
      } catch {
        // Not there yet. A file that exists but is not fully written is not there either.
      }
      if (!endpoint) await sleep(100);
    }
    if (!endpoint) throw new Error('The browser did not start. Check that it runs headless, then run this again.');
    client = connect(endpoint);
    await client.opened;

    const browser = {
      origin,
      requests,
      async open({ width, height, mobile = false, reducedMotion = null, scripts = true, settle = true }, use) {
        const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
        const call = (method, params) => client.send(method, params, sessionId);
        try {
          await call('Page.enable');
          await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
          await call('Emulation.setFocusEmulationEnabled', { enabled: true });
          if (reducedMotion !== null) {
            await call('Emulation.setEmulatedMedia', {
              features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }],
            });
          }
          if (!scripts) await call('Emulation.setScriptExecutionDisabled', { value: true });
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
          const key = async (name) => {
            const keys = { Enter: { code: 'Enter', vk: 13, text: '\r' }, Tab: { code: 'Tab', vk: 9, text: '' } };
            const k = keys[name];
            await call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: k.code, windowsVirtualKeyCode: k.vk, ...(k.text ? { text: k.text } : {}) });
            await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: k.code, windowsVirtualKeyCode: k.vk });
          };
          if (scripts && settle) {
            let shown = false;
            for (let i = 0; i < 100 && !shown; i += 1) {
              shown = await evaluate("(() => { const v = document.getElementById('verdict'); return !!v && !v.hidden && v.textContent.trim() !== ''; })()");
              if (!shown) await sleep(100);
            }
            if (!shown) throw new Error('The page did not show a receipt within 10 seconds.');
            await evaluate("document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).forEach((a) => a.finish())");
          }
          return await use({ evaluate, key });
        } finally {
          await client.send('Target.closeTarget', { targetId }).catch(() => {});
        }
      },
    };
    return await run(browser);
  } finally {
    if (client) client.close();
    child.kill('SIGKILL');
    server.closeAllConnections();
    server.close();
    await sleep(100);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const DESKTOP = { width: 1280, height: 800, mobile: false };
const PHONE = { width: 390, height: 844, mobile: true };

// Revised Nov 17 after review: "visible" means visible, not only "has a box". This function is sent into the page as text
// (Function.prototype.toString), so it uses nothing from this file. An element is shown when it has a client rect with a box,
// when it and every ancestor have computed visibility "visible", opacity "1", clip "auto" and clip-path "none", when its own
// text is not transparent and it is not drawn beside the page, and when nothing of it is cut off by its own box (the page's
// own .sr-only rules cut a box down to a point). It pins no number and no font size.
function shownInPage(e) {
  if (!e) return false;
  const first = e.getClientRects()[0];
  if (!first || !(first.width > 0) || !(first.height > 0)) return false;
  for (let n = e; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.visibility !== 'visible' || s.opacity !== '1' || s.clip !== 'auto' || s.clipPath !== 'none') return false;
  }
  const color = getComputedStyle(e).color;
  // Read the alpha itself: an opaque rgb(r, g, b) with a blue channel of 0 (gold) is shown; rgba(..., 0) and a slash alpha of 0 are not.
  const alpha = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(color) || /\/\s*([\d.]+)\s*\)$/.exec(color);
  if (color === 'transparent' || (alpha && Number(alpha[1]) === 0)) return false;
  if (!(first.right > 0) || !(first.left < document.documentElement.clientWidth)) return false;
  return e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1;
}

// Helpers that run in the page: wait for a condition, and read a step's result place.
const IN_PAGE = `
  const wait = async (ok, ms = 20000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (ok()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const cls = (e) => e.className.split(/\\s+/);
  const snap = (id) => {
    const box = document.getElementById(id);
    return {
      hidden: box.hidden,
      busy: box.getAttribute('aria-busy'),
      text: box.innerText.replace(/[ \\t]+/g, ' ').trim(),
      rows: [...box.querySelectorAll('li.contract')].map((li) => ({
        id: /R\\d\\.\\d/.exec(li.textContent)[0],
        state: cls(li).includes('fail') ? 'fail' : 'pass',
        word: li.querySelector('.state').textContent,
        name: li.querySelector('.name').textContent,
        note: (li.querySelector('.note') || { textContent: '' }).textContent.trim(),
      })),
      files: [...box.querySelectorAll('li.file')].map((li) => ({
        cls: li.className,
        word: li.querySelector('.state').textContent,
        path: li.querySelector('.path').textContent,
      })),
      badges: [...box.querySelectorAll('.badge')].map((b) => b.textContent),
    };
  };
  const step = async (button, result) => {
    document.getElementById(button).click();
    const done = await wait(() => !document.getElementById(result).hidden && !document.getElementById(button).disabled);
    return { done, ...snap(result) };
  };
`;
const inPage = (body) => `(async () => { ${IN_PAGE} ${body} })()`;
const STEPS = { planted: ['play-send', 'play-result-planted'], fixed: ['play-fix', 'play-result-fixed'], byte: ['play-byte', 'play-result-byte'] };
const openAndStep = (kind) => inPage(`document.getElementById('strip-play').click(); return await step(${JSON.stringify(STEPS[kind][0])}, ${JSON.stringify(STEPS[kind][1])});`);

// Revised Nov 18 (13.2): the verdict line of a refused run, and the line the R2.1 row shows on its own. The verdict words are
// checked only in the R13.2 and R13.3 tests, never in an R13.5 test.
const REFUSED_VERDICT = 'Refused. 1000 cents split three ways paid out 999.';
const ANN_LINE = 'Ann should get 334.';

const oneSentence = (text) => typeof text === 'string' && /\S/.test(text) && !text.includes('\n');

// ---- R13.2 ----

test('R13.2 on the page, sending the tick with the planted change shows the tick refused: R2.1, R2.2 and R5.1 to R5.4 as gravestones with their assertion messages, R5.5 alive, drawn like the receipt rows', { skip: NO_BROWSER }, async () => {
  await withBrowser({}, async (browser) => {
    await browser.open(DESKTOP, async ({ evaluate }) => {
      // Rows in the receipt card, for comparison: open the buried sample, which has both kinds.
      await evaluate(`document.getElementById('sample-buried').click()`);
      await evaluate(inPage(`await wait(() => /Still buried/.test(document.getElementById('verdict').textContent)); return true;`));
      const style = (selector) =>
        evaluate(`(() => {
          const li = document.querySelector(${JSON.stringify(selector)});
          const s = getComputedStyle(li);
          const state = getComputedStyle(li.querySelector('.state'));
          return ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'backgroundColor', 'borderLeftColor', 'borderLeftWidth', 'borderBottomWidth', 'boxShadow'].map((k) => s[k]).concat([state.color, state.textAlign, state.display]);
        })()`);
      const receiptFail = await style('#groups li.contract.fail');
      const receiptPass = await style('#groups li.contract.pass');

      const out = await evaluate(openAndStep('planted'));
      assert.ok(out.done, 'the step finished');
      assert.match(out.text, /^Refused\./, out.text);
      // Revised Nov 18 (13.2): the verdict says what the planted change does, not how many of the browser's contracts fail.
      assert.equal(out.text.split('\n')[0].trim(), REFUSED_VERDICT, 'the refused result opens with the verdict line of 13.2');
      assert.deepEqual(out.rows.map((r) => r.id), SEVEN, 'seven rows in the fixed order');
      assert.deepEqual(
        Object.fromEntries(out.rows.map((r) => [r.id, r.state])),
        { 'R2.1': 'fail', 'R2.2': 'fail', 'R5.1': 'fail', 'R5.2': 'fail', 'R5.3': 'fail', 'R5.4': 'fail', 'R5.5': 'pass' },
      );
      for (const r of out.rows) assert.equal(r.word, r.state === 'fail' ? 'FAIL' : 'PASS', `${r.id} says its state in words`);
      for (const r of out.rows.filter((x) => x.state === 'fail')) assert.ok(r.note.length > 0, `${r.id} shows its assertion message`);
      assert.equal(out.rows.find((r) => r.id === 'R5.5').note, '', 'a passing row has no message');
      // The names are the ones the buried sample lists for those two files.
      const listed = BURIED.contracts.filter((c) => TWO_FILES.includes(c.path)).map((c) => c.name).sort();
      assert.deepEqual(out.rows.map((r) => r.name).sort(), listed);

      // Same gravestone and alive styles as the receipt rows.
      const playFail = await style('#play-result-planted li.contract.fail');
      const playPass = await style('#play-result-planted li.contract.pass');
      assert.deepEqual(playFail, receiptFail, 'a failing play row is drawn like a failing receipt row');
      assert.deepEqual(playPass, receiptPass, 'a passing play row is drawn like a passing receipt row');
      assert.ok(Number.parseFloat(playFail[0]) > Number.parseFloat(playFail[2]), 'the failing row has an arched top');
      assert.match(playPass[8], /rgb\(125, 255, 179\)/, 'the passing row glows in the alive colour');
    });
  });
});

test('R13.2 a failing row on the page shows its contract name and at most the first three lines of its assertion message, with the full message behind a details element in that row; a passing row stays one line of state and name', { skip: NO_BROWSER }, async () => {
  await withBrowser({}, async (browser) => {
    for (const screen of [DESKTOP, PHONE]) {
      await browser.open(screen, async ({ evaluate }) => {
        await evaluate(openAndStep('planted'));
        const rows = await evaluate(`[...document.querySelectorAll('#play-result-planted li.contract')].map((li) => {
          const note = li.querySelector('.note');
          const details = li.querySelector('details');
          const summary = details && details.querySelector('summary');
          return {
            id: /R\\d\\.\\d/.exec(li.textContent)[0],
            fail: li.classList.contains('fail'),
            kids: [...li.children].map((c) => c.tagName + '.' + c.className),
            note: note ? note.innerText : '',
            details: details ? { open: details.open, inside: li.contains(details), summary: summary.textContent, summaryHeight: summary.getBoundingClientRect().height, full: details.textContent.replace(summary.textContent, '').trim() } : null,
          };
        })`);
        const at = `${screen.width}x${screen.height}`;
        assert.equal(rows.length, 7);
        for (const r of rows.filter((x) => x.fail)) {
          const lines = r.note.split('\n').filter((l) => l.trim());
          assert.ok(lines.length >= 1 && lines.length <= 3, `${at} ${r.id}: ${lines.length} message lines`);
          assert.ok(r.details && r.details.inside, `${at} ${r.id}: the full message is behind a details element in the row`);
          assert.equal(r.details.open, false, `${at} ${r.id}: the details element starts closed`);
          assert.ok(r.details.summaryHeight >= 24, `${at} ${r.id}: the summary is ${r.details.summaryHeight} px tall`);
          assert.ok(r.details.full.length >= r.note.replace(/\.\.\.$/m, '').trim().length, `${at} ${r.id}: the full message is at least the preview`);
          assert.ok(r.details.full.startsWith(lines[0]), `${at} ${r.id}: the full message begins with the first line`);
        }
        // At least one real message is longer than three lines, so the details element holds something the row leaves out.
        assert.ok(rows.some((x) => x.fail && x.details && x.details.full.split('\n').filter((l) => l.trim()).length > 3), `${at}: a long message is cut and kept whole behind the details element`);
        const alive = rows.find((x) => !x.fail);
        assert.deepEqual(alive.kids, ['SPAN.state', 'SPAN.name'], `${at}: a passing row is a state and a name`);
        assert.equal(alive.details, null);
      });
    }
  });
});

// Added Nov 18 (13.2): after Send the tick the R2.1 row shows, on its own line outside the assertion message and with nothing to
// open, "Ann should get 334." in an element of its own (not inside .note, so the three-line preview above still counts only the
// message). It is drawn at both window sizes. After Apply the fix and send the tick the fix's result does not have it. The page
// keeps the refused result of the planted change on screen after the fix (each result has its own box), so this test reads the fix's
// own result; the requirement says the line SHALL NOT appear after the fix and does not say the earlier result is cleared.
test('R13.2 after Send the tick the R2.1 row shows "Ann should get 334." in an element of its own, outside the assertion message and with nothing to open, drawn at 1280x800 and 390x844, and the fix\'s result does not show it', { skip: NO_BROWSER }, async () => {
  await withBrowser({}, async (browser) => {
    for (const screen of [DESKTOP, PHONE]) {
      await browser.open(screen, async ({ evaluate }) => {
        const at = `at ${screen.width}`;
        const read = (id) => evaluate(`(() => {
          const shownInPage = ${shownInPage.toString()};
          const box = document.getElementById(${JSON.stringify(id)});
          const rows = [...box.querySelectorAll('li.contract')];
          const row = rows.find((li) => /R\\d\\.\\d/.exec(li.textContent)[0] === 'R2.1') || null;
          const leaves = [...box.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent === ${JSON.stringify(ANN_LINE)});
          const mine = leaves.filter((e) => !!row && row.contains(e) && e !== row);
          const leaf = mine[0] || null;
          return {
            rows: rows.length,
            hasRow: !!row,
            leaves: leaves.length,
            inRow: mine.length,
            inNote: !!leaf && !!leaf.closest('.note'),
            inDetails: !!leaf && !!leaf.closest('details'),
            isSummary: !!leaf && leaf.tagName === 'SUMMARY',
            shown: shownInPage(leaf),
            rowLines: row ? row.innerText.split('\\n').map((l) => l.trim()).filter(Boolean) : [],
            boxLines: box.innerText.split('\\n').map((l) => l.trim()).filter(Boolean),
          };
        })()`);

        await evaluate(openAndStep('planted'));
        const planted = await read('play-result-planted');
        assert.ok(planted.hasRow, `${at}: the refused result has an R2.1 row`);
        assert.equal(planted.leaves, 1, `${at}: exactly one element in the refused result holds exactly "${ANN_LINE}" (found ${planted.leaves})`);
        assert.equal(planted.inRow, 1, `${at}: that element is inside the R2.1 row`);
        assert.ok(!planted.inNote, `${at}: it is not inside .note, the assertion message`);
        assert.ok(!planted.inDetails && !planted.isSummary, `${at}: it is not behind a details element, so there is nothing to open`);
        assert.ok(planted.rowLines.includes(ANN_LINE), `${at}: it is a line of its own in the row: ${JSON.stringify(planted.rowLines)}`);
        assert.ok(planted.shown, `${at}: it is drawn: a box, visible, opaque, not clipped, not cut off by its own box`);

        await evaluate(openAndStep('fixed'));
        const fixed = await read('play-result-fixed');
        assert.ok(fixed.hasRow, `${at}: the fix's result has an R2.1 row`);
        assert.equal(fixed.leaves, 0, `${at}: after the fix no element holds "${ANN_LINE}"`);
        assert.ok(!fixed.boxLines.some((l) => l.includes('Ann should get')), `${at}: after the fix the result does not say what Ann should get`);
      });
    }
  });
});

// ---- R13.3 ----

test('R13.3 on the page, applying the fix shows all seven alive, the tick accepted, and the risen receipt with its hash recomputed (MATCH) and every pinned file hashed again from the copies', { skip: NO_BROWSER }, async () => {
  await withBrowser({}, async (browser) => {
    await browser.open(DESKTOP, async ({ evaluate }) => {
      const out = await evaluate(openAndStep('fixed'));
      assert.ok(out.done);
      assert.match(out.text, /^Accepted\./, out.text);
      assert.match(out.text, /All 7 contracts the browser ran pass, so the tick is accepted\./);
      assert.deepEqual(out.rows.map((r) => r.id), SEVEN);
      assert.deepEqual(out.rows.map((r) => `${r.state} ${r.word}`), Array(7).fill('pass PASS'));
      assert.deepEqual(out.badges, ['MATCH'], 'the receipt hash, recomputed in the browser, matches');
      assert.equal(out.files.length, RISEN_PINS.size, 'one row per pinned file');
      assert.deepEqual(new Set(out.files.map((f) => f.path)), RISEN_PINS);
      for (const f of out.files) assert.ok(f.word === 'MATCH' && /status-match/.test(f.cls), `${f.path}: ${f.word}`);
      assert.match(out.text, new RegExp(`All ${RISEN_PINS.size} pinned files match their copies\\.`));
      // The list of pinned files starts closed, and its summary line says how many match.
      const pins = await evaluate(`(() => {
        const d = document.querySelector('#play-result-fixed details.play-pins');
        const sum = d.querySelector('summary');
        return { open: d.open, summary: sum.innerText.trim(), summaryHeight: sum.getBoundingClientRect().height, listShown: d.innerText.includes('src/split.js'), height: d.getBoundingClientRect().height };
      })()`);
      assert.equal(pins.open, false, 'the details element starts closed');
      assert.equal(pins.listShown, false, 'the 18 rows are not drawn');
      assert.match(pins.summary, new RegExp(`^All ${RISEN_PINS.size} pinned files match their copies\\.`), pins.summary);
      assert.ok(pins.summaryHeight >= 24 && pins.height < 60, `a closed list is ${pins.height} px tall`);
      await evaluate(`document.querySelector('#play-result-fixed details.play-pins summary').click()`);
      assert.equal(await evaluate(`document.querySelector('#play-result-fixed details.play-pins').open`), true, 'the summary opens the list');
      // The receipt is shown inside the play and not in the main receipt card.
      const card = await evaluate(`document.getElementById('receipt').textContent.includes(${JSON.stringify(RISEN.receiptHash)})`);
      assert.equal(card, false, 'the main receipt card still shows the first-visit sample');
    });
  });
});

// ---- R13.4 ----

test('R13.4 on the page, changing one byte of src/split.js shows exactly the line necro verify prints, MISMATCH. Files changed: src/split.js., and marks only that file as different', { skip: NO_BROWSER }, async () => {
  await withBrowser({}, async (browser) => {
    await browser.open(PHONE, async ({ evaluate }) => {
      const out = await evaluate(openAndStep('byte'));
      assert.ok(out.done);
      const lines = out.text.split('\n').map((l) => l.trim());
      assert.ok(lines.includes(MISMATCH), `the line stands alone in the result: ${JSON.stringify(lines)}`);
      assert.deepEqual(out.files.map((f) => [f.word, f.path]), [['DIFFERENT', 'src/split.js']], 'only the changed file has a row');
      assert.match(out.text, new RegExp(`${RISEN_PINS.size - 1} of ${RISEN_PINS.size} pinned files match their copies\\.`));
      assert.match(out.text, /Nothing was stored\./);
      // Nothing was stored: the copy on the server is the same afterwards.
      const again = await evaluate(inPage(`const r = await fetch('./play/src/split.js'); return new Uint8Array(await r.arrayBuffer()).length;`));
      assert.equal(again, fs.statSync(path.join(SITE, 'play', 'src', 'split.js')).size);
    });
  });
});

// ---- R13.5 ----

test('R13.5 next to each browser run the page says the browser ran 7 of the ledger\'s 18 contracts and the other 11 start the command line, with the gate\'s full run on the same code, naming what failed: 9 of 18 failing for the planted change, 18 of 18 passing for the fix, and all of it before the contract rows', { skip: NO_BROWSER }, async () => {
  assert.deepEqual(FULL, { planted: { failed: 9, passed: 9, total: 18 }, fixed: { failed: 0, passed: 18, total: 18 } }, 'the receipts say 9 failing of 18, and 18 passing');
  // The ids come from the receipts. They are also written out here, so a change in a receipt shows up as a failure.
  assert.deepEqual(FAILING, { planted: ['R2.1', 'R2.2', 'R3.1', 'R4.1', 'R4.2', 'R5.1', 'R5.2', 'R5.3', 'R5.4'], fixed: [] });
  // Revised Nov 17 (13.5): with the play open and before any button is pressed, a sentence directly before the play's steps
  // list says the browser runs N of the ledger's M contracts and the other M minus N need the ledger's command line. N and M
  // are then the numbers the play states after each run, so the two cannot drift.
  // Revised Nov 17 after review: 13.5 says the sentence is visible at every window width, so it is read at the desktop size and
  // at the phone size, and "drawn" is "shown" (a box, visible, not clipped, not transparent), not only "has a box".
  const reads = {};
  await withBrowser({}, async (browser) => {
    for (const screen of [DESKTOP, PHONE]) {
      await browser.open(screen, async ({ evaluate }) => {
        reads[screen.width] = await evaluate(`(() => {
        const shownInPage = ${shownInPage.toString()};
        const play = document.getElementById('play');
        const steps = play ? play.querySelector('ol') : null;
        const sentence = steps ? steps.previousElementSibling : null;
        const button = document.getElementById('play-send');
        const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return {
          width: innerWidth,
          open: !!play && !play.hidden && play.getClientRects().length > 0,
          pressed: [...document.querySelectorAll('#play-result-planted, #play-result-fixed, #play-result-byte')].filter((r) => !r.hidden).length,
          tag: sentence ? sentence.tagName : null,
          text: sentence ? sentence.textContent.replace(/\\s+/g, ' ').trim() : '',
          drawn: !!sentence && sentence.getClientRects().length > 0 && getComputedStyle(sentence).visibility === 'visible',
          shown: shownInPage(sentence),
          beforeFirstButton: !!sentence && !!button && follows(sentence, button),
          stepsContainsButton: !!steps && !!button && steps.contains(button),
        };
      })()`);
      });
    }
  });
  for (const screen of [DESKTOP, PHONE]) {
    const read = reads[screen.width];
    const at = `at ${screen.width}`;
    assert.equal(read.width, screen.width, `${at}: the window is ${screen.width} wide`);
    assert.ok(read.open, `${at}: the play is open on load`);
    assert.equal(read.pressed, 0, `${at}: no button has been pressed, so no result is shown yet`);
    assert.ok(read.stepsContainsButton && read.beforeFirstButton, `${at}: the sentence comes before the first button, in the play's steps list`);
    assert.equal(read.tag, 'P', `${at}: the element directly before the steps list is a paragraph`);
    assert.ok(read.drawn, `${at}: the sentence is drawn`);
    assert.ok(read.shown, `${at}: the sentence is shown, not only drawn: visible, opaque, not clipped, not cut off by its own box`);
  }
  assert.equal(reads[DESKTOP.width].text, reads[PHONE.width].text, 'the sentence reads the same at both window sizes');
  const before = reads[PHONE.width];
  const claim = /\bbrowser runs (\d+) of the ledger's (\d+) contracts\b[^.]*\bother (\d+) need the ledger's command line\b/i.exec(before.text);
  assert.ok(claim, `the sentence says the browser runs N of the ledger's M contracts and the other M minus N need the ledger's command line: "${before.text}"`);
  const [n, m, rest] = claim.slice(1).map(Number);
  assert.equal(before.text.split(/(?<=[.!?])\s+/).length, 1, 'it is one sentence');
  assert.equal(n, SEVEN.length, 'N is the seven contracts the browser runs');
  assert.equal(m, FULL.planted.total, "M is the number of the ledger's contracts, as the receipts give it");
  assert.equal(rest, m - n, 'the other contracts are M minus N');
  assert.ok(!/[\u2013\u2014]/.test(before.text), 'no em or en dashes');

  await withBrowser({}, async (browser) => {
    await browser.open(PHONE, async ({ evaluate }) => {
      for (const kind of ['planted', 'fixed']) {
        const out = await evaluate(openAndStep(kind));
        assert.ok(out.done, kind);
        const lines = out.text.split('\n').map((l) => l.trim());
        assert.ok(lines.includes(scopeLine(FULL[kind])), `${kind}: the scope sentence is there, text was ${out.text}`);
        // The sentence after the run states the numbers of the sentence before it (13.5, revised Nov 17).
        const after = lines.map((l) => /^The browser ran (\d+) of the ledger's (\d+) contracts\. The other (\d+) start the ledger's command line/.exec(l)).find(Boolean);
        assert.ok(after, `${kind}: the sentence after the run gives N, M and the rest`);
        assert.deepEqual(after.slice(1).map(Number), [n, m, m - n], `${kind}: the numbers after the run equal N, M and M minus N of the sentence before it`);
        assert.ok(lines.includes(fullLine(FULL[kind], FAILING[kind])), `${kind}: the full run of the gate is there, text was ${out.text}`);
        const at = (s) => out.text.indexOf(s);
        assert.ok(at(scopeLine(FULL[kind])) < at(fullLine(FULL[kind], FAILING[kind])), `${kind}: the full run comes right after the scope sentence`);
        assert.ok(!/[\u2013\u2014]/.test(out.text), 'no em or en dashes');
        // The named result, as the instruction words it.
        const named = kind === 'planted' ? '9 of 18 failing: R2.1, R2.2, R3.1, R4.1, R4.2, R5.1, R5.2, R5.3 and R5.4' : '18 of 18 passing';
        assert.ok(out.text.includes(named), `${kind}: the full-run line says "${named}"`);
        // Order in the result: the verdict line, the 7 of 18 sentence, the full-run line, and only then the contract rows.
        const verdictAt = out.text.search(/^(Refused|Accepted)\./);
        const firstRow = out.text.search(/\b(FAIL|PASS)\s/);
        assert.equal(verdictAt, 0, `${kind}: the verdict line comes first`);
        assert.ok(at(scopeLine(FULL[kind])) > verdictAt && at(fullLine(FULL[kind], FAILING[kind])) < firstRow, `${kind}: the rows come after the full-run line`);
        const order = await evaluate(inPage(`
          const box = document.getElementById(${JSON.stringify(STEPS[kind][1])});
          return [...box.children].slice(0, 4).map((c) => c.className.split(' ')[0]);`));
        assert.deepEqual(order, ['play-verdict', 'play-scope', 'play-full', 'contracts'], `${kind}: the first children of the result`);
      }
    });
  });
});

// ---- R13.9 and R13.10: how the play and its start control look ----

test('R13.10 the status line that repeats each result is visually hidden but stays in the polite live region, and the play opens with a small margin above its heading', { skip: NO_BROWSER }, async () => {
  await withBrowser({}, async (browser) => {
    await browser.open({ ...DESKTOP, reducedMotion: true }, async ({ evaluate }) => {
      const before = await evaluate(`(() => {
        document.getElementById('strip-play').click();
        const b = document.getElementById('play').getBoundingClientRect();
        const h = document.getElementById('play-title').getBoundingClientRect();
        return { margin: getComputedStyle(document.getElementById('play')).scrollMarginTop, playTop: b.top, headingTop: h.top, scrollY };
      })()`);
      assert.ok(Number.parseFloat(before.margin) >= 8 && Number.parseFloat(before.margin) <= 48, `scroll margin ${before.margin}`);
      assert.ok(before.scrollY > 0, 'the page scrolled to the play');
      assert.ok(before.playTop >= 8 && before.playTop <= 48, `the play starts ${before.playTop} px from the top of the window, not flush against it`);
      assert.ok(before.headingTop > before.playTop, 'the heading is inside the box');
      const out = await evaluate(openAndStep('planted'));
      assert.ok(out.done);
      const live = await evaluate(`(() => {
        const e = document.getElementById('play-status');
        const s = getComputedStyle(e);
        const b = e.getBoundingClientRect();
        return { text: e.textContent, live: e.getAttribute('aria-live'), role: e.getAttribute('role'), w: b.width, h: b.height, position: s.position, clip: s.clip, overflow: s.overflow, display: s.display, visibility: s.visibility, hiddenAttr: e.hidden, inBox: document.getElementById('play').contains(e) };
      })()`);
      assert.match(live.text, /^Step 1 done: the gate refuses the tick\./, 'the words are still there');
      assert.equal(live.live, 'polite');
      assert.equal(live.role, 'status');
      assert.ok(live.w <= 1 && live.h <= 1, `it is ${live.w} x ${live.h}, not drawn`);
      assert.equal(live.position, 'absolute');
      assert.match(live.clip, /rect\(0(px)?, 0(px)?, 0(px)?, 0(px)?\)/);
      assert.equal(live.overflow, 'hidden');
      assert.notEqual(live.display, 'none', 'display none would stop it being announced');
      assert.equal(live.visibility, 'visible');
      assert.equal(live.hiddenAttr, false);
      assert.ok(live.inBox);
    });
  });
});

// ---- R13.8 ----

test('R13.8 on the page, a worker that cannot start, a copy that fails its hash check and a run that takes too long each end in one plain sentence and the gate\'s full run, the buttons come back and nothing says running', { skip: NO_BROWSER }, async () => {
  const check = async (evaluate, kind, expectedSentence) => {
    const out = await evaluate(openAndStep(kind));
    assert.ok(out.done, `${kind}: the step ended`);
    assert.equal(out.busy, 'false', `${kind}: the result is no longer busy`);
    const lines = out.text.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.match(lines[0], /^Stopped\. /, `${kind}: ${out.text}`);
    const sentence = lines[0].replace(/^Stopped\.\s*/, '');
    assert.ok(oneSentence(sentence) && /[.]$/.test(sentence), `${kind}: one plain sentence: ${sentence}`);
    assert.match(sentence, expectedSentence, `${kind}: ${sentence}`);
    assert.deepEqual(out.rows, [], `${kind}: no result rows for a run that did not happen`);
    assert.ok(lines.includes(fullLine(FULL[kind], FAILING[kind])), `${kind}: the gate's full run for this step is shown`);
    assert.ok(!lines.some((l) => scopeLine(FULL[kind]) === l), `${kind}: the browser ran nothing, so the page does not say it ran 7`);
    const after = await evaluate(`({
      disabled: ['play-send', 'play-fix', 'play-byte'].map((id) => document.getElementById(id).disabled),
      play: document.getElementById('play').innerText,
      status: document.getElementById('play-status').textContent,
    })`);
    assert.deepEqual(after.disabled, [false, false, false], `${kind}: the buttons come back`);
    assert.doesNotMatch(after.play, /running/i, `${kind}: no step is left running`);
    assert.doesNotMatch(after.status, /running/i);
    assert.match(after.status, /stopped/i, `${kind}: the live region says the step stopped`);
    return out;
  };

  // A worker that cannot start: its script is not there.
  await withBrowser({ change: (rel) => (rel === 'lib/play-worker.js' ? { status: 404 } : null) }, async (browser) => {
    await browser.open(DESKTOP, async ({ evaluate }) => {
      await check(evaluate, 'planted', /could not start the worker/);
      await check(evaluate, 'fixed', /could not start the worker/);
    });
  });

  // A copy whose hash does not match the pin: refused before anything runs, for both runs.
  const settle = fs.readFileSync(path.join(SITE, 'play', 'src', 'settle.js'), 'utf8');
  await withBrowser({ change: (rel) => (rel === 'play/src/settle.js' ? `${settle}\n// changed\n` : null) }, async (browser) => {
    await browser.open(PHONE, async ({ evaluate }) => {
      await check(evaluate, 'planted', /src\/settle\.js/);
      const fixed = await check(evaluate, 'fixed', /src\/settle\.js/);
      // The page also hashes the copies for the receipt, and says which one differs.
      assert.ok(fixed.files.some((f) => f.path === 'src/settle.js' && f.word === 'DIFFERENT'));
    });
  });

  // A run that takes too long: a worker that never answers. The page stops it after ten seconds.
  await withBrowser({ change: (rel) => (rel === 'lib/play-worker.js' ? 'self.addEventListener("message", () => { for (;;) {} });\n' : null) }, async (browser) => {
    await browser.open(DESKTOP, async ({ evaluate }) => {
      const began = Date.now();
      await check(evaluate, 'planted', /longer than 10 seconds/);
      const took = Date.now() - began;
      assert.ok(took >= 9000 && took < 20000, `the page stopped the run after ${took} ms`);
    });
  });
});

// ---- R13.9 ----

test('R13.9 (revised Nov 16) with scripts on a start control is drawn in the first screen at 1280x800 and 390x844, at least 24 by 24, beside the command; the play is already open directly after the result element, and using the control moves focus to Send the tick with the play in the window', { skip: NO_BROWSER }, async () => {
  await withBrowser({}, async (browser) => {
    for (const screen of [DESKTOP, PHONE]) {
      await browser.open(screen, async ({ evaluate }) => {
        const m = await evaluate(`(() => {
          const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
          const control = document.getElementById('strip-play');
          return {
            w: innerWidth, h: innerHeight, scrollY, sideways: document.documentElement.scrollWidth,
            text: control.textContent.trim(), display: getComputedStyle(control).display,
            control: r('strip-play'), copy: r('strip-copy'), command: r('strip-command'), strip: r('strip'), verdict: r('verdict'),
            playDisplay: getComputedStyle(document.getElementById('play')).display,
          };
        })()`);
        const at = `${screen.width}x${screen.height}`;
        // Revised Nov 17 after review: under mobile emulation Chrome widens innerWidth when a page is wider than the window, so
        // the sideways check below only means something when the window is the width that was asked for.
        assert.equal(m.w, screen.width, `${at}: the window is ${screen.width} wide (it is ${m.w}, so the page is wider than the window)`);
        assert.notEqual(m.display, 'none', `${at}: the control is drawn`);
        assert.equal(m.text, 'Try it here');
        assert.notEqual(m.playDisplay, 'none', `${at}: the play is already open on a first visit (Requirement 16.1)`);
        assert.ok(m.control.width >= 24 && m.control.height >= 24, `${at}: the control is ${m.control.width} x ${m.control.height}`);
        assert.ok(m.copy.width >= 24 && m.copy.height >= 24, `${at}: the copy button is ${m.copy.width} x ${m.copy.height}`);
        assert.ok(m.control.top >= 0 && m.control.bottom <= m.h && m.control.left >= 0 && m.control.right <= m.w, `${at}: the control is inside the first screen`);
        assert.ok(m.control.top >= m.strip.top && m.control.bottom <= m.strip.bottom, `${at}: the control is inside the story strip`);
        const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        assert.ok(!overlap(m.control, m.copy) && !overlap(m.control, m.command), `${at}: the control overlaps its neighbours`);
        // Requirement 9.5 revised Nov 16: the banner follows the open play and is not required in the first screen.
        assert.ok(m.sideways <= m.w, `${at}: the page scrolls sideways`);

        // Use it: the play is already open directly after the result element (DOM order, not distance), above the banner. The
        // control moves focus to the play's first step, Send the tick, and the play's heading and that button are in the window.
        const o = await evaluate(`(async () => {
          const before = document.getElementById('play').hidden;
          document.getElementById('strip-play').click();
          const seen = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.top >= 0 && b.bottom <= innerHeight; };
          // The page may scroll smoothly: give it up to two seconds to arrive.
          for (let i = 0; i < 40 && !(seen('play-title') && seen('play-send')); i += 1) await new Promise((r) => setTimeout(r, 50));
          const doc = (a, b) => (document.getElementById(a).compareDocumentPosition(document.getElementById(b)) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
          return { before, strip: doc('strip', 'evidence'), next: document.getElementById('evidence').nextElementSibling === document.getElementById('play'),
            beforeBanner: doc('play', 'verdict'), focus: document.activeElement.id, headingSeen: seen('play-title'), sendSeen: seen('play-send'),
            expanded: document.getElementById('strip-play').getAttribute('aria-expanded'), heading: document.getElementById('play-title').textContent };
        })()`);
        assert.equal(o.before, false, `${at}: the play is open before the control is used`);
        assert.ok(o.strip && o.next, `${at}: the play is directly after the result element, which is after the story strip`);
        assert.ok(o.beforeBanner, `${at}: the play comes before the banner`);
        assert.equal(o.focus, 'play-send', `${at}: focus goes to the Send the tick button`);
        assert.ok(o.headingSeen && o.sendSeen, `${at}: the play's heading and Send the tick are in the window after the control is used`);
        assert.equal(o.expanded, 'true');
        assert.ok(o.heading.length > 0);
      });
    }
    // With scripts off the page says nothing about the play: no button that does nothing.
    for (const screen of [DESKTOP, PHONE]) {
      await browser.open({ ...screen, scripts: false, settle: false }, async ({ evaluate }) => {
        const m = await evaluate(`({
          control: getComputedStyle(document.getElementById('strip-play')).display,
          play: getComputedStyle(document.getElementById('play')).display,
          command: document.getElementById('strip-command').getBoundingClientRect().height > 0,
          copy: document.getElementById('strip-copy').getBoundingClientRect().height > 0,
        })`);
        assert.deepEqual(m, { control: 'none', play: 'none', command: true, copy: true }, `${screen.width}`);
      });
    }
  });
});

test('R13.9 (revised Nov 16) the contracts for Requirements 9, 10, 11 and 12 are pinned by the lock and equal their pins, and the R9.5 contract passes on its own against this page', { skip: NO_BROWSER }, () => {
  // The lock pins each of these files and each file equals its pin. necro freeze re-pins every contract file of the spec, so
  // these comparisons pass from the freeze on. Until a person freezes receipt-viewer again they are EXPECTED to fail for
  // every file revised on Nov 16: that is the review step, not a bug. Do not drop them.
  const lock = readJson(path.join(ROOT, '.necro', 'lock.json'));
  const pins = lock.specs?.['receipt-viewer']?.contracts ?? [];
  const files = ['above-fold-v2', 'first-visit', 'story', 'jump', 'first-screen', 'first-screen-v3', 'evidence', 'clean'];
  for (const name of files) {
    const rel = `contracts/receipt-viewer/${name}.contract.test.js`;
    const pin = pins.find((c) => c.path === rel);
    assert.ok(pin, `the lock pins ${rel}`);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex'), pin.sha256, `${rel} is not the file the lock pins; a person freezes receipt-viewer again after reviewing it`);
  }
  // Only the R9.5 file runs as a child, as it was frozen. It starts a browser itself, which is why this test skips with no browser.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  const run = spawnSync(process.execPath, ['--test', 'contracts/receipt-viewer/above-fold-v2.contract.test.js'], { cwd: ROOT, encoding: 'utf8', env });
  assert.equal(run.status, 0, `the R9.5 contract fails:\n${run.stdout.slice(-4000)}${run.stderr.slice(-2000)}`);
});

// ---- R13.10 ----

test('R13.10 the play works with the keyboard alone: Tab reaches the start control, Enter on it moves focus into the open play and Enter runs each step, focus moves to each result, and a polite live region announces it', { skip: NO_BROWSER }, async () => {
  await withBrowser({}, async (browser) => {
    await browser.open(DESKTOP, async ({ evaluate, key }) => {
      const active = () => evaluate('document.activeElement.id');
      // Tab from the copy button reaches the start control: it is the next stop.
      await evaluate(`document.getElementById('strip-copy').focus()`);
      await key('Tab');
      assert.equal(await active(), 'strip-play', 'Tab from Copy reaches the start control');
      await key('Enter');
      assert.equal(await evaluate(`document.getElementById('play').hidden`), false, 'the play is open');
      assert.equal(await active(), 'play-send', 'focus moves to the first step, the Send the tick button (13.9 as revised Nov 16)');

      // Tab order inside the play follows the page: step 1, step 2, step 3.
      await key('Tab');
      assert.equal(await active(), 'play-fix');
      await key('Tab');
      assert.equal(await active(), 'play-byte');
      for (const [button, result, announce] of [
        ['play-send', 'play-result-planted', /Step 1 done.*refuses/],
        ['play-fix', 'play-result-fixed', /Step 2 done.*accepts/],
        ['play-byte', 'play-result-byte', /Step 3 done.*MISMATCH/],
      ]) {
        await evaluate(`document.getElementById(${JSON.stringify(button)}).focus()`);
        await key('Enter');
        const done = await evaluate(inPage(`return await wait(() => !document.getElementById(${JSON.stringify(result)}).hidden && !document.getElementById(${JSON.stringify(button)}).disabled);`));
        assert.ok(done, `${button}: the step ended`);
        assert.equal(await active(), result, `${button}: focus moves to its result`);
        const status = await evaluate(`({ text: document.getElementById('play-status').textContent, live: document.getElementById('play-status').getAttribute('aria-live'), role: document.getElementById('play-status').getAttribute('role') })`);
        assert.equal(status.live, 'polite');
        assert.equal(status.role, 'status');
        assert.match(status.text, announce, `${button}: the live region announces the result`);
      }
      // The result places are named for a screen reader and take focus but are not in the Tab order.
      const places = await evaluate(`['play-result-planted', 'play-result-fixed', 'play-result-byte'].map((id) => { const e = document.getElementById(id); return [e.getAttribute('role'), !!e.getAttribute('aria-label'), e.tabIndex]; })`);
      assert.deepEqual(places, Array(3).fill(['group', true, -1]));
      // Real buttons, so Space and Enter both work and each has a visible focus ring from the page's rule.
      const buttons = await evaluate(`['play-send', 'play-fix', 'play-byte', 'strip-play'].map((id) => document.getElementById(id).tagName)`);
      assert.deepEqual(buttons, Array(4).fill('BUTTON'));
    });
  });
});

test('R13.10 under prefers-reduced-motion: reduce the results appear with no animation; at 390 px the page does not scroll sideways; the policy is unchanged; the play fetches only from its own origin and adds no sentence that breaks R12.2', { skip: NO_BROWSER }, async () => {
  await withBrowser({}, async (browser) => {
    // Reduced motion: no animation anywhere in the play, and the page does not scroll smoothly.
    await browser.open({ ...PHONE, reducedMotion: true, settle: false }, async ({ evaluate }) => {
      const m = await evaluate(inPage(`
        document.getElementById('strip-play').click();
        const out = await step('play-send', 'play-result-planted');
        const rows = [...document.querySelectorAll('#play li.contract')];
        return {
          done: out.done, rows: rows.length,
          running: document.getElementById('play').getAnimations({ subtree: true }).length,
          names: [...new Set(rows.map((li) => getComputedStyle(li).animationName))],
          opacities: [...new Set(rows.map((li) => getComputedStyle(li).opacity))],
          smooth: getComputedStyle(document.documentElement).scrollBehavior,
          play: [getComputedStyle(document.getElementById('play')).animationName, getComputedStyle(document.getElementById('play-result-planted')).animationName],
        };`));
      assert.ok(m.done);
      assert.equal(m.rows, 7);
      assert.equal(m.running, 0, 'nothing in the play is animating');
      assert.deepEqual(m.names, ['none']);
      assert.deepEqual(m.opacities, ['1'], 'every row is fully shown at once');
      assert.equal(m.smooth, 'auto');
      assert.deepEqual(m.play, ['none', 'none']);
    });

    // Phone width, all three steps done: no sideways scroll, no element wider than the window, targets at least 24 by 24.
    await browser.open(PHONE, async ({ evaluate }) => {
      const m = await evaluate(inPage(`
        document.getElementById('strip-play').click();
        for (const [b, r] of [['play-send', 'play-result-planted'], ['play-fix', 'play-result-fixed'], ['play-byte', 'play-result-byte']]) await step(b, r);
        const wide = [...document.querySelectorAll('#play *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5 && !e.closest('.sr-only')).map((e) => e.tagName + '.' + e.className);
        return {
          width: innerWidth, sideways: document.documentElement.scrollWidth, body: document.body.scrollWidth, wide: wide.slice(0, 5),
          targets: [...document.querySelectorAll('#play button, #strip-play, #play summary')].map((e) => { const b = e.getBoundingClientRect(); return [e.id || e.tagName, Math.round(b.width), Math.round(b.height)]; }),
        };`));
      assert.equal(m.width, PHONE.width, `the window is ${PHONE.width} wide (it is ${m.width}, so the page is wider than the window)`);
      assert.ok(m.sideways <= m.width && m.body <= m.width, `the page is ${m.sideways} wide in a ${m.width} px window`);
      assert.deepEqual(m.wide, [], 'nothing in the play is wider than the window');
      assert.ok(m.targets.length >= 5);
      for (const [name, w, h] of m.targets) assert.ok(w >= 24 && h >= 24, `${name} is ${w} x ${h}`);
    });

    // Fetch: every request the page and the worker made went to the page's own origin and its own folder, and none failed.
    assert.ok(browser.requests.length > 20);
    assert.ok(browser.requests.every((r) => r.rel !== null && r.status === 200), JSON.stringify(browser.requests.filter((r) => r.rel === null || r.status !== 200)));
    await browser.open(PHONE, async ({ evaluate }) => {
      const out = await evaluate(inPage(`
        document.getElementById('strip-play').click();
        for (const [b, r] of [['play-send', 'play-result-planted'], ['play-fix', 'play-result-fixed'], ['play-byte', 'play-result-byte']]) await step(b, r);
        return performance.getEntriesByType('resource').map((e) => e.name).filter((n) => !n.startsWith(location.origin + '/contract-necromancer/'));`));
      assert.deepEqual(out, [], 'no resource came from outside the page\'s own folder');
    });
  });

  // The policy in index.html is the one from the design, byte for byte, and the page still has one script.
  assert.equal(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(HTML)?.[1], CSP);
  assert.equal((HTML.match(/<script\b/g) || []).length, 1);
  assert.doesNotMatch(HTML, /\sstyle=|<style\b|\sonclick=/i);

  // The sentences of the page (as the frozen R12.2 contract reads them): the stand-ins sentence is there once, no sentence
  // says contracts run only in Node, and exactly one names necro verify with JavaScript contracts and runner contracts.
  const body = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('<script'));
  const sentences = body
    .replace(/<(code)[^>]*>([\s\S]*?)<\/\1>/g, (_, _t, inner) => inner.replace(/\./g, '\u0000'))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\u0000/g, '.').trim())
    .filter(Boolean);
  for (const s of sentences) {
    assert.doesNotMatch(s, /\bcontracts?\b[^.]*\bre-?run\w*\s+(only\s+)?in\s+Node\b/i, `"${s}"`);
    assert.doesNotMatch(s, /\bonly\b[^.]*\bin\s+Node\b|\bin\s+Node\b[^.]*\bonly\b|\bNode\s+only\b/i, `"${s}"`);
  }
  assert.equal(sentences.filter((s) => s.replace(/ ([,.])/g, '$1').endsWith(STAND_INS)).length, 1, 'the stand-ins sentence is on the page once');
  assert.equal(sentences.filter((s) => /necro verify/.test(s) && /JavaScript contracts/.test(s) && /runner contracts/.test(s)).length, 1);
  assert.ok(!sentences.some((s) => /[\u2013\u2014]/.test(s)), 'no em or en dashes');
});
