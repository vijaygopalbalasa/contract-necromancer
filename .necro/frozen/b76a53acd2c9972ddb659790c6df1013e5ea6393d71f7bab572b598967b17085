// Contracts for R10.1 to R10.4 of the receipt-viewer spec: the story in one glance. The page heading says the idea, a
// "How it works" section follows the receipt card, the demo command can be copied, and the video and the repository are
// plain links.
//
// Node cannot lay a page out or load a video, so R10.1, R10.3 and R10.4 read site/index.html and site/style.css as text,
// and R10.2 also runs the copy button of site/app.js against a small fake DOM built from the ids in index.html.
// Revised Nov 17 (10.1, 10.2, 10.3, 10.4): the heading is "A Kiro task is done only when its frozen contracts pass."; step 3
// says "a receipt you can re-run"; the page may hold one <img>, the screenshot of Requirement 17; and the demo commands
// (#demo-command and #strip-command) stay on one line in a box that scrolls sideways while every other code block wraps. That
// last check reads computed styles in real Chrome (one test, with its own lookup and the "cannot run:" skip of 16.7, carried
// below as in try-first.contract.test.js), so no selector can slip past a regex over the CSS text. Every other test here
// still needs no browser.
// The above-fold contract (R9.5) is a separate frozen file that the gate runs on its own; R10.1 here checks the heading
// and where it sits. Whether the page really fits 1280x800 and 390x844 is measured by hand in a headless browser.
//
// app.js is loaded with a dynamic import so this file always loads and the contract names are always registered.
// Dynamic imports are not followed by necro's import tracing, so the module is also named below the way a static import
// would name it. Keep this line: the receipt pins files it finds this way.
//   import {} from '../../site/app.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HTML = fs.readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const APP_URL = new URL('../../site/app.js', import.meta.url);

// Revised Nov 17 (10.1): "cannot" overstated what hooks can stop.
const IDEA = 'A Kiro task is done only when its frozen contracts pass.';
const DEMO = 'npx -y github:vijaygopalbalasa/contract-necromancer demo';
// Revised Nov 16 (10.3): the video link is the first youtu.be link in README.md, whichever cut that is (the video is replaced
// before Dec 1, and the page and the README must never point at different cuts).
const VIDEO = /https:\/\/youtu\.be\/[\w-]+/.exec(fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8'))?.[0];
const REPO = 'https://github.com/vijaygopalbalasa/contract-necromancer';
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'";

// The position of the tag that carries this id.
function idAt(id) {
  const i = HTML.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
}

// The <section> that carries this id, from its opening tag to its closing tag (sections do not nest in this page).
function section(id) {
  const start = HTML.lastIndexOf('<section', idAt(id));
  const end = HTML.indexOf('</section>', start);
  assert.ok(start >= 0 && end > start, `index.html has no <section id="${id}">`);
  return { start, end: end + '</section>'.length, text: HTML.slice(start, end + '</section>'.length) };
}

const words = (fragment) => fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// ---- the browser, for the one test that reads computed styles (Requirement 16.7: no browser, a skip that starts with "cannot run:") ----

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

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, mobile: true };

// ---- a small fake DOM, built from the ids in site/index.html, for the copy button ----

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.own = '';
    this.value = '';
    this.files = [];
    this.disabled = false;
    this.listeners = new Map();
  }
  get className() {
    return this.attrs.get('class') || '';
  }
  set className(v) {
    this.attrs.set('class', String(v));
  }
  get hidden() {
    return this.attrs.has('hidden');
  }
  set hidden(v) {
    if (v) this.attrs.set('hidden', '');
    else this.attrs.delete('hidden');
  }
  get textContent() {
    return this.own + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.children = [];
    this.own = String(v);
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  appendChild(n) {
    this.children.push(n);
    return n;
  }
  append(...ns) {
    for (const n of ns) this.children.push(typeof n === 'string' ? Object.assign(new FakeNode('#text'), { own: n }) : n);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  async dispatch(type) {
    const event = { type, target: this, preventDefault() {} };
    await Promise.all((this.listeners.get(type) || []).map((fn) => fn(event)));
  }
}

function createDom() {
  const byId = new Map();
  for (const m of HTML.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const id = /\sid="([^"]*)"/.exec(m[2]);
    if (!id) continue;
    const el = new FakeNode(m[1]);
    el.hidden = /\shidden(\s|$)/.test(m[2]);
    el.own = /^[^<]*/.exec(HTML.slice(m.index + m[0].length))[0].replace(/\s+/g, ' ').trim();
    byId.set(id[1], el);
  }
  const document = {
    body: new FakeNode('body'),
    createElement: (tag) => new FakeNode(tag),
    getElementById: (id) => byId.get(id) || null,
  };
  return { document, byId };
}

