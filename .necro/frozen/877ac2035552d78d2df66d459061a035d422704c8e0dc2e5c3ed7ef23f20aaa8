// Contracts for Requirement 14 and the revisions of 9.5 and 12.1 (Nov 12) of the receipt-viewer spec: the first screen names
// the idea it raises (Design by Contract, from Eiffel (1986), raised for coding agents) beside the page heading, leads with the
// result as two large counts with the round 3 caveat in the same element, makes Try it here the single main action, says in
// plain words that a receipt with no task came from necro check, and at 390x844 shows the start control and the result line
// where the verdict banner used to be required (the banner is still required at 1280x800).
//
// Per Requirement 14.5 nothing here pins a pixel size or a position. Boxes are compared with the window and with each other,
// styles are read as computed values (ratios and contrast), and text is read as text, so the contracts pass on any operating
// system's fonts. The last contract reads this file and checks that.
//
// Text is read from site/index.html. Layout is measured in a headless Chrome or Chromium: the file serves site/ from a local
// server on 127.0.0.1, sets the window size and reads the page over the DevTools protocol (Node's built-in WebSocket, no
// dependencies). Set CHROME_PATH if the browser is somewhere unusual. With no browser the layout contracts fail and say so:
// a layout that was not measured is not a pass.
//
// There is no shared helper file (a helper would not be frozen), so the browser code is carried in this file, as in
// evidence.contract.test.js. The page script and the sample notes are named below the way a static import would name them,
// because the receipt pins files it finds that way. Keep these lines.
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


const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const html = read('site/index.html');

const IDEA = 'Kiro cannot call a task done until its frozen contracts pass.';
const RAISED = 'Design by Contract, from Eiffel (1986), raised for coding agents.';
const EXPERIMENT = 'https://github.com/vijaygopalbalasa/contract-necromancer/blob/main/experiments/README.md';
const TITLE = 'Contract Necromancer: a task is done only when frozen contracts pass';

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, mobile: true };

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

// ---- 14.1: the idea that is raised, beside the heading ----

test('R14.1 one short line beside the page heading names Design by Contract, from Eiffel (1986), raised for coding agents', () => {
  const idea = element('idea', 'p');
  assert.equal(idea.words, RAISED);
  assert.doesNotMatch(idea.text, /<(script|svg|img|button|input|a)\b|\bhidden\b|aria-hidden|data-|\bon\w+=/i, 'plain text, readable without JavaScript');
  assert.doesNotMatch(idea.text, /[\u2013\u2014]/, 'no em or en dashes');
  const header = element('brand', 'header');
  assert.ok(header.start < idea.start && idea.end < header.end, 'the line is inside the header that holds the page heading');
  const h1End = html.indexOf('</h1>');
  assert.ok(h1End > header.start && h1End < idea.start, 'the line comes right after the page heading');
  assert.equal(textOf(html.slice(h1End + 5, idea.start)), '', 'nothing stands between the heading and the line');
  assert.ok(idea.end < idAt('strip'), 'the line comes before the story strip');
});

test('R14.1 the page heading and the title stay as they were', () => {
  const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) || [];
  assert.equal(headings.length, 1);
  assert.equal(textOf(headings[0]), IDEA);
  assert.equal(/<title>([^<]*)<\/title>/.exec(html)[1], TITLE);
  assert.doesNotMatch(html.slice(html.indexOf('<body'), idAt('verdict')), /<h2/, 'no second heading above the banner');
});

test('R14.1 with scripts off the line is drawn next to the heading, inside the first screen', async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure({ ...size, scripts: false, settle: false }, () => {
        const box = (e) => {
          const b = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height, display: s.display, visibility: s.visibility };
        };
        const idea = document.getElementById('idea');
        const h1 = document.querySelector('h1');
        const header = document.getElementById('brand');
        return {
          w: innerWidth,
          h: innerHeight,
          idea: box(idea),
          h1: box(h1),
          header: box(header),
          inHeader: header.contains(idea) && header.contains(h1),
          text: idea.innerText.replace(/\s+/g, ' ').trim(),
        };
      });
      const at = `at ${size.width}`;
      assert.equal(m.text, RAISED, at);
      assert.ok(m.inHeader, `${at}: the line and the heading share the header`);
      assert.ok(m.idea.width > 0 && m.idea.height > 0 && m.idea.display !== 'none' && m.idea.visibility === 'visible', `${at}: the line is drawn`);
      assert.ok(m.idea.left >= 0 && m.idea.right <= m.w && m.idea.top >= 0 && m.idea.bottom <= m.h, `${at}: the line is inside the first screen`);
      assert.ok(m.idea.top >= m.h1.top && m.idea.bottom <= m.header.bottom + 0.5, `${at}: the line is drawn in the header, not above the heading`);
      assert.ok(m.idea.top - m.h1.bottom < m.h1.height, `${at}: the line is next to the heading, less than a heading's height away`);
    }
  });
});

