// Contracts for Requirement 16 of the receipt-viewer spec (revised Nov 16): the play is open on load directly after the result
// element, and Try it here moves focus to Send the tick (16.1); the page reads in a fixed order, and each requirement's contract
// list is folded behind one summary line, with one control that unfolds all (16.2); one line on real use after the page heading,
// readable without JavaScript, with two links (16.3); the result also gives the size of the experiment (16.4); a static summary
// of the sample receipt is written in index.html for scripts off, and this file compares it with site/sample-receipt.json so the
// two cannot drift (16.6). The video link of 10.3 is in video-link.contract.test.js.
//
// Per Requirement 16.5 (as 14.5) nothing here pins a pixel size or a position. The tests read the DOM order, open or folded
// state, text, and whether an element is drawn or inside the window, so they pass on any operating system's fonts. The test
// before the last reads this file and checks that.
//
// Layout is measured in a headless Chrome or Chromium: the file serves site/ from a local server on 127.0.0.1, sets the window
// size and reads the page over the DevTools protocol (Node's built-in WebSocket, no dependencies). Set CHROME_PATH if the
// browser is somewhere unusual. With no browser a test skips with a reason that starts with "cannot run:" (Requirement 16.7), and
// a layout that was not measured never passes.
//
// There is no shared helper file (a helper would not be frozen), so the browser code is carried in this file, as in
// first-screen-v3.contract.test.js. The page script is named below the way a static import would name it, because the receipt
// pins files it finds that way. Keep this line.
//   import {} from '../../site/app.js';
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


const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const html = read('site/index.html');
const sample = JSON.parse(read('site/sample-receipt.json'));

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, mobile: true };

const PR = 'https://github.com/vijaygopalbalasa/judge-protocol/pull/29';
const CASE_STUDY_PREFIX = 'https://github.com/vijaygopalbalasa/contract-necromancer/';
const CASE_STUDY_FOLDER = 'case-studies/judge-api-errors';

const idAt = (id) => {
  const i = html.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
};
const textOf = (fragment) => fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// The element that carries this id, from its opening tag to its matching closing tag (the tag must not nest in itself).
function element(id, tag) {
  const at = idAt(id);
  const start = html.lastIndexOf('<', at);
  assert.match(html.slice(start, at), new RegExp(`^<${tag}\\b`), `#${id} is a <${tag}>`);
  const end = html.indexOf(`</${tag}>`, start) + `</${tag}>`.length;
  return { start, end, text: html.slice(start, end), words: textOf(html.slice(start, end)) };
}

// The order of the page (16.2), by the id of the element that starts each part.
const ORDER = ['brand', 'real-use', 'strip', 'evidence', 'play', 'how', 'sample-row', 'open', 'verdict', 'receipt', 'hash-check', 'run', 'file-check', 'about'];

// What the sample receipt says, worked out from the receipt itself and not from the page.
function expectedSummary() {
  const byNumber = new Map();
  for (const c of sample.contracts) {
    const m = /^R(\d+)\./.exec(c.name);
    assert.ok(m, `every sample contract name starts with R<number>: ${c.name}`);
    const n = Number(m[1]);
    if (!byNumber.has(n)) byNumber.set(n, { passed: 0, total: 0 });
    const g = byNumber.get(n);
    g.total += 1;
    if (c.result === 'pass') g.passed += 1;
  }
  const lines = [...byNumber.keys()].sort((a, b) => a - b).map((n) => `Requirement ${n} (${byNumber.get(n).passed} of ${byNumber.get(n).total} pass)`);
  const required = Array.isArray(sample.required) ? new Set(sample.required) : null;
  const living = sample.contracts.filter((c) => c.result === 'pass').length;
  const buried = sample.contracts.filter((c) => c.result === 'fail' && (!required || required.has(c.name))).length;
  const risen = buried === 0;
  return {
    lines,
    total: sample.contracts.length,
    word: risen ? 'Risen' : 'Still buried',
    count: risen ? `${living} contracts alive` : buried === 1 ? '1 required contract fails' : `${buried} required contracts fail`,
  };
}

// ---- 16.1: the play is open on load, and Try it here moves focus to Send the tick ----