// Start the page like a visit where the browser restored a pasted form, so it loads nothing by itself.
async function openPage(clipboard) {
  const page = createDom();
  page.byId.get('paste').value = '{}';
  const { start } = await import(APP_URL.href);
  await start({
    document: page.document,
    location: { search: '', href: 'https://example.test/' },
    fetch: async () => {
      throw new Error('these contracts do not use the network');
    },
    navigator: { clipboard },
  });
  return page;
}

// ---- R10.1 ----

test('R10.1 the page heading is one sentence naming the idea, above the sample bar', () => {
  const headings = HTML.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) || [];
  assert.equal(headings.length, 1, 'the page has one heading');
  assert.equal(words(headings[0]), IDEA, 'the heading is the idea in one sentence');
  const at = HTML.indexOf('<h1');
  assert.ok(at < idAt('sample-note'), 'the heading comes before the sample note');
  assert.ok(at < idAt('sample-row'), 'the heading comes before the sample buttons');
  assert.ok(at < idAt('open'), 'the heading comes before the way to open your own receipt');
  assert.ok(at < idAt('verdict'), 'the heading comes before the verdict banner');
  // The heading must not push the first-visit view out of Requirement 9.5, and its size is still compact. The above-fold
  // contract measures the rest. Revised Nov 16 (10.1): above the banner the only headings are the page heading, the play's
  // heading and "How it works", in that order. Revised Nov 17 (10.1): the page heading is the new sentence.
  const above = (HTML.slice(HTML.indexOf('<body'), idAt('verdict')).match(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/g) || []).map(words);
  assert.deepEqual(above, [IDEA, 'Try the gate on this page', 'How it works'], 'the headings above the banner');
  const size = /(^|[\s;{}])h1\s*{[^}]*font-size:\s*clamp\(\s*([\d.]+)rem/.exec(CSS);
  assert.ok(size && Number(size[2]) <= 1.5, 'the heading stays compact at phone width');
});

// ---- R10.2 ----

