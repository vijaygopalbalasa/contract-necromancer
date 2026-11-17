// Contracts for Requirement 17 of the receipt-viewer spec (revised Nov 17, again Nov 18): the real Kiro session on the first
// screen. Inside the header, after the line of 14.1 and before the real-use line of 16.3, a figure gives in its caption, as text
// readable without JavaScript, Kiro's words in quotation marks and then the label "Real Kiro session, recorded Nov 8, not a
// simulation." (17.1). From 52rem up the quoted words are set larger than the body text (17.1 and 17.4). The figure holds no
// <img> and no other picture (17.2). The label is the figure's only link, an a element whose text is exactly the label, and it
// opens on GitHub the evidence image .kiro/build-log/film/take6-refusal.webp, which exists in this repository with the SHA-256
// a person froze below (17.3 and 17.4). The figure plays no video and does not animate (17.3). Requirement 9.5 at 1280x800 and
// at 390x844 stays in above-fold-v2.contract.test.js and is not repeated here.
//
// Per Requirement 17.4 (as 14.5 and 16.5) nothing here pins a pixel size or a position. The tests read the DOM order, text,
// attributes, bytes, computed font sizes (one against the other) and computed animation names in real Chrome, at the two window
// sizes of 9.5. The last test reads this file and checks that.
//
// Layout is measured in a headless Chrome or Chromium: the file serves site/ from a local server on 127.0.0.1, sets the window
// size and reads the page over the DevTools protocol (Node's built-in WebSocket, no dependencies). Set CHROME_PATH if the
// browser is somewhere unusual. With no browser a test skips with a reason that starts with "cannot run:" (Requirement 16.7),
// and a layout that was not measured never passes. no-browser.contract.test.js finds this file by what it does (it reads
// CHROME_PATH), so it needs no entry anywhere.
//
// Revised Nov 17 after review: "drawn" means visible (shownInPage below: a box, visible, opaque, not clipped, not cut off by its
// own box, for the element and every ancestor), the figure is checked against the heading and the two lines around it for
// overlap, the figure and its ancestors are checked for animations and transitions, and the evidence image is pinned by the
// SHA-256 a person froze (the lock pins contract files only, so a swapped file would pass otherwise). Revised Nov 18: the
// screenshot and its data: URL are gone; the pinned file is the evidence image the label links to.
//
// There is no shared helper file (a helper would not be frozen), so the browser code is carried in this file, as in
// try-first.contract.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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


const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, mobile: true };

const QUOTE = "I couldn't mark task 4 complete. A hook blocked the edit to tasks.md and reported failing contracts, so the checkbox is still [ ].";
const LABEL = 'Real Kiro session, recorded Nov 8, not a simulation.';
const EVIDENCE_PATH = '.kiro/build-log/film/take6-refusal.webp';
const EVIDENCE_URL = 'https://github.com/vijaygopalbalasa/contract-necromancer/blob/main/.kiro/build-log/film/take6-refusal.webp';
const EVIDENCE = fs.readFileSync(new URL(`../../${EVIDENCE_PATH}`, import.meta.url));
const NO_SCRIPTS = { scripts: false, settle: false };

// The SHA-256 of .kiro/build-log/film/take6-refusal.webp as a person froze it (Requirement 17.4, revised Nov 18). It was computed
// from the file with `shasum -a 256 .kiro/build-log/film/take6-refusal.webp`, never typed by hand. A new evidence image means a
// new hash here, which is a change to this frozen file and so a decision for a person.
const EVIDENCE_SHA256 = '66c603dfa67e8e1de51d878fea32296f4b412064a82ec5489ba3cc2e851f9222';

// "Drawn" means visible. This function is sent into the page as text (Function.prototype.toString), so it uses nothing from this
// file. An element is shown when it has a client rect with a box, when it and every ancestor have computed visibility
// "visible", opacity "1", clip "auto" and clip-path "none", when its own text is not transparent and it is not drawn beside
// the page, and when nothing of it is cut off by its own box (the page's own .sr-only rules cut a box down to a point). It
// pins no number and no font size.
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