test('R16.1 with scripts on the play is open on load without pressing Try it here, directly after the result element; with scripts off neither the play nor Try it here is drawn', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const on = await browser.measure(size, () => {
        const play = document.getElementById('play');
        const evidence = document.getElementById('evidence');
        const control = document.getElementById('strip-play');
        const drawn = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible';
        return {
          hidden: play.hidden,
          drawn: drawn(play),
          heading: drawn(document.getElementById('play-title')),
          steps: ['play-send', 'play-fix', 'play-byte'].map((id) => drawn(document.getElementById(id))),
          next: evidence.nextElementSibling === play,
          control: drawn(control),
          expanded: control.getAttribute('aria-expanded'),
        };
      });
      const at = `at ${size.width}`;
      assert.equal(on.hidden, false, `${at}: the play is not hidden on load`);
      assert.ok(on.drawn && on.heading, `${at}: the play and its heading are drawn on load`);
      assert.deepEqual(on.steps, [true, true, true], `${at}: the three step buttons are drawn on load`);
      assert.ok(on.next, `${at}: the play is the element right after the result element`);
      assert.ok(on.control, `${at}: Try it here is still drawn`);
      assert.equal(on.expanded, 'true', `${at}: Try it here says that the play it controls is open`);

      const off = await browser.measure({ ...size, scripts: false, settle: false }, () => ({
        play: document.getElementById('play').getClientRects().length,
        control: document.getElementById('strip-play').getClientRects().length,
      }));
      assert.deepEqual(off, { play: 0, control: 0 }, `${at}: with scripts off neither the play nor Try it here is drawn`);
    }
  });
});

test('R16.1 Try it here moves focus to the Send the tick button and leaves the play heading and that button inside the window', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure({ ...size, reducedMotion: true }, async () => {
        document.getElementById('strip-play').click();
        const seen = (id) => {
          const b = document.getElementById(id).getBoundingClientRect();
          return b.width > 0 && b.height > 0 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth;
        };
        // Give the page up to two seconds to finish moving; with reduced motion it moves at once.
        for (let i = 0; i < 40 && !(seen('play-title') && seen('play-send')); i += 1) await new Promise((r) => setTimeout(r, 50));
        return { focus: document.activeElement.id, heading: seen('play-title'), send: seen('play-send'), open: !document.getElementById('play').hidden };
      });
      const at = `at ${size.width}`;
      assert.equal(m.focus, 'play-send', `${at}: focus is on the Send the tick button`);
      assert.ok(m.open, `${at}: the play is still open`);
      assert.ok(m.heading, `${at}: the play's heading is inside the window`);
      assert.ok(m.send, `${at}: Send the tick is inside the window`);
    }
  });
});

test('R16.1 the page reads in this order: brand and heading, real-use line, story strip, result element, play, How it works, sample bar, open your own receipt, verdict banner, receipt, hash check, re-run command, file check, about (the order sentence of 16.2 too)', { skip: NO_BROWSER }, async () => {
  // In the file, so a reader without scripts gets the same order.
  for (let i = 1; i < ORDER.length; i += 1) assert.ok(idAt(ORDER[i - 1]) < idAt(ORDER[i]), `in index.html #${ORDER[i - 1]} must come before #${ORDER[i]}`);
  // In the DOM of the running page, with the sample shown.
  await withBrowser(async (browser) => {
    const m = await browser.measure(DESKTOP, () => {
      const ids = ['brand', 'real-use', 'strip', 'evidence', 'play', 'how', 'sample-row', 'open', 'verdict', 'receipt', 'hash-check', 'run', 'file-check', 'about'];
      const missing = ids.filter((id) => !document.getElementById(id));
      const wrong = [];
      for (let i = 1; i < ids.length; i += 1) {
        const a = document.getElementById(ids[i - 1]);
        const b = document.getElementById(ids[i]);
        if (a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) wrong.push(`${ids[i - 1]} before ${ids[i]}`);
      }
      return { missing, wrong };
    });
    assert.deepEqual(m.missing, [], 'every part is on the page');
    assert.deepEqual(m.wrong, [], 'the DOM order');
  });
});

// ---- 16.2: one summary line per requirement, each list folded, one control unfolds all ----