test('R10.2 (revised Nov 16) a "How it works" section follows the play, before the sample bar, with three steps, the demo command, a copy button and what the demo needs', async () => {
  // Directly after the play and before the sample bar, in reading order.
  const play = section('play');
  const how = section('how');
  assert.equal(HTML.slice(play.end, how.start).trim(), '', 'nothing stands between the play and the section');
  assert.ok(how.end < idAt('sample-row'), 'the section comes before the sample bar');
  assert.match(how.text, /<h2[^>]*>\s*How it works\s*<\/h2>/);

  // Three numbered steps, in this order.
  const list = /<ol\b[^>]*>([\s\S]*?)<\/ol>/.exec(how.text);
  assert.ok(list, 'the steps are an ordered list');
  const steps = [...list[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => words(m[1]));
  assert.equal(steps.length, 3, 'three steps');
  assert.match(steps[0], /person.*freezes.*contracts/i);
  assert.match(steps[1], /gate.*refuses.*pass/i);
  assert.match(steps[2], /receipt.*re-run/i);
  // Revised Nov 17 (10.2): some receipts need pytest, npm ci or a browser to re-run, so "anyone" was dropped.
  assert.match(steps[2], /\breceipt you can re-run\b/i, 'step 3 says "a receipt you can re-run"');
  assert.doesNotMatch(steps[2], /\banyone\b/i, 'step 3 no longer says anyone');

  // The command is in a code block, and the first <pre> with an id stays the re-run command, so the code element
  // carries the id.
  const block = /<pre\b[^>]*>\s*<code\b[^>]*\bid="demo-command"[^>]*>([^<]*)<\/code>\s*<\/pre>/.exec(how.text);
  assert.ok(block, 'the command is in a <pre><code> block');
  assert.equal(block[1].trim(), DEMO);
  assert.match(how.text, /<button\b[^>]*\bid="demo-copy"[^>]*>[^<]*copy[^<]*<\/button>/i, 'the section has a copy button');

  // One line: what the demo needs and what it shows.
  assert.match(words(how.text), /Needs Node\.js 24 and git, and shows the gate refuse a planted bug, accept the fix and re-check the receipt\./);

  // The copy button puts exactly the command on the clipboard, and says what to do when the clipboard refuses.
  const written = [];
  const page = await openPage({ writeText: async (text) => void written.push(text) });
  await page.byId.get('demo-copy').dispatch('click');
  assert.deepEqual(written, [DEMO], 'the copy button writes the demo command');
  assert.equal(page.byId.get('demo-copy-note').textContent, 'Copied.');

  const refused = await openPage({
    writeText: async () => {
      throw new Error('denied');
    },
  });
  await refused.byId.get('demo-copy').dispatch('click');
  assert.equal(refused.byId.get('demo-copy-note').textContent, 'Select the command and copy it.');
});

// ---- R10.3 ----

test('R10.3 plain links to the demo video and the repository, with the Content Security Policy unchanged and nothing embedded', () => {
  const how = section('how').text;
  const hrefs = [...how.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual([...hrefs].sort(), [REPO, VIDEO].sort(), 'the section links to the video and the repository, and to nothing else');
  assert.ok(VIDEO, 'README.md has a youtu.be link');
  const video = [...how.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([^<]*)<\/a>/g)].find((m) => m[1] === VIDEO);
  assert.ok(video && /video/i.test(video[2]), 'the video link says what it is');
  assert.match(how, /<a\b[^>]*href="https:\/\/github\.com\/vijaygopalbalasa\/contract-necromancer"[^>]*>[^<]*repository[^<]*<\/a>/i, 'the repository link says what it is');

  // The Content Security Policy is the one from the design, byte for byte.
  const csp = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(HTML);
  assert.ok(csp, 'the page has a Content Security Policy');
  assert.equal(csp[1], CSP);

  // Nothing is embedded or loaded for the story: no frame, media, object, extra script, style or style sheet. Revised Nov 17
  // (10.3): exactly one <img> is allowed, the screenshot of Requirement 17, from an inline data:image/webp URL with alt text.
  assert.doesNotMatch(HTML, /<(iframe|video|audio|embed|object|source|picture|style)\b/i);
  const images = HTML.match(/<img\b[^>]*>/gi) || [];
  assert.equal(images.length, 1, 'the page has exactly one <img>, the screenshot of Requirement 17');
  assert.match(images[0], /\ssrc="data:image\/webp[;,][^"]*"/i, 'its source is an inline data:image/webp URL');
  const alt = /\salt="([^"]*)"/i.exec(images[0]);
  assert.ok(alt && alt[1].trim() !== '', 'its alt text is not empty');
  assert.equal((HTML.match(/<script\b/g) || []).length, 1, 'the one module script');
  assert.equal((HTML.match(/<link\b(?![^>]*rel="icon")/g) || []).length, 1, 'the one style sheet (the inline data: favicon of R11.5 aside)');
});

// Added Nov 17 after review: R10.3 above reads index.html, so an image that app.js adds is not counted there. This reads the page
// as it is drawn, with scripts on and settled, at both sizes.
test('R10.3 with scripts on and settled the page has exactly one img element, the screenshot of Requirement 17, so an image added by the script counts against the one allowed', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure(size, () => ({
        images: [...document.querySelectorAll('img')].map((e) => ({ inFigure: !!e.closest('figure'), dataUrl: (e.getAttribute('src') || '').startsWith('data:image/webp;base64,') })),
      }));
      const at = `at ${size.width}`;
      assert.equal(m.images.length, 1, `${at}: the settled page has exactly one img element`);
      assert.ok(m.images[0].inFigure, `${at}: the one img is in the figure`);
      assert.ok(m.images[0].dataUrl, `${at}: its source is an inline data:image/webp URL`);
    }
  });
});

// ---- R10.4 ----

