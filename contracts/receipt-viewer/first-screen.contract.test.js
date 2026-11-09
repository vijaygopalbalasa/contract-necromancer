// Contracts for R11.1 to R11.5 of the receipt-viewer spec: the first screen tells the story. A strip of three beats taken
// from the real `necro demo` output sits between the heading and the verdict banner, the demo command can be copied from
// the first screen, the sample buttons use plain words, and the page has an inline favicon.
//
// R11.1 runs `node bin/necro.js demo` and checks the beats against its output. Layout, animation and the favicon request
// are measured in a headless Chrome or Chromium: the file serves site/ from a local server on 127.0.0.1, sets the window
// size and reads the page over the DevTools protocol (Node's built-in WebSocket, no dependencies). Set CHROME_PATH if the
// browser is somewhere unusual. With no browser these contracts fail and say so: a layout that was not measured is not
// a pass.
//
// There is no shared helper file (a helper would not be frozen), so the browser code is carried in this file and in
// above-fold-v2.contract.test.js. The sample notes are read with a dynamic import so this file always loads and every
// contract name is registered. Dynamic imports are not followed by necro's import tracing, so the modules are also named
// below the way a static import would name them. Keep these lines.
//   import {} from '../../site/app.js';
//   import {} from '../../site/lib/samples.js';
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

const HTML = fs.readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SAMPLES_URL = new URL('../../site/lib/samples.js', import.meta.url);

const DEMO = 'npx -y github:vijaygopalbalasa/contract-necromancer demo';
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'";
const DASHES = /[\u2013\u2014]/;