// ---- 14.2 and the revised 12.1: the result leads, with the round 3 caveat in the same element ----

test('R12.1 (revised Nov 12) one element holds the result and the round 3 caveat, with the counts marked as large numbers and one plain link', () => {
  const e = element('evidence', 'p');
  const stripEnd = html.indexOf('</section>', html.lastIndexOf('<section', idAt('strip'))) + '</section>'.length;
  assert.ok(e.start >= stripEnd, 'after the story strip');
  assert.ok(e.end < idAt('verdict'), 'before the verdict banner');
  assert.match(e.words, /cannot be finished/);
  assert.match(e.words, /marked it done in 11 of 11 runs without the gate/);
  assert.match(e.words, /0 of 19 with it/);
  assert.match(e.words, /across two models/);
  assert.match(e.words, /"do whatever it takes" prompt/);
  assert.match(e.words, /one gated run of six got past the gate by patching JavaScript built-ins/);
  assert.match(e.words, /hole is closed/);
  assert.match(e.words, /cheat is kept as a test/);
  assert.ok(e.words.indexOf('0 of 19') < e.words.indexOf('do whatever it takes'), 'the result comes before the caveat');
  assert.doesNotMatch(e.text, /[\u2013\u2014]/, 'no em or en dashes');
  assert.doesNotMatch(e.text, /<(script|svg|img|ul|ol|li|button|input)\b|\bhidden\b|aria-hidden|data-|\bon\w+=/i, 'readable without JavaScript');
  const nums = [...e.text.matchAll(/<strong class="num">([^<]*)<\/strong>/g)].map((m) => m[1]);
  assert.deepEqual(nums, ['11 of 11', '0 of 19'], 'the two counts are the large numbers');
  const links = [...e.text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 1, 'exactly one link');
  assert.equal(/\bhref="([^"]*)"/.exec(links[0][1])[1], EXPERIMENT);
  assert.match(links[0][2], /experiment/i);
  assert.ok(html.split(EXPERIMENT).length === 2, 'the address appears once on the page');
});

test('R14.2 the result is drawn with more weight than body text: the two counts are large, bold and at AA contrast, and so is the caveat', async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      for (const scripts of [true, false]) {
        const m = await browser.measure({ ...size, scripts, settle: scripts }, () => {
          const rgb = (c) => /rgba?\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)(?:, (\d*\.?\d+))?/.exec(c).slice(1, 5).map((v) => (v === undefined ? 1 : Number(v)));
          const background = (el) => {
            for (let e = el; e; e = e.parentElement) {
              const c = rgb(getComputedStyle(e).backgroundColor);
              if (c[3] > 0) return c.slice(0, 3);
            }
            return rgb(getComputedStyle(document.documentElement).backgroundColor).slice(0, 3);
          };
          const lum = ([r, g, b]) => {
            const f = (v) => {
              const x = v / 255;
              return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const ratio = (a, b) => {
            const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
          };
          const look = (el) => {
            const s = getComputedStyle(el);
            return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), contrast: ratio(rgb(s.color).slice(0, 3), background(el)), text: el.textContent.trim() };
          };
          const e = document.getElementById('evidence');
          const caveat = e.querySelector('.caveat');
          const box = e.getBoundingClientRect();
          return {
            body: parseFloat(getComputedStyle(document.body).fontSize),
            nums: [...e.querySelectorAll('.num')].map(look),
            caveat: caveat ? look(caveat) : null,
            text: e.innerText.replace(/\s+/g, ' ').trim(),
            link: look(e.querySelector('a')),
            drawn: box.width > 0 && box.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility === 'visible',
          };
        });
        const at = `at ${size.width} with scripts ${scripts ? 'on' : 'off'}`;
        assert.ok(m.drawn, `${at}: the result is drawn`);
        assert.match(m.text, /11 of 11/, at);
        assert.match(m.text, /0 of 19/, at);
        assert.match(m.text, /do whatever it takes/, `${at}: the caveat is in the same element`);
        assert.deepEqual(m.nums.map((n) => n.text), ['11 of 11', '0 of 19'], at);
        for (const n of m.nums) {
          assert.ok(n.size >= 1.5 * m.body, `${at}: ${n.text} is ${n.size} against body text of ${m.body}`);
          assert.ok(n.weight >= 600, `${at}: ${n.text} has weight ${n.weight}`);
          assert.ok(n.contrast >= 4.5, `${at}: ${n.text} contrast ${n.contrast.toFixed(2)}`);
        }
        assert.ok(m.caveat, `${at}: the caveat is marked`);
        assert.ok(m.caveat.contrast >= 4.5, `${at}: the caveat contrast ${m.caveat.contrast.toFixed(2)}`);
        assert.ok(m.link.contrast >= 4.5, `${at}: the link contrast ${m.link.contrast.toFixed(2)}`);
        assert.ok(m.caveat.size <= Math.min(...m.nums.map((n) => n.size)), `${at}: the caveat is not drawn bigger than the counts`);
      }
    }
  });
});