test('R16.2 the sample receipt shows its verdict banner and one summary line per requirement, each contract list folded, and one control that unfolds all of them', { skip: NO_BROWSER }, async () => {
  const want = expectedSummary();
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure(size, async () => {
        // A row inside a folded details element has no box that is shown, so ask the browser whether it is visible at all.
        const drawn = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible' && (typeof e.checkVisibility !== 'function' || e.checkVisibility());
        const rows = () => [...document.querySelectorAll('#groups li.contract')];
        const folds = () => [...document.querySelectorAll('#groups details')];
        const verdict = document.getElementById('verdict');
        const out = {
          verdict: verdict.textContent.replace(/\s+/g, ' ').trim(),
          verdictDrawn: drawn(verdict),
          summaries: folds().map((d) => (d.querySelector(':scope > summary') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim()),
          openBefore: folds().map((d) => d.open),
          rowsInPage: rows().length,
          rowsDrawnBefore: rows().filter(drawn).length,
        };
        const controls = [...document.querySelectorAll('#receipt button')].filter((b) => /unfold all/i.test(b.textContent));
        out.controls = controls.length;
        out.controlDrawn = controls.length === 1 && drawn(controls[0]);
        if (controls.length === 1) controls[0].click();
        out.openAfter = folds().map((d) => d.open);
        out.rowsDrawnAfter = rows().filter(drawn).length;
        // The rest of the receipt keeps working (Requirements 3, 4, 7, 15).
        for (let i = 0; i < 60 && document.getElementById('hash-badge').textContent !== 'MATCH'; i += 1) await new Promise((r) => setTimeout(r, 50));
        out.hash = document.getElementById('hash-badge').textContent;
        out.cards = ['receipt', 'hash-check', 'run', 'file-check'].map((id) => !document.getElementById(id).hidden);
        out.facts = ['spec', 'commit', 'receipt-hash'].map((id) => document.getElementById(id).textContent.trim() !== '');
        return out;
      });
      const at = `at ${size.width}`;
      assert.ok(m.verdictDrawn && m.verdict.startsWith(want.word) && m.verdict.includes(want.count), `${at}: the banner says "${want.word}" and "${want.count}" (it says "${m.verdict}")`);
      assert.deepEqual(m.summaries, want.lines, `${at}: one summary line per requirement`);
      assert.ok(m.openBefore.length > 0 && m.openBefore.every((o) => o === false), `${at}: every requirement starts folded`);
      assert.equal(m.rowsInPage, want.total, `${at}: all ${want.total} contract rows are still in the page`);
      assert.equal(m.rowsDrawnBefore, 0, `${at}: no contract row is drawn while the lists are folded`);
      assert.equal(m.controls, 1, `${at}: exactly one control unfolds all`);
      assert.ok(m.controlDrawn, `${at}: the control is drawn`);
      assert.ok(m.openAfter.length === want.lines.length && m.openAfter.every((o) => o === true), `${at}: the control opens every requirement`);
      assert.equal(m.rowsDrawnAfter, want.total, `${at}: every contract row is drawn after unfolding`);
      assert.equal(m.hash, 'MATCH', `${at}: the hash check still says MATCH`);
      assert.deepEqual(m.cards, [true, true, true, true], `${at}: the receipt, hash check, re-run command and file check are shown`);
      assert.deepEqual(m.facts, [true, true, true], `${at}: spec, commit and receipt hash are filled`);
    }
  });
});