const idAt = (id) => {
  const i = HTML.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
};
const textOf = (fragment) => fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// The strip section as text, and its beats.
function strip() {
  const at = idAt('strip');
  const start = HTML.lastIndexOf('<section', at);
  const end = HTML.indexOf('</section>', start);
  assert.ok(start >= 0 && end > start && HTML.slice(start, at).indexOf('>') < 0, 'the strip is a <section id="strip">');
  const text = HTML.slice(start, end + '</section>'.length);
  const list = /<ol\b[^>]*>([\s\S]*?)<\/ol>/.exec(text);
  assert.ok(list, 'the beats are an ordered list');
  const beats = [...list[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
  return { start, end: end + '</section>'.length, text, beats };
}

// ---- R11.1 ----

test('R11.1 between the heading and the verdict banner, a strip of three plain-text beats taken from the real necro demo output: Kiro says task 4 is done, the gate refuses and names R2.1 and R2.2, then it accepts, writes a receipt and necro verify prints CONFIRMED', async () => {
  const s = strip();
  assert.equal(s.beats.length, 3, 'three beats');
  assert.ok(HTML.indexOf('<h1') < s.start && s.end < idAt('verdict'), 'the strip sits between the heading and the verdict banner');
  assert.match(s.beats[0], /Kiro says task 4 is done/);
  assert.match(s.beats[1], /gate refuses the tick/);
  assert.ok(s.beats[1].indexOf('R2.1') >= 0 && s.beats[1].indexOf('R2.1') < s.beats[1].indexOf('R2.2'), 'the second beat names R2.1 and R2.2');
  assert.match(s.beats[2], /gate accepts the tick/);
  assert.match(s.beats[2], /writes a receipt/);
  assert.match(s.beats[2], /necro verify prints CONFIRMED/);
  assert.doesNotMatch(s.text, /<script|\bhidden\b|aria-hidden|<svg|<img|data-/i, 'the beats are plain text in the HTML');
  assert.doesNotMatch(s.text, DASHES, 'no em or en dashes');

  // The beats say what the demo really prints.
  const run = spawnSync(process.execPath, ['bin/necro.js', 'demo'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(run.status, 0, `necro demo failed:\n${run.stdout}${run.stderr}`);
  const failed = /Contracts failed: ([^\n]+)/.exec(run.stdout);
  assert.ok(failed, 'the demo lists the failing contracts');
  const ids = failed[1].split(',').map((x) => x.trim());
  assert.deepEqual(ids.slice(0, 2), ['R2.1', 'R2.2']);
  assert.ok(s.beats[1].includes(`${ids[0]}, ${ids[1]} and ${ids.length - 2} more`), `the second beat says "${ids[0]}, ${ids[1]} and ${ids.length - 2} more"`);
  assert.match(run.stdout, /Reopen task 4/);
  assert.match(run.stdout, /round each share, so cents are lost/);
  assert.match(run.stdout, /The gate refused the tick \(exit 2\)/);
  assert.match(run.stdout, /The gate accepted the tick \(exit 0\)/);
  assert.match(run.stdout, /Receipt: /);
  assert.match(run.stdout, /CONFIRMED [0-9a-f]{64}/);

  // Readable without JavaScript: with scripts off, all three beats are drawn, in reading order.
  await withBrowser(async (browser) => {
    for (const screen of [{ width: 1280, height: 800 }, { width: 390, height: 844, mobile: true }]) {
      const m = await browser.measure({ ...screen, scripts: false, settle: false }, () =>
        [...document.querySelectorAll('#strip li')].map((li) => {
          const b = li.getBoundingClientRect();
          const style = getComputedStyle(li);
          return { text: li.innerText.replace(/\s+/g, ' ').trim(), top: b.top, left: b.left, width: b.width, height: b.height, visibility: style.visibility, display: style.display };
        }),
      );
      assert.equal(m.length, 3, `${screen.width}: three beats with scripts off`);
      for (const b of m) assert.ok(b.width > 0 && b.height > 0 && b.visibility === 'visible' && b.display !== 'none', `${screen.width}: a beat is not drawn`);
      assert.match(m[0].text, /task 4 is done/);
      assert.match(m[1].text, /R2\.1, R2\.2/);
      assert.match(m[2].text, /CONFIRMED/);
      const key = screen.width > 800 ? 'left' : 'top';
      assert.ok(m[0][key] < m[1][key] && m[1][key] < m[2][key], `${screen.width}: the beats are drawn out of reading order`);
    }
  });
});

// ---- R11.2 ----

test('R11.2 the strip animates in CSS only, and under prefers-reduced-motion: reduce all three beats show at once with no animation', async () => {
  // CSS only: the animation lives in the no-preference block, nothing outside it, and the page script knows no beats.
  const motion = [...CSS.matchAll(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*{([\s\S]*?)\n}\n/g)].map((m) => m[1]).join('\n');
  assert.match(motion, /\.beat\b[^{]*{[^}]*animation:/, 'the beats animate under no-preference');
  const outside = CSS.replace(/@media\s*\(prefers-reduced-motion:[^)]*\)\s*{[\s\S]*?\n}\n/g, '');
  assert.doesNotMatch(outside, /(\.beat|\.strip)[^{]*{[^}]*(animation|transition)\s*:/, 'no animation on the strip outside the motion block');
  assert.doesNotMatch(fs.readFileSync(new URL('../../site/app.js', import.meta.url), 'utf8'), /\bbeats?\b/, 'the page script does not drive the beats');

  await withBrowser(async (browser) => {
    const beats = () => {
      const items = [...document.querySelectorAll('#strip li')];
      return {
        count: items.length,
        running: items.flatMap((li) => li.getAnimations({ subtree: true })).length,
        names: items.map((li) => getComputedStyle(li).animationName),
        opacities: items.map((li) => getComputedStyle(li).opacity),
        transforms: items.map((li) => getComputedStyle(li).transform),
      };
    };
    // Measured at once, before any animation could have finished.
    const reduced = await browser.measure({ width: 1280, height: 800, reducedMotion: true, settle: false }, beats);
    assert.equal(reduced.count, 3);
    assert.equal(reduced.running, 0, 'nothing is animating under reduce');
    assert.deepEqual(reduced.names, ['none', 'none', 'none']);
    assert.deepEqual(reduced.opacities, ['1', '1', '1'], 'all three beats are fully shown at once');
    assert.deepEqual(reduced.transforms, ['none', 'none', 'none']);
    const motionOn = await browser.measure({ width: 1280, height: 800, reducedMotion: false, settle: false }, beats);
    assert.ok(motionOn.names.every((n) => n !== 'none'), 'where motion is welcome the beats are animated, so the check above is not trivially true');
  });
});

// ---- R11.3 ----

test('R11.3 the demo command and a copy button that copies it are in the first screen at 1280x800', async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure({ width: 1280, height: 800 }, async () => {
      const box = (id) => {
        const e = document.getElementById(id);
        const b = e.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height, text: e.textContent.trim() };
      };
      const result = { w: innerWidth, h: innerHeight, scrollY, command: box('strip-command'), copy: box('strip-copy') };
      // Press the button with a clipboard that records what it is given.
      const copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => void copied.push(text) } });
      document.getElementById('strip-copy').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      result.copied = copied;
      result.note = document.getElementById('strip-copy-note').textContent;
      return result;
    });
    assert.equal(m.scrollY, 0);
    assert.equal(m.command.text, DEMO);
    assert.match(m.copy.text, /copy/i);
    for (const [name, b] of [['command', m.command], ['copy button', m.copy]]) {
      assert.ok(b.width > 0 && b.height > 0, `the ${name} is drawn`);
      assert.ok(b.top >= 0 && b.bottom <= m.h && b.left >= 0 && b.right <= m.w, `the ${name} is inside the first 1280x800 screen`);
    }
    assert.deepEqual(m.copied, [DEMO], 'the copy button copies exactly the demo command');
    assert.equal(m.note, 'Copied.');
  });
});