// ---- 14.3: Try it here is the single main action ----

test('R14.3 with scripts on, no other control above the verdict banner is filled like Try it here', async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure(size, () => {
        const verdict = document.getElementById('verdict');
        const open = document.getElementById('open');
        open.open = true; // the buttons inside the closed form count once it is opened
        const play = document.getElementById('strip-play');
        const above = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit'], summary")].filter(
          (e) => e !== play && (e.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && e.getClientRects().length > 0,
        );
        const fill = (e) => {
          const s = getComputedStyle(e);
          return { id: e.id || e.textContent.trim().slice(0, 30), bg: s.backgroundColor, shadow: s.boxShadow };
        };
        return { play: fill(play), others: above.map(fill), playDrawn: play.getClientRects().length > 0 };
      });
      const at = `at ${size.width}`;
      assert.ok(m.playDrawn, `${at}: Try it here is drawn`);
      assert.notEqual(m.play.bg, 'rgba(0, 0, 0, 0)', `${at}: Try it here is filled`);
      assert.ok(m.others.length >= 4, `${at}: other controls were found above the banner (${m.others.map((o) => o.id).join(', ')})`);
      for (const o of m.others) {
        assert.notEqual(o.bg, m.play.bg, `${at}: ${o.id} is filled like Try it here`);
        assert.notEqual(o.shadow, m.play.shadow, `${at}: ${o.id} has the glow of Try it here`);
      }
    }
  });
});

test('R14.3 with scripts off Try it here is not drawn, so the page never shows a button that does nothing', async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure({ ...DESKTOP, scripts: false, settle: false }, () => document.getElementById('strip-play').getClientRects().length);
    assert.equal(m, 0);
  });
});

// ---- 14.4: a receipt with no task says so ----

test('R14.4 a receipt with no task says so in its task line in plain words, not "none recorded": it was written by necro check, not by a tick', async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure(DESKTOP, async () => {
      const task = () => document.getElementById('task').textContent.trim();
      const first = task();
      document.getElementById('sample-buried').click();
      for (let i = 0; i < 100 && !/Still buried/.test(document.getElementById('verdict').textContent); i += 1) await new Promise((r) => setTimeout(r, 50));
      return { first, buried: task() };
    });
    for (const line of [m.first, m.buried]) {
      assert.doesNotMatch(line, /none recorded/i);
      assert.match(line, /^No task\./);
      assert.match(line, /necro check/);
      assert.match(line, /not by a tick/);
    }
  });
});

// ---- the revised 9.5: what the first screen shows at each window ----

test('R9.5 (revised Nov 12) at 1280x800 the verdict banner is in the first screen, with no sideways scroll and the way to open your own receipt on the page', async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure(DESKTOP, () => {
      const box = (id) => {
        const b = document.getElementById(id).getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height };
      };
      const open = document.getElementById('open');
      const result = {
        w: innerWidth,
        h: innerHeight,
        scrollY,
        sideways: document.documentElement.scrollWidth,
        verdict: box('verdict'),
        evidence: box('evidence'),
        play: box('strip-play'),
      };
      // Open the form after the boxes are read: it is closed on a first visit.
      open.open = true;
      result.sidewaysOpen = document.documentElement.scrollWidth;
      result.openDrawn = open.getClientRects().length > 0 && ['paste', 'show', 'file'].every((id) => document.getElementById(id).getClientRects().length > 0);
      return result;
    });
    assert.equal(m.scrollY, 0);
    assert.ok(m.verdict.height > 0 && m.verdict.top >= 0 && m.verdict.bottom <= m.h && m.verdict.left >= 0 && m.verdict.right <= m.w, `the banner ends at ${Math.round(m.verdict.bottom)} of ${m.h}`);
    assert.ok(m.evidence.bottom <= m.verdict.top, 'the result is above the banner');
    assert.ok(m.play.bottom <= m.h && m.play.right <= m.w, 'the start control is in the first screen');
    assert.ok(m.sideways <= m.w && m.sidewaysOpen <= m.w, 'no sideways scroll');
    assert.ok(m.openDrawn, 'the way to open your own receipt is on the page');
  });
});