test('R16.2 a requirement can be folded or unfolded on its own, and a second receipt starts folded again', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure(DESKTOP, async () => {
      const folds = () => [...document.querySelectorAll('#groups details')];
      const first = folds()[0];
      const unfold = [...document.querySelectorAll('#receipt button')].find((b) => /unfold all/i.test(b.textContent));
      if (!first || !unfold) return { oneOpen: [], closedAgain: [], buried: [], buriedCount: 0, missing: true };
      first.querySelector(':scope > summary').click();
      const oneOpen = folds().map((d) => d.open);
      first.querySelector(':scope > summary').click();
      const closedAgain = folds().map((d) => d.open);
      // Open all, then show the other sample: its lists start folded.
      unfold.click();
      document.getElementById('sample-buried').click();
      for (let i = 0; i < 100 && !/Still buried/.test(document.getElementById('verdict').textContent); i += 1) await new Promise((r) => setTimeout(r, 50));
      return { oneOpen, closedAgain, buried: folds().map((d) => d.open), buriedCount: folds().length };
    });
    assert.ok(!m.missing, 'the receipt has folded requirements and a control that unfolds all');
    assert.equal(m.oneOpen[0], true, 'the first requirement opens');
    assert.ok(m.oneOpen.slice(1).every((o) => o === false), 'the others stay folded');
    assert.ok(m.closedAgain.every((o) => o === false), 'it folds again');
    assert.ok(m.buriedCount > 0 && m.buried.every((o) => o === false), 'a second receipt starts folded');
  });
});

// ---- 16.3: the real-use line ----

test('R16.3 after the page heading one line on real use, readable without JavaScript, says the gate refused Kiro\'s first tick on a real repository and the finished fix passed all six frozen contracts and was merged, with a link to pull request 29 and one to the case study in this repository', async () => {
  const line = element('real-use', 'p');
  assert.doesNotMatch(line.text, /<(script|svg|img|button|input|h\d)\b|\bhidden\b|aria-hidden|\bon\w+=|data-/i, 'plain text, readable without JavaScript');
  assert.doesNotMatch(line.text, /[\u2013\u2014]/, 'no em or en dashes');
  const header = element('brand', 'header');
  assert.ok(line.start >= header.end, 'the line is after the header that holds the page heading');
  assert.ok(line.end < idAt('strip'), 'the line is before the story strip');
  assert.match(line.words, /judge-protocol/, 'it names the repository');
  assert.match(line.words, /refused/, 'the gate refused');
  assert.match(line.words, /first tick/, 'Kiro\'s first tick');
  assert.match(line.words, /half of a criterion/, 'which had built only half of a criterion');
  assert.match(line.words, /all six frozen contracts/, 'the finished fix passed all six frozen contracts');
  assert.match(line.words, /merged/, 'and was merged');
  assert.match(line.words, /pull request #29/, 'it names pull request #29');
  const links = [...line.text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ href: /\bhref="([^"]*)"/.exec(m[1])?.[1], text: textOf(m[2]), attrs: m[1] }));
  assert.equal(links.length, 2, 'exactly two links');
  const pr = links.find((l) => l.href === PR);
  assert.ok(pr && /pull request #29|#29/.test(pr.text), 'one link goes to judge-protocol pull request 29');
  const study = links.find((l) => l.href && l.href.startsWith(CASE_STUDY_PREFIX) && l.href.includes(CASE_STUDY_FOLDER));
  assert.ok(study && /case study/i.test(study.text), 'one link goes to the case study folder in this repository');
  assert.ok(fs.existsSync(new URL(`../../${CASE_STUDY_FOLDER}/README.md`, import.meta.url)), 'the case study folder exists in this repository');
  for (const l of links) assert.doesNotMatch(l.attrs, /\b(target|download|onclick)=/, 'plain links');
});

test('R16.3 with scripts off the real-use line is drawn, with its two links, after the page heading and before the story strip', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure({ ...size, scripts: false, settle: false }, () => {
        const e = document.getElementById('real-use');
        if (!e) return { drawn: false, text: '', links: [], afterHeading: false, beforeStrip: false };
        const s = getComputedStyle(e);
        const h1 = document.querySelector('h1');
        const strip = document.getElementById('strip');
        return {
          drawn: e.getClientRects().length > 0 && s.display !== 'none' && s.visibility === 'visible',
          text: e.innerText.replace(/\s+/g, ' ').trim(),
          links: [...e.querySelectorAll('a')].map((a) => a.href),
          afterHeading: (h1.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          beforeStrip: (e.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        };
      });
      const at = `at ${size.width}`;
      assert.ok(m.drawn && /all six frozen contracts/.test(m.text), `${at}: the line is drawn with scripts off`);
      assert.equal(m.links.length, 2, `${at}: both links are there`);
      assert.ok(m.afterHeading && m.beforeStrip, `${at}: after the heading, before the strip`);
    }
  });
});

