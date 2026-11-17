// Contract for R9.5 of the receipt-viewer spec, as revised on Nov 16: on a first visit the sample is shown at once. In the
// first screen, without scrolling, a 1280x800 window shows Try it here, the whole result element of 12.1 and the real-use
// line of 16.3; a 390x844 phone window shows Try it here, the two large counts of 14.2 and the real-use line. Neither window
// scrolls sideways, and the way to open your own receipt is still reachable on the page. The verdict banner follows the open
// play and need not be in the first screen (earlier: Nov 9 dropped the word limit above the banner, Nov 12 took the banner
// out of the phone's first screen). At phone width only the two counts must fit, so fonts wider than this Mac's cannot push a
// check past the fold.
//
// This replaces above-fold.contract.test.js, which checks the old wording. A person removes that file.
//
// The page is measured, not read: the file starts the Chrome or Chromium on this machine in headless mode, serves site/
// from a local server on 127.0.0.1, sets the window size, waits for the sample to appear and reads the layout over the
// DevTools protocol (Node's built-in WebSocket, no dependencies). Set CHROME_PATH if the browser is somewhere unusual.
// With no browser (Requirement 16.7) a test skips with a reason that starts with "cannot run:"; a skip is never a pass.
//
// There is no shared helper file (a helper would not be frozen), so the browser code is carried in this file and in
// first-screen.contract.test.js. The page script and the sample notes are named below the way a static import would name
// them, because the receipt pins files it finds that way. Keep these lines.
//   import {} from '../../site/app.js';
//   import {} from '../../site/lib/samples.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = fileURLToPath(new URL('../../site/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

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

function serveSite(requests) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(SITE, name);
    const ok = file.startsWith(SITE) && fs.existsSync(file) && fs.statSync(file).isFile();
    requests.push({ path: url.pathname, status: ok ? 200 : 404 });
    if (!ok) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
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