// A probe that can call shownInPage: the page gets both functions as one piece of text.
const withShown = (probe) => new Function(`const shownInPage = ${shownInPage.toString()};\nreturn (${probe.toString()})();`);

// ---- 17.1: where the figure sits, and what its caption says ----

test('R17.1 the figure is inside the header after the line of 14.1, the real-use line still comes directly after the header, and both read without JavaScript', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure({ ...size, ...NO_SCRIPTS, reducedMotion: true }, () => {
        const header = document.getElementById('brand');
        const idea = document.getElementById('idea');
        const real = document.getElementById('real-use');
        const figures = [...document.querySelectorAll('figure')];
        const figure = figures[0] || null;
        const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        // Revised Nov 17 after review: where the figure is drawn, its box (and the boxes of what it holds) overlaps none of the
        // boxes of the heading, the line of 14.1 and the real-use line. The boxes are compared with each other, no number.
        const boxOf = (e) => {
          const r = e.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, area: r.width * r.height };
        };
        const meets = (a, b) => a.area > 0 && b.area > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const around = [['the heading', document.querySelector('h1')], ['the line of 14.1', idea], ['the real-use line', real]].filter(([, e]) => !!e);
        const mine = figure ? [figure, ...figure.querySelectorAll('*')] : [];
        const overlaps = [];
        for (const [name, other] of around) {
          for (const e of mine) if (meets(boxOf(e), boxOf(other))) overlaps.push(`${e.tagName.toLowerCase()} of the figure overlaps ${name}`);
        }
        return {
          overlaps,
          around: around.length,
          figures: figures.length,
          inHeader: !!figure && header.tagName === 'HEADER' && header.contains(figure),
          insideIdea: !!figure && (idea.contains(figure) || figure.contains(idea)),
          afterIdea: !!figure && follows(idea, figure),
          beforeReal: !!figure && !!real && follows(figure, real),
          realDirectlyAfterHeader: !!real && header.nextElementSibling === real,
        };
      });
      const at = `at ${size.width}`;
      assert.equal(m.figures, 1, `${at}: the page has one figure`);
      assert.ok(m.inHeader, `${at}: the figure is inside the header`);
      assert.ok(!m.insideIdea, `${at}: the figure is not part of the line of 14.1`);
      assert.ok(m.afterIdea, `${at}: the figure comes after the line of 14.1`);
      assert.ok(m.beforeReal, `${at}: the figure comes before the real-use line`);
      assert.ok(m.realDirectlyAfterHeader, `${at}: the real-use line comes directly after the header`);
      assert.equal(m.around, 3, `${at}: the heading, the line of 14.1 and the real-use line were all found`);
      assert.deepEqual(m.overlaps, [], `${at}: the figure is drawn over nothing around it`);
    }
  });
});

// Revised Nov 18: the label is now a link. This test passes only while the link's text is exactly the label and a space
// separates the closing quotation mark from the a element, because it reads the caption's text as one string.
test('R17.1 the caption is the quoted words in quotation marks and then the label, as text, drawn at both window sizes with scripts off', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure({ ...size, ...NO_SCRIPTS }, withShown(() => {
        const figure = document.querySelector('figure');
        const caption = figure ? figure.querySelector('figcaption') : null;
        if (!caption) return { caption: false, text: '', drawn: false, shown: false, parent: false };
        const style = getComputedStyle(caption);
        return {
          caption: true,
          parent: caption.parentElement === figure,
          text: caption.textContent.replace(/\s+/g, ' ').trim(),
          drawn: caption.getClientRects().length > 0 && style.visibility === 'visible' && style.display !== 'none',
          shown: shownInPage(caption),
        };
      }));
      const at = `at ${size.width}`;
      assert.ok(m.caption && m.parent, `${at}: the figure has a figcaption of its own`);
      assert.ok(m.drawn, `${at}: the caption is drawn`);
      assert.ok(m.shown, `${at}: the caption is shown, not only drawn: visible, opaque, not clipped, not cut off by its own box (17.1: visible at every window width)`);
      const parts = /^["\u201c](.*)["\u201d] (.*)$/.exec(m.text);
      assert.ok(parts, `${at}: the caption starts with the words in quotation marks and goes on with the label: "${m.text}"`);
      assert.equal(parts[1], QUOTE, `${at}: the quoted words`);
      assert.equal(parts[2], LABEL, `${at}: the label comes after the quoted words`);
      assert.doesNotMatch(m.text, /[\u2013\u2014]/, `${at}: no em or en dashes`);
    }
  });
});