// ---- 16.4: the size of the experiment, in the result element ----

test('R16.4 the result element also gives the size of the experiment, two models and the runs per cell, with the counts exactly as experiments/README.md gives them', async () => {
  const experiment = read('experiments/README.md');
  const found = /(\d+) to (\d+) runs per cell/.exec(experiment);
  assert.ok(found, 'experiments/README.md says how many runs per cell');
  const e = element('evidence', 'p');
  assert.ok(e.words.includes(`${found[1]} to ${found[2]} runs per cell`), `the element says "${found[0]}", as experiments/README.md does`);
  // The size is one sentence that names both facts, not the older "across two models" of the lead.
  assert.match(e.words, new RegExp(`\\btwo models\\b[^.]*${found[1]} to ${found[2]} runs per cell`, 'i'), 'one sentence gives two models and the runs per cell');
  assert.match(experiment, /two (small )?models/, 'experiments/README.md also says two models');
  // The counts that were already there stay in the same element.
  assert.match(e.words, /11 of 11/);
  assert.match(e.words, /0 of 19/);
  assert.match(e.words, /one gated run of six/);
  assert.doesNotMatch(e.text, /[\u2013\u2014]/, 'no em or en dashes');
  assert.equal((e.text.match(/<a\b/g) || []).length, 1, 'still exactly one link');
});

test('R16.4 with scripts off the size of the experiment is drawn inside the result element', { skip: NO_BROWSER }, async () => {
  const found = /(\d+) to (\d+) runs per cell/.exec(read('experiments/README.md'));
  await withBrowser(async (browser) => {
    const m = await browser.measure({ ...DESKTOP, scripts: false, settle: false }, () => {
      const e = document.getElementById('evidence');
      return { drawn: e.getClientRects().length > 0, text: e.innerText.replace(/\s+/g, ' ').trim() };
    });
    assert.ok(m.drawn);
    assert.ok(m.text.includes(`${found[1]} to ${found[2]} runs per cell`) && /two models/.test(m.text), `the drawn text says it: ${m.text}`);
  });
});

// ---- 16.6: with scripts off, the first screen's text and a static summary of the sample receipt ----

test('R16.6 with scripts off the first screen\'s text is drawn: the heading, the idea line, the real-use line, the three beats and the result element', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure({ ...size, scripts: false, settle: false }, () => {
        const drawn = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible' && /\S/.test(e.innerText);
        return {
          h1: drawn(document.querySelector('h1')),
          idea: drawn(document.getElementById('idea')),
          realUse: drawn(document.getElementById('real-use')),
          beats: [...document.querySelectorAll('#strip .beat')].map(drawn),
          evidence: drawn(document.getElementById('evidence')),
        };
      });
      const at = `at ${size.width}`;
      assert.equal(m.h1 && m.idea && m.realUse && m.evidence, true, `${at}: heading, idea line, real-use line and result are drawn (${JSON.stringify(m)})`);
      assert.deepEqual(m.beats, [true, true, true], `${at}: the three beats are drawn`);
    }
  });
});

