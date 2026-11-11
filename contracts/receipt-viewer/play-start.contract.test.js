// Contract for the look of the start control of the play, R13.9 of the receipt-viewer spec. It replaces the first R13.9 test
// of play-page.contract.test.js, which pinned pixel sizes measured on macOS (Copy as 64 by 32 at 1280x800, the phone banner
// ending at exactly 836). Requirement 13.9 asks for the start control in the first screen at 1280x800 and 390x844 and for
// the frozen first-screen contracts to pass, not for exact sizes, and other platforms draw text a little wider or narrower.
// This test keeps every check that does not depend on the platform and measures the two first-screen checks against the
// window instead: a box must lie inside the window it is drawn in.
//
// The test drives the real page, index.html with site/app.js, in a headless Chrome or Chromium. The file serves site/ the
// way GitHub Pages does: from a server on 127.0.0.1 whose pages sit under /contract-necromancer/, with no
// Content-Security-Policy header on any response. The browser is driven over the DevTools protocol with Node's built-in
// WebSocket, no dependencies. Set CHROME_PATH if the browser is somewhere unusual. With no browser this contract fails and
// says so: a page that was not run in a browser is not a pass.
//
// There is no shared helper file (a helper would not be frozen), so the browser code is carried in this file, as the other
// page contracts do. The site modules are named below the way a static import would name them, because the receipt pins
// the files it finds that way. Keep these lines.
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
import { fileURLToPath } from 'node:url';

const SITE = fileURLToPath(new URL('../../site/', import.meta.url));
const PREFIX = '/contract-necromancer/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

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

// Serve site/ under /contract-necromancer/. No response carries a Content-Security-Policy header.
function serveSite() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (!url.pathname.startsWith(PREFIX)) return send(404, 'text/plain', 'not found');
    const rel = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html';
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

// Start a headless browser and the site server. `browser.open(settings, use)` opens the real page in a fresh tab, waits
// until the page shows a receipt and its animations that end have ended, and calls use({ evaluate }). `evaluate(expression)`
// runs an expression in the page (it may be async) and gives back its value.
async function withBrowser(run) {
  const chrome = findBrowser();
  if (!chrome) {
    throw new Error('No Chrome or Chromium found. Install one, or set CHROME_PATH to its program, and run this again.');
  }
  const server = await serveSite();
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
        await sleep(100);
      }
    }
    if (!endpoint) throw new Error('The browser did not start. Check that it runs headless, then run this again.');
    client = connect(endpoint);
    await client.opened;

    const browser = {
      async open({ width, height, mobile = false }, use) {
        const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
        const call = (method, params) => client.send(method, params, sessionId);
        try {
          await call('Page.enable');
          await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
          await call('Emulation.setFocusEmulationEnabled', { enabled: true });
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
          let shown = false;
          for (let i = 0; i < 100 && !shown; i += 1) {
            shown = await evaluate("(() => { const v = document.getElementById('verdict'); return !!v && !v.hidden && v.textContent.trim() !== ''; })()");
            if (!shown) await sleep(100);
          }
          if (!shown) throw new Error('The page did not show a receipt within 10 seconds.');
          await evaluate("document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).forEach((a) => a.finish())");
          return await use({ evaluate });
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

test('R13.9 Try it here is drawn as the main action, clearly different from Copy, both buttons at least 24 by 24 and at AA contrast, and the start control and the whole verdict banner inside the first screen at 1280x800 and 390x844 in the browser that runs it', async () => {
  await withBrowser(async (browser) => {
    for (const screen of [DESKTOP, PHONE]) {
      const at = `${screen.width}x${screen.height}`;
      await browser.open(screen, async ({ evaluate }) => {
        const m = await evaluate(`(() => {
          const look = (id) => {
            const e = document.getElementById(id);
            const s = getComputedStyle(e);
            const b = e.getBoundingClientRect();
            return {
              bg: s.backgroundColor, color: s.color, shadow: s.boxShadow, label: e.textContent.trim(),
              box: { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height },
            };
          };
          return {
            innerWidth, innerHeight, scrollX, scrollY, scrollWidth: document.documentElement.scrollWidth,
            play: look('strip-play'), copy: look('strip-copy'), verdict: look('verdict'),
          };
        })()`);
        const rgb = (c) => /rgba?\((\d+), (\d+), (\d+)/.exec(c).slice(1, 4).map(Number);
        const lum = (c) => {
          const [r, g, b] = rgb(c).map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratio = (a, b) => {
          const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };

        // What the buttons look like. None of this depends on how the platform draws text.
        assert.notEqual(m.play.bg, m.copy.bg, `${at}: the two buttons have different fills`);
        assert.equal(m.play.bg, 'rgb(125, 255, 179)', `${at}: the main action is filled with the alive colour`);
        assert.notEqual(m.play.shadow, 'none', `${at}: the main action has a glow ring`);
        assert.equal(m.copy.bg, 'rgb(255, 169, 77)', `${at}: Copy keeps the accent fill`);
        assert.equal(m.copy.shadow, 'none', `${at}: Copy has no glow`);
        assert.equal(m.copy.label, 'Copy', `${at}: the Copy label`);
        assert.equal(m.play.label, 'Try it here', `${at}: the label is the text only`);
        assert.ok(ratio(m.play.bg, m.play.color) >= 4.5, `${at}: Try it here contrast ${ratio(m.play.bg, m.play.color)}`);
        assert.ok(ratio(m.copy.bg, m.copy.color) >= 4.5, `${at}: Copy contrast ${ratio(m.copy.bg, m.copy.color)}`);
        assert.ok(m.play.box.width >= 24 && m.play.box.height >= 24, `${at}: Try it here is ${m.play.box.width} x ${m.play.box.height}`);
        assert.ok(m.copy.box.width >= 24 && m.copy.box.height >= 24, `${at}: Copy is ${m.copy.box.width} x ${m.copy.box.height}`);

        // Where the boxes are, against the window. First check that the window is the one that was asked for and that the
        // page is not scrolled, so "inside the window" means "in the first screen".
        assert.equal(m.innerWidth, screen.width, `${at}: the window is ${m.innerWidth} wide`);
        assert.equal(m.innerHeight, screen.height, `${at}: the window is ${m.innerHeight} tall`);
        assert.equal(m.scrollX, 0, `${at}: the page starts scrolled sideways by ${m.scrollX}`);
        assert.equal(m.scrollY, 0, `${at}: the page starts scrolled down by ${m.scrollY}`);
        assert.ok(m.scrollWidth <= screen.width, `${at}: the page scrolls sideways, its width is ${m.scrollWidth}`);
        const inside = (b) => b.top >= 0 && b.left >= 0 && b.bottom <= screen.height && b.right <= screen.width;
        const where = (b) => `x ${Math.round(b.left)} to ${Math.round(b.right)}, y ${Math.round(b.top)} to ${Math.round(b.bottom)}`;
        assert.ok(inside(m.play.box), `${at}: the start control must be fully inside the first screen, it spans ${where(m.play.box)}`);
        assert.ok(m.verdict.box.height > 0, `${at}: the verdict banner is drawn`);
        // Requirement 9.5 revised Nov 12: at 390x844 the start control and the result line take the banner's place (first-screen-v3).
        if (!screen.mobile) assert.ok(inside(m.verdict.box), `${at}: the verdict banner must be fully inside the first screen, it spans ${where(m.verdict.box)}`);
      });
    }
  });
});