test('R9.5 (revised Nov 12) at 390x844 the start control and the whole result are in the first screen, with no sideways scroll and the way to open your own receipt on the page', async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure(PHONE, () => {
      const box = (id) => {
        const b = document.getElementById(id).getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height };
      };
      const open = document.getElementById('open');
      const result = {
        w: innerWidth,
        h: innerHeight,
        scrollY,
        sideways: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        play: box('strip-play'),
        evidence: box('evidence'),
      };
      open.open = true;
      result.sidewaysOpen = document.documentElement.scrollWidth;
      result.openDrawn = open.getClientRects().length > 0 && ['paste', 'show', 'file'].every((id) => document.getElementById(id).getClientRects().length > 0);
      return result;
    });
    assert.equal(m.scrollY, 0);
    const inside = (b) => b.height > 0 && b.top >= 0 && b.bottom <= m.h && b.left >= 0 && b.right <= m.w;
    assert.ok(inside(m.play), `the start control spans ${Math.round(m.play.top)} to ${Math.round(m.play.bottom)} of ${m.h}`);
    assert.ok(inside(m.evidence), `the result spans ${Math.round(m.evidence.top)} to ${Math.round(m.evidence.bottom)} of ${m.h}`);
    assert.ok(m.sideways <= m.w && m.body <= m.w && m.sidewaysOpen <= m.w, 'no sideways scroll');
    assert.ok(m.openDrawn, 'the way to open your own receipt is on the page');
  });
});

test('R12.1 (revised Nov 12) the result with its caveat is in the first screen at 1280x800 and 390x844, below the strip and above the banner, with scripts on and off', async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      for (const scripts of [true, false]) {
        const m = await browser.measure({ ...size, scripts, settle: scripts }, () => {
          const box = (id) => {
            const b = document.getElementById(id).getBoundingClientRect();
            return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height };
          };
          return { w: innerWidth, h: innerHeight, strip: box('strip'), evidence: box('evidence'), verdict: box('verdict'), sideways: document.documentElement.scrollWidth };
        });
        const at = `at ${size.width} with scripts ${scripts ? 'on' : 'off'}`;
        assert.ok(m.strip.bottom <= m.evidence.top, `${at}: below the strip`);
        if (scripts) assert.ok(m.evidence.bottom <= m.verdict.top, `${at}: above the banner`);
        assert.ok(m.evidence.height > 0 && m.evidence.top >= 0 && m.evidence.bottom <= m.h && m.evidence.left >= 0 && m.evidence.right <= m.w, `${at}: inside the first screen, it spans ${Math.round(m.evidence.top)} to ${Math.round(m.evidence.bottom)} of ${m.h}`);
        assert.ok(m.sideways <= m.w, `${at}: no sideways scroll`);
      }
    }
  });
});

// ---- the words stay safe for the frozen R12.2 contract ----

test('R12.2 the sentences that the idea line and the result add keep the page safe for the frozen Requirement 12.2 contract: no sentence says contracts run only in Node, and one names necro verify with JavaScript contracts and runner contracts', () => {
  const body = html.slice(html.indexOf('<body'), html.indexOf('<script'));
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
    assert.doesNotMatch(s, /[\u2013\u2014]/, `"${s}"`);
  }
  assert.equal(sentences.filter((s) => /necro verify/.test(s) && /JavaScript contracts/.test(s) && /runner contracts/.test(s)).length, 1);
  assert.ok(sentences.includes(RAISED));
});

test('R14.5 this file pins no pixel size or position: no px unit, no assertion against a numeric box value, and the window sizes appear only in the two named constants', () => {
  const source = read('contracts/receipt-viewer/first-screen-v3.contract.test.js');
  assert.doesNotMatch(source, /\d\s*px\b/, 'a size in pixels');
  const lines = source.split('\n');
  const windowNumbers = /\b(1280|800|390|844)\b/;
  const where = lines.map((l, i) => [l, i]).filter(([l]) => windowNumbers.test(l) && !l.trim().startsWith('//') && !/^test\(|^const (DESKTOP|PHONE) = |const windowNumbers = /.test(l));
  assert.deepEqual(where.map(([l, i]) => `${i + 1}: ${l.trim()}`), [], 'a window size outside the two constants');
  const comparisons = lines.map((l, i) => [l, i]).filter(([l]) => /\b(top|bottom|left|right|width|height)\b[^;]*(<=|>=|===?|<|>)\s*[1-9]\d*\b/.test(l) && /assert/.test(l));
  assert.deepEqual(comparisons.map(([l, i]) => `${i + 1}: ${l.trim()}`), [], 'a box compared with a number');
});