// ---- 17.2: no picture, 17.3: the label is the link, 17.4: the evidence image and the words' size ----

test('R17.2 the figure holds no img and no other picture, with scripts off and with scripts on and settled, at both window sizes', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      for (const [how, options] of [['scripts off', { ...size, ...NO_SCRIPTS }], ['scripts on and settled', { ...size }]]) {
        const m = await browser.measure(options, () => {
          const figure = document.querySelector('figure');
          if (!figure) return null;
          const all = [figure, ...figure.querySelectorAll('*')];
          return {
            pictures: [...figure.querySelectorAll('img, picture, svg, canvas, video, object, embed, iframe, image, source, input[type="image"]')].map((e) => e.tagName),
            backgrounds: all.map((e) => [e, getComputedStyle(e), getComputedStyle(e, '::before'), getComputedStyle(e, '::after')])
              .flatMap(([e, ...styles]) => styles.map((st) => `${e.tagName}:${st.backgroundImage}:${st.listStyleImage}:${st.maskImage}`))
              .filter((t) => !/^[A-Z0-9]+:none:none:none$/.test(t)),
            contentUrls: all.flatMap((e) => ['::before', '::after'].map((p) => getComputedStyle(e, p).content)).filter((c) => /url\(|image-set\(/.test(c)),
          };
        });
        const at = `at ${size.width}, ${how}`;
        assert.ok(m, `${at}: the page has a figure`);
        assert.deepEqual(m.pictures, [], `${at}: the figure holds no img and no other picture element`);
        assert.deepEqual(m.backgrounds, [], `${at}: nothing in the figure draws a picture with CSS (background, list marker or mask)`);
        assert.deepEqual(m.contentUrls, [], `${at}: no generated content in the figure is a picture`);
      }
    }
  });
});

test('R17.3 and R17.4 the label is the figure\'s only link, an a element whose text is exactly the label and whose href is the evidence image on GitHub, and the file at that path exists with the SHA-256 a person froze', { skip: NO_BROWSER }, async () => {
  assert.ok(EVIDENCE.length > 0, `${EVIDENCE_PATH} is there and not empty`);
  assert.equal(EVIDENCE.subarray(0, 4).toString('latin1'), 'RIFF', 'the evidence image is a WebP file');
  assert.equal(EVIDENCE.subarray(8, 12).toString('latin1'), 'WEBP', 'the evidence image is a WebP file');
  // The path the href names, below the repository's main branch, is the file that is read and hashed here.
  const prefix = 'https://github.com/vijaygopalbalasa/contract-necromancer/blob/main/';
  assert.ok(EVIDENCE_URL.startsWith(prefix) && EVIDENCE_URL.slice(prefix.length) === EVIDENCE_PATH, 'the expected address names the evidence image path');
  assert.equal(fs.existsSync(fileURLToPath(new URL(`../../${EVIDENCE_PATH}`, import.meta.url))), true, `${EVIDENCE_PATH} exists in this repository`);
  assert.equal(createHash('sha256').update(EVIDENCE).digest('hex'), EVIDENCE_SHA256, `the SHA-256 of ${EVIDENCE_PATH} is the one a person froze`);
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      for (const [how, options] of [['scripts off', { ...size, ...NO_SCRIPTS }], ['scripts on and settled', { ...size }]]) {
        const m = await browser.measure(options, () => {
          const figure = document.querySelector('figure');
          if (!figure) return null;
          const caption = figure.querySelector('figcaption');
          const links = [...figure.querySelectorAll('a, area, [href]')];
          const a = links[0] || null;
          return {
            count: links.length,
            tag: a ? a.tagName : null,
            inCaption: !!a && !!caption && caption.contains(a),
            text: a ? a.textContent.replace(/\s+/g, ' ').trim() : null,
            href: a ? a.getAttribute('href') : null,
            resolved: a ? a.href : null,
            anchorsOutside: figure.closest('a, [href]') ? 1 : 0,
          };
        });
        const at = `at ${size.width}, ${how}`;
        assert.ok(m, `${at}: the page has a figure`);
        assert.equal(m.count, 1, `${at}: the figure has exactly one link (it has ${m.count})`);
        assert.equal(m.tag, 'A', `${at}: the link is an a element`);
        assert.ok(m.inCaption, `${at}: the link is in the caption`);
        assert.equal(m.anchorsOutside, 0, `${at}: the figure is not itself inside a link`);
        assert.equal(m.text, LABEL, `${at}: the link text is exactly the label`);
        assert.equal(m.href, EVIDENCE_URL, `${at}: the href is the evidence image on GitHub`);
        assert.equal(m.resolved, EVIDENCE_URL, `${at}: the resolved address is the evidence image on GitHub`);
        assert.equal(m.resolved.slice(prefix.length), EVIDENCE_PATH, `${at}: the path in the address is the file hashed above`);
      }
    }
  });
});