test('R16.6 the static summary in index.html gives the sample receipt\'s verdict and one line per requirement, and says the same as site/sample-receipt.json', () => {
  const want = expectedSummary();
  const box = element('static-summary', 'section');
  assert.doesNotMatch(box.text, /<h[1-6]\b/, 'no heading (Requirement 10.1 counts the headings above the banner)');
  assert.doesNotMatch(box.text, /[\u2013\u2014]/, 'no em or en dashes');
  assert.doesNotMatch(box.text, /<(script|svg|img|button|input)\b|aria-hidden|\bon\w+=/i, 'plain text');
  // The parts have classes and no ids: the contracts that read the page as ids and text (first-visit, look, clean) must not
  // see a second "Risen" or a second list of requirements next to the live receipt.
  assert.doesNotMatch(box.text.replace(/<section\b[^>]*>/, ''), /\sid=/, 'no part of the summary has an id');
  const verdicts = [...box.text.matchAll(/<p\b[^>]*\bclass="static-verdict"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => textOf(m[1]));
  assert.equal(verdicts.length, 1, 'one verdict line');
  assert.ok(verdicts[0].toLowerCase().includes(want.word.toLowerCase()), `the verdict says ${want.word.toLowerCase()}: "${verdicts[0]}"`);
  assert.doesNotMatch(verdicts[0], /\bRisen\b|Still buried/, 'the capitalised words belong to the live banner');
  assert.ok(verdicts[0].includes(want.count), `the verdict says "${want.count}": "${verdicts[0]}"`);
  const lists = [...box.text.matchAll(/<ul\b[^>]*\bclass="static-requirements"[^>]*>([\s\S]*?)<\/ul>/g)];
  assert.equal(lists.length, 1, 'one list of requirements');
  const lines = [...lists[0][1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
  assert.deepEqual(lines, want.lines, 'one line per requirement, in numeric order, with the counts the receipt gives');
  assert.ok(box.start > idAt('open') && box.end < idAt('verdict'), 'the summary sits between the way to open your own receipt and the verdict banner');
  assert.match(box.words, /sample/i, 'it says that it describes the sample receipt');
});

test('R16.6 with scripts off the static summary is drawn; with scripts on it gives way to the live receipt, whose summary lines are the same lines', { skip: NO_BROWSER }, async () => {
  const want = expectedSummary();
  await withBrowser(async (browser) => {
    const off = await browser.measure({ ...DESKTOP, scripts: false, settle: false }, () => {
      const e = document.getElementById('static-summary');
      if (!e) return { drawn: false, verdict: '', lines: [] };
      return {
        drawn: e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible',
        verdict: document.querySelector('#static-summary .static-verdict') ? document.querySelector('#static-summary .static-verdict').innerText.replace(/\s+/g, ' ').trim() : '',
        lines: [...document.querySelectorAll('#static-summary .static-requirements li')].filter((li) => li.getClientRects().length > 0).map((li) => li.innerText.replace(/\s+/g, ' ').trim()),
      };
    });
    assert.ok(off.drawn, 'drawn with scripts off');
    assert.ok(off.verdict.toLowerCase().includes(want.word.toLowerCase()) && off.verdict.includes(want.count), `the drawn verdict: ${off.verdict}`);
    assert.deepEqual(off.lines, want.lines, 'every line is drawn');

    const on = await browser.measure(DESKTOP, () => ({
      staticDrawn: !!document.getElementById('static-summary') && document.getElementById('static-summary').getClientRects().length > 0,
      live: [...document.querySelectorAll('#groups details > summary')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()),
      verdict: document.getElementById('verdict').textContent.replace(/\s+/g, ' ').trim(),
    }));
    assert.equal(on.staticDrawn, false, 'with scripts on the static summary is not drawn next to the live receipt');
    assert.deepEqual(on.live, want.lines, 'the live summary lines are the static lines');
    assert.ok(on.verdict.startsWith(want.word) && on.verdict.includes(want.count), `the live banner: ${on.verdict}`);
  });
});

// ---- 16.5: this file pins no pixel size or position ----

test('R16.5 this file pins no pixel size or position: no px unit, no assertion against a numeric box value, and the window sizes appear only in the two named constants', () => {
  const source = read('contracts/receipt-viewer/try-first.contract.test.js');
  assert.doesNotMatch(source, /\d\s*px\b/, 'a size in pixels');
  const lines = source.split('\n');
  const windowNumbers = /\b(1280|800|390|844)\b/;
  const where = lines.map((l, i) => [l, i]).filter(([l]) => windowNumbers.test(l) && !l.trim().startsWith('//') && !/^const (DESKTOP|PHONE) = |const windowNumbers = /.test(l));
  assert.deepEqual(where.map(([l, i]) => `${i + 1}: ${l.trim()}`), [], 'a window size outside the two constants');
  const comparisons = lines.map((l, i) => [l, i]).filter(([l]) => /\b(top|bottom|left|right|width|height|scrollY|scrollX)\b[^;]*(<=|>=|===?|<|>)\s*[1-9]\d*\b/.test(l) && !l.trim().startsWith('//'));
  assert.deepEqual(comparisons.map(([l, i]) => `${i + 1}: ${l.trim()}`), [], 'a box compared with a number');
});
