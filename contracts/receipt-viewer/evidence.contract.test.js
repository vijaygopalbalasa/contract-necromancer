// Contracts for R12.1 and R12.2 of the receipt-viewer spec: the evidence on the first screen. One line between the story
// strip and the verdict banner gives the experiment result (on a task that cannot honestly be finished, Kiro marked it
// done in 11 of 11 runs without the gate and 0 of 19 with it, across two models) with a plain link to the write-up, while
// Requirement 9.5 still holds. The page also no longer says that contracts re-run only in Node.
//
// Text is read from site/index.html and site/style.css. Layout is measured in a headless Chrome or Chromium: the file
// serves site/ from a local server on 127.0.0.1, sets the window size and reads the page over the DevTools protocol
// (Node's built-in WebSocket, no dependencies). Set CHROME_PATH if the browser is somewhere unusual. With no browser the
// layout contract fails and says so: a layout that was not measured is not a pass.
//
// There is no shared helper file (a helper would not be frozen), so the browser code is carried in this file, as in
// above-fold-v2.contract.test.js. The page script is named below the way a static import would name it, because the
// receipt pins files it finds that way. Keep this line.
//   import {} from '../../site/app.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
    throw new Error('No Chrome or Chromium found. Install one, or set CHROME_PATH to its program, and run this again.');
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
        await sleep(100);
      }
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

const EXPERIMENT = 'https://github.com/vijaygopalbalasa/contract-necromancer/blob/main/experiments/README.md';
const HTML = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const idAt = (id) => {
  const i = HTML.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
};
const textOf = (fragment) => fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// The sentences of the visible page text. Full stops inside <code> (file names, versions) do not end a sentence.
function sentences() {
  const body = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('<script'));
  return body
    .replace(/<(code)[^>]*>([\s\S]*?)<\/\1>/g, (_, _t, inner) => inner.replace(/\./g, '\u0000'))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\u0000/g, '.').trim())
    .filter(Boolean);
}

test('R12.1 one short plain line between the story strip and the verdict banner states 11 of 11 without the gate and 0 of 19 with it, across two models, and links to the experiment write-up', () => {
  const at = idAt('evidence');
  const start = HTML.lastIndexOf('<', at);
  assert.match(HTML.slice(start, at), /^<p\b/, 'the line is a <p id="evidence">');
  const end = HTML.indexOf('</p>', start) + '</p>'.length;
  const line = HTML.slice(start, end);
  const words = textOf(line);

  const stripStart = HTML.lastIndexOf('<section', idAt('strip'));
  const stripEnd = HTML.indexOf('</section>', stripStart) + '</section>'.length;
  assert.ok(start >= stripEnd, 'the line comes after the story strip');
  assert.ok(end < idAt('verdict'), 'the line comes before the verdict banner');

  assert.match(words, /cannot be finished/);
  assert.match(words, /marked it done in 11 of 11 runs without the gate/);
  assert.match(words, /0 of 19 with it/);
  assert.match(words, /across two models/);
  assert.ok(words.split(' ').length <= 34, `the line has ${words.split(' ').length} words, the limit is 34`);
  assert.doesNotMatch(line, /[\u2013\u2014]/, 'no em or en dashes');
  assert.doesNotMatch(line, /<(script|svg|img|button|input)\b|\bhidden\b|aria-hidden|\bon\w+=/i, 'plain text, readable without JavaScript');

  const links = [...line.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 1, 'exactly one link');
  assert.equal(/\bhref="([^"]*)"/.exec(links[0][1])[1], EXPERIMENT, 'the link goes to the experiment write-up');
  assert.doesNotMatch(links[0][1], /\b(target|download|onclick)=/, 'a plain link');
  assert.match(textOf(links[0][2]), /experiment/i, 'the link says where it goes');
});

test('R12.1 the line is in the first screen at 1280x800 and 390x844 with scripts on and off, and the verdict banner, with no sideways scroll, still is (Requirement 9.5)', async () => {
  await withBrowser(async (browser) => {
    for (const screen of FIRST_SCREENS) {
      const measureLayout = () => {
        const box = (id) => {
          const b = document.getElementById(id).getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
        };
        const e = document.getElementById('evidence');
        const link = e.querySelector('a');
        const style = getComputedStyle(e);
        return {
          innerWidth,
          innerHeight,
          scrollX,
          scrollY,
          pageWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          strip: box('strip'),
          evidence: box('evidence'),
          verdict: box('verdict'),
          shown: style.display !== 'none' && style.visibility === 'visible',
          text: e.innerText.replace(/\s+/g, ' ').trim(),
          href: link && link.href,
        };
      };
      for (const scripts of [true, false]) {
        const m = await browser.measure({ ...screen, scripts, settle: scripts }, measureLayout);
        const at = `at ${screen.name} with scripts ${scripts ? 'on' : 'off'}`;
        assert.match(m.text, /11 of 11/, `${at}: the line shows 11 of 11`);
        assert.match(m.text, /0 of 19/, `${at}: the line shows 0 of 19`);
        assert.equal(m.href, EXPERIMENT, `${at}: the link goes to the experiment write-up`);
        assert.ok(m.shown && m.evidence.width > 0 && m.evidence.height > 0, `${at}: the line is drawn`);
        assert.ok(m.strip.bottom <= m.evidence.top, `${at}: the line is drawn below the strip`);
        assert.ok(
          m.evidence.top >= 0 && m.evidence.bottom <= m.innerHeight && m.evidence.left >= 0 && m.evidence.right <= m.innerWidth,
          `${at}: the line must be inside the first screen, it spans ${Math.round(m.evidence.top)} to ${Math.round(m.evidence.bottom)} of ${m.innerHeight}`,
        );
        assert.ok(m.pageWidth <= m.innerWidth && m.bodyWidth <= m.innerWidth && m.scrollX === 0, `${at}: the page scrolls sideways (${m.pageWidth} wide in a ${m.innerWidth} window)`);
        if (scripts) {
          assert.ok(m.evidence.bottom <= m.verdict.top, `${at}: the line is drawn above the banner`);
          assert.ok(
            m.verdict.top >= 0 && m.verdict.bottom <= m.innerHeight && m.verdict.height > 0,
            `${at}: the banner must be fully inside the first screen, it spans ${Math.round(m.verdict.top)} to ${Math.round(m.verdict.bottom)} of ${m.innerHeight}`,
          );
        }
      }
    }
  });
});

test('R12.2 no sentence on the page says that contracts re-run only in Node, and one says that necro verify re-runs JavaScript contracts and runner contracts such as pytest alike', () => {
  for (const s of sentences()) {
    assert.doesNotMatch(s, /\bcontracts?\b[^.]*\bre-?run\w*\s+(only\s+)?in\s+Node\b/i, `"${s}"`);
    assert.doesNotMatch(s, /\bonly\b[^.]*\bin\s+Node\b|\bin\s+Node\b[^.]*\bonly\b|\bNode\s+only\b/i, `"${s}"`);
  }
  const found = sentences().filter((s) => /necro verify/.test(s) && /JavaScript contracts/.test(s) && /runner contracts/.test(s));
  assert.equal(found.length, 1, 'one sentence names necro verify, JavaScript contracts and runner contracts');
  assert.match(found[0], /re-runs/);
  assert.match(found[0], /\bpytest\b/);
  assert.match(found[0], /\balike\b/);
});
