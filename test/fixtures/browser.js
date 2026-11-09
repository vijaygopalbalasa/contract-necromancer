// A tiny headless-browser helper for the page tests, with no dependencies: it serves site/ from a local HTTP server,
// starts the Chrome or Chromium found on this machine, and drives it over the DevTools protocol with Node's built-in
// WebSocket. Only our own local page is ever loaded, so the browser sandbox is switched off to run on CI machines.
//
//   await withBrowser(async (browser) => {
//     const m = await browser.measure({ width: 1280, height: 800 }, () => ({ top: document.body.getBoundingClientRect().top }));
//   });
//
// `measure` opens a fresh page, waits until the first-visit sample is on screen (unless scripts are off), finishes the
// animations that have an end, and returns what the function gave back (it must return JSON-friendly data).

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

export function findBrowser() {
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

export async function withBrowser(run) {
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