// ---- R11.4 ----

test('R11.4 the sample buttons read "A passing receipt" and "A refused one", and each sample note says in one sentence what a receipt is', async () => {
  const buttons = Object.fromEntries([...HTML.matchAll(/<button[^>]*id="(sample|sample-buried)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2].trim()]));
  assert.match(buttons.sample, /^A passing receipt\b/);
  assert.match(buttons['sample-buried'], /^A refused one\b/);
  for (const label of Object.values(buttons)) assert.doesNotMatch(label, /^Load\b|[\u2013\u2014]/, 'plain words, no "Load the ... sample"');

  const { SAMPLES } = await import(SAMPLES_URL.href);
  assert.equal(SAMPLES.length, 2);
  assert.equal(SAMPLES[0].label, buttons.sample);
  assert.equal(SAMPLES[1].label, buttons['sample-buried']);
  for (const s of SAMPLES) {
    assert.match(s.note, /^A receipt lists the contracts that had to pass before Kiro could tick the task\./, `${s.id}: the first sentence says what a receipt is`);
    assert.match(s.note, /\bsample\b/i, `${s.id}: the note still says it is a sample`);
    assert.doesNotMatch(s.note, DASHES);
  }

  // The words reach the screen: the note is on the page next to the buttons on a first visit.
  await withBrowser(async (browser) => {
    const m = await browser.measure({ width: 1280, height: 800 }, () => ({
      note: document.getElementById('sample-note').textContent.trim(),
      labels: [document.getElementById('sample').textContent.trim(), document.getElementById('sample-buried').textContent.trim()],
    }));
    assert.equal(m.note, SAMPLES[0].note);
    assert.deepEqual(m.labels, [SAMPLES[0].label, SAMPLES[1].label]);
  });
});

// ---- R11.5 ----

test('R11.5 an inline data: SVG favicon of the gravestone mark, so the browser requests no icon file, and a title that says what the page does, with the Content Security Policy unchanged', async () => {
  const icons = [...HTML.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /\brel="icon"/.test(tag));
  assert.equal(icons.length, 1, 'one favicon link');
  assert.match(icons[0], /\btype="image\/svg\+xml"/);
  const href = /\bhref="(data:image\/svg\+xml,[^"]+)"/.exec(icons[0]);
  assert.ok(href, 'the favicon is a data:image/svg+xml URL');
  const svg = decodeURIComponent(href[1].slice('data:image/svg+xml,'.length));
  assert.match(svg, /^<svg\b[^>]*xmlns='http:\/\/www\.w3\.org\/2000\/svg'[^>]*viewBox='0 0 64 64'/);
  assert.match(svg, /<path\b/);
  assert.doesNotMatch(svg, /<(script|image|use|style|foreignObject)\b|href=|url\(|@import/i, 'the favicon loads nothing');
  assert.equal(svg.match(/https?:\/\/[^'"\s]+/g).join(), 'http://www.w3.org/2000/svg', 'the only address in it is the SVG namespace');

  const title = /<title>([^<]*)<\/title>/.exec(HTML)[1];
  assert.match(title, /^Contract Necromancer\b/);
  assert.match(title, /contracts/i);
  assert.match(title, /done/i);
  assert.ok(title.length <= 72, `the title is ${title.length} characters`);
  assert.doesNotMatch(title, DASHES);

  assert.equal(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(HTML)?.[1], CSP, 'the Content Security Policy is unchanged, byte for byte');

  // A fresh browser: the page loads and nothing asks for /favicon.ico or fails.
  await withBrowser(async (browser) => {
    await browser.measure({ width: 1280, height: 800 }, () => true);
    const paths = browser.requests.map((r) => r.path);
    assert.ok(!paths.includes('/favicon.ico'), `the browser requested /favicon.ico (${paths.join(', ')})`);
    assert.deepEqual(browser.requests.filter((r) => r.status !== 200), [], 'no request failed');
  });
});