test('R17.1 at 1280x800 the quoted words are set larger than the body text, compared with each other and not against a pixel value, and at 390x844 the caption is still shown', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    const probe = withShown(() => {
      const caption = document.querySelector('figure figcaption');
      if (!caption) return null;
      // The quoted words: the element that directly holds the text node that starts the quotation.
      const walker = document.createTreeWalker(caption, NodeFilter.SHOW_TEXT);
      let holder = null;
      for (let n = walker.nextNode(); n && !holder; n = walker.nextNode()) if (/^\s*["\u201c]?I couldn/.test(n.nodeValue)) holder = n.parentElement;
      return {
        quoteSize: holder ? Number.parseFloat(getComputedStyle(holder).fontSize) : NaN,
        bodySize: Number.parseFloat(getComputedStyle(document.body).fontSize),
        quoteShown: shownInPage(holder),
        captionShown: shownInPage(caption),
      };
    });
    const wide = await browser.measure({ ...DESKTOP, ...NO_SCRIPTS }, probe);
    assert.ok(wide, 'the figure has a caption');
    assert.ok(Number.isFinite(wide.quoteSize) && Number.isFinite(wide.bodySize), 'the quoted words and the body text both have a computed font size');
    assert.ok(wide.quoteSize > wide.bodySize, `at 1280x800 the quoted words (${wide.quoteSize}) are larger than the body text (${wide.bodySize}), 17.1 and 17.4`);
    assert.ok(wide.quoteShown, 'at 1280x800 the quoted words are shown, not only drawn');
    assert.ok(wide.captionShown, 'at 1280x800 the caption is shown');
    const narrow = await browser.measure({ ...PHONE, ...NO_SCRIPTS }, probe);
    assert.ok(narrow, 'the figure has a caption at the phone size');
    assert.ok(narrow.quoteShown, 'at 390x844 the quoted words are shown, so the words are still there');
    assert.ok(narrow.captionShown, 'at 390x844 the caption is shown, not hidden by a rule that keeps it for a screen reader only');
  });
});

// ---- 17.3: one link, no video, no animation ----