async function withBrowser(run) {
  const chrome = findBrowser();
  if (!chrome) {
    throw new Error(NO_BROWSER);
  }
  const requests = [];
  const server = await serveSite(requests);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-browser-'));
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
      // Open a fresh page with these settings, run `fn` in it and give back its result.
      async measure({ width, height, mobile = false, reducedMotion = null, scripts = true, search = '', settle = true }, fn) {
        const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
        const call = (method, params) => client.send(method, params, sessionId);
        try {
          await call('Page.enable');
          await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
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
          await call('Page.navigate', { url: `${origin}/${search}` });
          await loaded;
          const evaluate = async (expression) => {
            const out = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (out.exceptionDetails) throw new Error(`The page script failed: ${out.exceptionDetails.exception?.description || out.exceptionDetails.text}`);
            return out.result.value;
          };
          if (scripts && settle) {
            let shown = false;
            for (let i = 0; i < 100 && !shown; i += 1) {
              shown = await evaluate("(() => { const v = document.getElementById('verdict'); return !!v && !v.hidden && v.textContent.trim() !== ''; })()");
              if (!shown) await sleep(100);
            }
            if (!shown) throw new Error('The page did not show a receipt within 10 seconds.');
          }
          if (settle) {
            // Finish every animation that has an end. The ones that never end (fog, glow) are left alone.
            await evaluate("document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).forEach((a) => a.finish())");
          }
          return await evaluate(`(${fn.toString()})()`);
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

const FIRST_SCREENS = [
  { name: '1280x800', width: 1280, height: 800, mobile: false },
  { name: '390x844 phone', width: 390, height: 844, mobile: true },
];

test('R9.5 (revised Nov 16) on a first visit Try it here, the real-use line and the result (the whole element at 1280x800, the two large counts at 390x844) are in the first screen, with no horizontal scrolling and the way to open your own receipt on the page', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const screen of FIRST_SCREENS) {
      const m = await browser.measure(screen, () => {
        const rect = (el) => {
          const b = el.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
        };
        const verdict = document.getElementById('verdict');
        const box = (el) => (el ? rect(el) : null);
        const evidence = document.getElementById('evidence');
        const open = document.getElementById('open');
        const summary = open && open.querySelector('summary');
        const result = {
          innerWidth,
          innerHeight,
          scrollX,
          scrollY,
          pageWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          verdictText: verdict ? verdict.textContent.replace(/\s+/g, ' ').trim() : null,
          verdictShown: !!verdict && !verdict.hidden && getComputedStyle(verdict).display !== 'none',
          verdict: verdict ? rect(verdict) : null,
          tryIt: box(document.getElementById('strip-play')),
          tryItShown: !!document.getElementById('strip-play') && document.getElementById('strip-play').getClientRects().length > 0,
          realUse: box(document.getElementById('real-use')),
          realUseText: document.getElementById('real-use') ? document.getElementById('real-use').innerText.replace(/\s+/g, ' ').trim() : '',
          evidence: box(evidence),
          counts: evidence ? [...evidence.querySelectorAll('.num')].map(rect) : [],
          countsText: evidence ? [...evidence.querySelectorAll('.num')].map((e) => e.textContent.trim()) : [],
          openShown: !!open && getComputedStyle(open).display !== 'none',
          open: open ? rect(open) : null,
          summaryText: summary ? summary.textContent.trim() : null,
          summary: summary ? rect(summary) : null,
        };
        // Open the control: its paste box, Show button and file picker must be drawn, on the same page.
        if (open) open.open = true;
        const drawn = (id) => {
          const el = document.getElementById(id);
          if (!el) return false;
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility === 'visible';
        };
        result.openControls = { paste: drawn('paste'), show: drawn('show'), file: drawn('file') };
        result.pageWidthWhenOpen = document.documentElement.scrollWidth;
        return result;
      });
      const at = `at ${screen.name}`;
      assert.equal(m.innerWidth, screen.width, `${at}: the window is ${screen.width} wide`);
      assert.equal(m.scrollY, 0, `${at}: the page starts at the top`);
      assert.ok(m.verdictShown && /\bRisen\b|Still buried/.test(m.verdictText || ''), `${at}: the verdict banner is shown (it says "${m.verdictText}")`);
      // Requirement 9.5 revised Nov 16: the banner follows the open play and need not be in the first screen. What must be:
      const inside = (b) => !!b && b.width > 0 && b.height > 0 && b.top >= 0 && b.bottom <= m.innerHeight && b.left >= 0 && b.right <= m.innerWidth;
      const where = (b) => (b ? `${Math.round(b.top)} to ${Math.round(b.bottom)} of ${m.innerHeight}` : 'not on the page');
      assert.ok(m.tryItShown && inside(m.tryIt), `${at}: Try it here must be in the first screen, it spans ${where(m.tryIt)}`);
      assert.ok(/\S/.test(m.realUseText) && inside(m.realUse), `${at}: the real-use line must be in the first screen, it spans ${where(m.realUse)}`);
      if (screen.mobile) {
        assert.equal(m.counts.length, 2, `${at}: the result has its two large counts`);
        assert.deepEqual(m.countsText, ['11 of 11', '0 of 19'], `${at}: the two counts`);
        m.counts.forEach((b, i) => assert.ok(inside(b), `${at}: count ${m.countsText[i]} must be in the first screen, it spans ${where(b)}`));
      } else {
        assert.ok(inside(m.evidence), `${at}: the whole result element must be in the first screen, it spans ${where(m.evidence)}`);
      }
      assert.ok(m.pageWidth <= m.innerWidth && m.bodyWidth <= m.innerWidth && m.scrollX === 0, `${at}: the page scrolls sideways (${m.pageWidth} wide in a ${m.innerWidth} window)`);
      assert.ok(m.pageWidthWhenOpen <= m.innerWidth, `${at}: the page scrolls sideways once the paste box is open`);
      assert.ok(m.openShown && m.open.width > 0 && m.open.height > 0, `${at}: the way to open your own receipt is on the page`);
      assert.match(m.summaryText || '', /open your own receipt/i, `${at}: it says "Open your own receipt"`);
      assert.deepEqual(m.openControls, { paste: true, show: true, file: true }, `${at}: opening it shows the paste box, the Show button and the file picker`);
    }
  });
});