test('R10.4 the title starts with "Contract Necromancer", the page reads in the order it is drawn, and How it works has no fixed width and nothing in it that does not wrap but the demo command', () => {
  assert.match(HTML, /<title>Contract Necromancer\b[^<]*<\/title>/);

  // The document order is the story (Requirement 16.2, revised Nov 16): brand and heading, real-use line, story strip, result
  // element, play, How it works, sample bar, open your own receipt, verdict banner, receipt, hash check, re-run command, file
  // check, about.
  const order = ['brand', 'real-use', 'strip', 'evidence', 'play', 'how', 'sample-row', 'open', 'verdict', 'receipt', 'hash-check', 'run', 'file-check', 'about'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(idAt(order[i - 1]) < idAt(order[i]), `#${order[i - 1]} must come before #${order[i]}`);
  }

  // No CSS moves anything away from its place in the document.
  assert.doesNotMatch(CSS, /(^|[\s;{])order\s*:/, 'no flex or grid order');
  assert.doesNotMatch(CSS, /(row|column)-reverse/, 'no reversed flex direction');
  assert.doesNotMatch(CSS, /grid-template-areas|grid-area\s*:/, 'no grid areas');
  assert.doesNotMatch(CSS, /direction\s*:\s*rtl/, 'no right-to-left flow');

  // It can wrap at phone width: a viewport tag, no fixed widths on the section, and no white-space that stops wrapping on any
  // rule that styles the section, except the rules of the demo command's own box (revised Nov 17, 10.4: the box scrolls).
  assert.match(HTML, /<meta[^>]*name="viewport"[^>]*content="width=device-width, initial-scale=1"/);
  // Every innermost rule of the style sheet, also the first rule inside a media query, as { selectors, body }.
  const allRules = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selectors: m[1].trim(), body: m[2] }))
    .filter((r) => !r.selectors.startsWith('@'));
  // The demo command's own box: .demo, pre.demo, .demo code, #demo-command (also with How it works in front, and code#demo-command).
  const ownBox = (selector) => /^(?:(?:section)?(?:#|\.)how\s+)?(?:pre\.demo|\.demo|\.demo\s+code|(?:pre\.demo\s+|\.demo\s+)?(?:code)?#demo-command)$/.test(selector.trim().replace(/\s+/g, ' '));
  // The strip's command box (11.3): the same freedom, for the rules that style .try code or #strip-command.
  const stripBox = (selector) => /^(?:(?:section)?(?:#|\.)strip\s+)?(?:\.try\s*>?\s*code|(?:\.try\s*>?\s*)?(?:code)?#strip-command)$/.test(selector.trim().replace(/\s+/g, ' '));
  const stopsWrapping = /(?:^|[\s;])(?:white-space\s*:\s*(?:pre|nowrap)|text-wrap(?:-mode)?\s*:\s*nowrap)\s*(?:!important\s*)?(?:;|$)/;
  const rules = allRules.filter((r) => /\.(how|steps|demo|links)\b|#how\b/.test(r.selectors));
  assert.ok(rules.length > 0, 'style.css styles the section');
  for (const r of rules) {
    assert.doesNotMatch(r.body, /(?:^|[\s;])(?:min-)?width\s*:\s*[\d.]+(?:px|rem|em|vw)/, `${r.selectors} sets a fixed width`);
    // Revised Nov 17 (10.4), and again after review: the old ban on white-space pre or nowrap stays for every rule that styles
    // How it works, except a rule whose every selector names only the demo command's own box. The computed test below reads
    // the same thing in Chrome.
    if (stopsWrapping.test(r.body)) {
      assert.ok(r.selectors.split(',').every(ownBox), `${r.selectors} stops wrapping in How it works, and only the demo command's own box may`);
    }
  }
  // The rest of the page: a rule that stops a pre or a code element from wrapping must name only the box of the demo command or
  // the strip command, so a rule on the re-run command, the diff lines or a play result cannot slip in.
  for (const r of allRules) {
    if (!stopsWrapping.test(r.body)) continue;
    const parts = r.selectors.split(',').map((x) => x.trim());
    if (!parts.some((x) => /(^|[\s>+~.#])(pre|code)\b|command|\.diff|\.play-message/.test(x))) continue;
    assert.ok(parts.every((x) => ownBox(x) || stripBox(x)), `${r.selectors} stops a code block from wrapping, and only the two command boxes may`);
  }
  assert.match(CSS, /(^|[\s,}])pre\s*{[^}]*white-space:\s*pre-wrap/, 'pre wraps');
  assert.match(CSS, /overflow-wrap\s*:\s*anywhere/);
});

// Revised Nov 17 (10.4): computed styles, read in real Chrome. The demo commands (#demo-command and #strip-command) stay on
// one line in a box of their own that scrolls sideways; every other pre and code element, drawn or not (computed white-space is
// read for hidden elements too), keeps wrapping; the page itself does not scroll sideways at 390x844. Revised again Nov 17
// after review: Chrome with mobile emulation widens innerWidth to the content when a page is wider than the window, so
// innerWidth cannot show a page that scrolls sideways. This test therefore asserts that innerWidth is the width asked for, and
// compares the page's scroll widths and each command box's right edge with document.documentElement.clientWidth, which stays
// the window's width. No other size or position is compared, and no number is pinned. With scripts on and settled it also
// counts the img elements and allows at most one, so an image that app.js adds counts against 10.3. It is "at most one" here
// and not "exactly one" because this test belongs to task 34 and the one image is built by task 35 (a task that names 10.4 must
// pass on a page with no figure yet). "Exactly one" is the R10.3 test above, with scripts on and settled.
test('R10.4 (revised Nov 17) the demo command stays on one line in its own box that scrolls sideways, every other code block wraps, and the page does not scroll sideways at 390x844', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure(size, () => {
        const clean = (t) => t.replace(/\s+/g, ' ').trim();
        const clientWidth = document.documentElement.clientWidth;
        const commands = ['demo-command', 'strip-command'].map((id) => {
          const e = document.getElementById(id);
          if (!e) return { id, found: false };
          // Its own box: the element when it is a box of its own, else its parent when the parent holds nothing but this command.
          const own = getComputedStyle(e).display === 'inline' ? e.parentElement : e;
          const box = getComputedStyle(own);
          // The lines the command is drawn on: client rectangles of its text that do not overlap in height are different lines.
          const range = document.createRange();
          range.selectNodeContents(e);
          const rows = [];
          for (const q of range.getClientRects()) {
            if (!rows.some((row) => q.top < row.bottom && q.bottom > row.top)) rows.push({ top: q.top, bottom: q.bottom });
          }
          return {
            id,
            found: true,
            text: clean(e.textContent),
            ownText: clean(own.textContent),
            ownIsPageBody: own === document.body || own === document.documentElement,
            whiteSpace: getComputedStyle(e).whiteSpace,
            overflowX: box.overflowX,
            ownDisplay: box.display,
            lines: rows.length,
            drawn: e.getClientRects().length > 0,
            fitsWindow: own.getBoundingClientRect().right <= clientWidth + 0.5,
          };
        });
        // Every other pre and code element, drawn or not: the re-run command and the play's code sit in boxes that start hidden.
        const others = [...document.querySelectorAll('pre, code')]
          .filter((e) => !e.closest('#demo-command, #strip-command') && !e.querySelector('#demo-command, #strip-command'))
          .map((e) => ({ tag: e.tagName, id: e.id || e.className || '', whiteSpace: getComputedStyle(e).whiteSpace }));
        return {
          innerWidth,
          clientWidth,
          commands,
          others,
          images: document.querySelectorAll('img').length,
          sideways: document.documentElement.scrollWidth > clientWidth || document.body.scrollWidth > clientWidth,
        };
      });
      const at = `at ${size.width}`;
      assert.equal(m.innerWidth, size.width, `${at}: the window is ${size.width} wide (it is ${m.innerWidth}, so the page is wider than the window)`);
      assert.ok(m.images <= 1, `${at}: with scripts on and settled the page has ${m.images} img elements, and 10.3 allows one, so the script added one`);
      for (const c of m.commands) {
        assert.ok(c.found, `${at}: index.html has #${c.id}`);
        assert.ok(c.drawn, `${at}: #${c.id} is drawn`);
        assert.equal(c.text, DEMO, `${at}: #${c.id} holds the demo command`);
        assert.ok(['nowrap', 'pre'].includes(c.whiteSpace), `${at}: #${c.id} has computed white-space nowrap or pre, not ${c.whiteSpace}`);
        assert.ok(['auto', 'scroll'].includes(c.overflowX), `${at}: the box of #${c.id} has computed overflow-x auto or scroll, not ${c.overflowX}`);
        assert.notEqual(c.ownDisplay, 'inline', `${at}: the box of #${c.id} is a box of its own, not inline text`);
        assert.ok(!c.ownIsPageBody, `${at}: the box of #${c.id} is not the page itself`);
        assert.equal(c.ownText, DEMO, `${at}: the box of #${c.id} holds the command and nothing else`);
        assert.equal(c.lines, 1, `${at}: #${c.id} is on one line, no word of it is split across lines`);
        assert.ok(c.fitsWindow, `${at}: the box of #${c.id} does not reach past the window's client width, so the box scrolls, not the page`);
      }
      assert.ok(m.others.length > 0, `${at}: the page has other code blocks to check`);
      for (const o of m.others) {
        assert.ok(!['nowrap', 'pre'].includes(o.whiteSpace), `${at}: <${o.tag.toLowerCase()}> ${o.id} is another code element and keeps wrapping, but its computed white-space is ${o.whiteSpace}`);
      }
      assert.equal(m.sideways, false, `${at}: the page does not scroll sideways (its scroll width is wider than the client width of ${m.clientWidth})`);
    }
  });
});