test('R17.3 the label\'s a is the only control in the figure, which plays no video, and neither the figure nor anything in it or around it has an animation or a transition, with motion welcome', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure({ ...size, reducedMotion: false, settle: false }, () => {
        const figure = document.querySelector('figure');
        if (!figure) return null;
        const all = [figure, ...figure.querySelectorAll('*')];
        return {
          inLink: !!figure.closest('a, [href]'),
          controls: [...figure.querySelectorAll('a, area, [href], [onclick], button, input, summary, [role="link"], [role="button"]')].map((e) => e.tagName),
          labelIsLink: [...figure.querySelectorAll('a')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
          media: [...figure.querySelectorAll('video, audio, iframe, embed, object, canvas, source, picture, svg, animate, animateTransform')].map((e) => e.tagName),
          names: all.map((e) => `${e.tagName}:${getComputedStyle(e).animationName}`),
          running: figure.getAnimations({ subtree: true }).length,
          // Revised Nov 17 after review: not only the figure's own subtree. An animation on anything that holds the figure (the
          // header, main, the body) moves or fades the figure too, so every animation whose target is the figure, is inside it
          // or holds it counts, and every ancestor has animation-name none. A transition of the figure or of anything in it
          // (a hover effect) is motion as well, so its transition-duration is 0s.
          held: document.getAnimations().filter((a) => a.effect && a.effect.target && (figure.contains(a.effect.target) || a.effect.target.contains(figure))).length,
          ancestors: (() => {
            const out = [];
            for (let n = figure.parentElement; n; n = n.parentElement) out.push(`${n.tagName}${n.id ? '#' + n.id : ''}:${getComputedStyle(n).animationName}`);
            return out;
          })(),
          transitions: all.map((e) => `${e.tagName}:${getComputedStyle(e).transitionDuration}`),
        };
      });
      const at = `at ${size.width}`;
      assert.ok(m, `${at}: the page has a figure`);
      assert.ok(!m.inLink, `${at}: the figure is not inside a link`);
      // Revised Nov 18: the only control in the figure is the label's a (17.3); before, the figure had none.
      assert.deepEqual(m.controls, ['A'], `${at}: the only control in the figure is the label's a`);
      assert.deepEqual(m.labelIsLink, [LABEL], `${at}: that a holds the label`);
      assert.deepEqual(m.media, [], `${at}: nothing in the figure plays or draws a moving picture`);
      assert.ok(m.names.length >= 3, `${at}: the figure, its caption and the label's a were all read`);
      assert.ok(m.names.every((n) => n.endsWith(':none')), `${at}: the computed animation-name of the figure and of everything in it is none (${m.names.join(', ')})`);
      assert.equal(m.running, 0, `${at}: nothing in the figure is animating`);
      assert.equal(m.held, 0, `${at}: nothing that is the figure, is inside it or holds it is animating`);
      assert.ok(m.ancestors.length >= 3, `${at}: the ancestors of the figure were read (${m.ancestors.join(', ')})`);
      assert.ok(m.ancestors.every((n) => n.endsWith(':none')), `${at}: the computed animation-name of every ancestor of the figure is none (${m.ancestors.join(', ')})`);
      assert.ok(m.transitions.every((t) => t.split(':')[1].split(',').every((d) => d.trim() === '0s')), `${at}: the figure and everything in it have transition-duration 0s (${m.transitions.join(', ')})`);
    }
  });
});

// ---- 17.4: this file pins no pixel size or position ----

test('R17.4 this file pins no pixel size or position: no px unit, no assertion against a numeric box value, and the window sizes appear only in the two named constants', () => {
  const source = read('contracts/receipt-viewer/kiro-session.contract.test.js');
  assert.doesNotMatch(source, /\d\s*px\b/, 'a size in pixels');
  const lines = source.split('\n');
  const windowNumbers = /\b(1280|800|390|844)\b/;
  const where = lines.map((l, i) => [l, i]).filter(([l]) => windowNumbers.test(l) && !l.trim().startsWith('//') && !/^const (DESKTOP|PHONE) = |const windowNumbers = /.test(l));
  assert.deepEqual(where.map(([l, i]) => `${i + 1}: ${l.trim()}`), [], 'a window size outside the two constants');
  const comparisons = lines.map((l, i) => [l, i]).filter(([l]) => /\b(top|bottom|left|right|width|height|scrollY|scrollX)\b[^;]*(<=|>=|===?|<|>)\s*[1-9]\d*\b/.test(l) && !l.trim().startsWith('//'));
  assert.deepEqual(comparisons.map(([l, i]) => `${i + 1}: ${l.trim()}`), [], 'a box compared with a number');
});
