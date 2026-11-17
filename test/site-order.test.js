import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDom } from './fixtures/fake-dom.js';
import { withBrowser, NO_BROWSER } from './fixtures/browser.js';
import { start } from '../site/app.js';

// Requirements 16.1 and 16.5, and the revised 9.5, 10.1, 10.2, 10.5, 13.9 and 14.3 (task 30): the play opens on load and the
// page reads in a new order. The file is checked by text and element order, the running page by DOM order, open state, focus
// and whether an element is inside the window. No size or position of an element is pinned.

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('site/index.html');
const app = read('site/app.js');
const SIZES = [
  { width: 1280, height: 800, mobile: false },
  { width: 390, height: 844, mobile: true },
];
const idAt = (id) => {
  const i = html.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `no #${id}`);
  return i;
};
const ORDER = ['brand', 'real-use', 'strip', 'evidence', 'play', 'how', 'start', 'sample-row', 'open', 'verdict', 'receipt', 'hash-check', 'run', 'file-check', 'about'];

test('index.html holds the parts in the new order', () => {
  for (let i = 1; i < ORDER.length; i += 1) assert.ok(idAt(ORDER[i - 1]) < idAt(ORDER[i]), `#${ORDER[i - 1]} before #${ORDER[i]}`);
});

test('the play stays hidden in the file, so scripts off draw neither it nor Try it here', () => {
  assert.match(html, /<section class="play" id="play"[^>]*\bhidden\b/);
  assert.match(html, /<button[^>]*id="strip-play"[^>]*class="needs-script"|<button[^>]*class="needs-script"[^>]*id="strip-play"/);
});

test('the jump link stays in the sample bar and points to How it works', () => {
  const bar = html.slice(idAt('start'), idAt('verdict'));
  assert.match(bar, /id="jump-how" href="#how"/);
  assert.ok(idAt('how') < idAt('jump-how'));
});

test('the only headings above the verdict banner are the page heading, the play heading and How it works', () => {
  const above = html.slice(0, idAt('verdict'));
  const headings = [...above.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => `${m[1]} ${m[2].replace(/<[^>]*>/g, '').trim()}`);
  assert.deepEqual(headings, ['h1 A Kiro task is done only when its frozen contracts pass.', 'h3 Try the gate on this page', 'h2 How it works']);
});

test('the play buttons do not use the fill or glow rules of Try it here', () => {
  const css = read('site/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = m[1];
    if (/strip-play/.test(selector)) assert.doesNotMatch(selector, /\.play\b(?!-)|play-send|play-fix|play-byte/, selector);
  }
});

// ---- the page with a fake DOM ----

async function open() {
  const dom = createDom();
  const focused = [];
  const scrolled = [];
  const focusOptions = [];
  for (const el of dom.byId.values()) {
    el.focus = (options) => (focused.push(el.id), focusOptions.push(options));
    el.scrollIntoView = (options) => scrolled.push({ id: el.id, options });
  }
  dom.el('paste').value = '{}';
  await start({
    document: dom.document,
    location: { search: '', href: 'https://example.test/' },
    fetch: async () => new Response('no', { status: 404 }),
    navigator: { clipboard: {} },
    matchMedia: () => ({ matches: false }),
    play: { runPlay: async () => ({ ok: true, run: 'planted', results: [], ms: 1 }) },
  });
  return { dom, focused, scrolled, focusOptions };
}

test('start opens the play without a press and says so on Try it here', async () => {
  const page = await open();
  assert.equal(page.dom.el('play').hidden, false);
  assert.equal(page.dom.el('strip-play').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(page.focused, [], 'loading the page does not take focus');
  assert.deepEqual(page.scrolled, [], 'loading the page does not scroll');
});

test('Try it here scrolls the play into view and moves focus to Send the tick without scrolling again', async () => {
  const page = await open();
  await page.dom.el('strip-play').dispatch('click');
  assert.ok(page.scrolled.some((s) => s.id === 'play'));
  assert.equal(page.focused.at(-1), 'play-send');
  assert.equal(page.focusOptions.at(-1)?.preventScroll, true);
  assert.equal(page.dom.el('play').hidden, false);
  assert.ok(!page.scrolled.some((s) => s.id === 'verdict'));
});

// ---- the page in a browser ----

test('with scripts on the play is open and directly after the result element, with scripts off it is not drawn', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of SIZES) {
      const on = await browser.measure(size, () => ({
        hidden: document.getElementById('play').hidden,
        drawn: document.getElementById('play').getClientRects().length > 0,
        next: document.getElementById('evidence').nextElementSibling === document.getElementById('play'),
        how: document.getElementById('play').nextElementSibling === document.getElementById('how'),
        expanded: document.getElementById('strip-play').getAttribute('aria-expanded'),
      }));
      assert.deepEqual(on, { hidden: false, drawn: true, next: true, how: true, expanded: 'true' }, `at ${size.width}`);
      const off = await browser.measure({ ...size, scripts: false, settle: false }, () => document.getElementById('play').getClientRects().length);
      assert.equal(off, 0, `at ${size.width}`);
    }
  });
});

test('the DOM order of the running page, with the sample shown', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure(SIZES[0], () => {
      const ids = ['brand', 'real-use', 'strip', 'evidence', 'play', 'how', 'start', 'open', 'verdict', 'receipt', 'hash-check', 'run', 'file-check', 'about'];
      return ids.filter((id, i) => i > 0 && (document.getElementById(ids[i - 1]).compareDocumentPosition(document.getElementById(id)) & Node.DOCUMENT_POSITION_FOLLOWING) === 0);
    });
    assert.deepEqual(m, []);
  });
});

test('Try it here moves focus to Send the tick and the play heading is in the window', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of SIZES) {
      const m = await browser.measure({ ...size, reducedMotion: true }, async () => {
        document.getElementById('strip-play').click();
        await new Promise((r) => setTimeout(r, 300));
        const b = document.getElementById('play-title').getBoundingClientRect();
        return { focus: document.activeElement.id, inside: b.top >= 0 && b.bottom <= innerHeight };
      });
      assert.deepEqual(m, { focus: 'play-send', inside: true }, `at ${size.width}`);
    }
  });
});

test('the headings drawn above the banner are exactly the page heading, the play heading and How it works', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure(SIZES[0], () => {
      const verdict = document.getElementById('verdict');
      return [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
        .filter((h) => h.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING)
        .map((h) => h.id || h.tagName);
    });
    assert.deepEqual(m, ['H1', 'play-title', 'how-title']);
  });
});

test('the play buttons are not filled or glowing like Try it here', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of SIZES) {
      const m = await browser.measure(size, () => {
        const look = (id) => ({ bg: getComputedStyle(document.getElementById(id)).backgroundColor, shadow: getComputedStyle(document.getElementById(id)).boxShadow });
        return { try: look('strip-play'), others: ['play-send', 'play-fix', 'play-byte'].map(look) };
      });
      for (const o of m.others) {
        assert.notEqual(o.bg, m.try.bg, `at ${size.width}`);
        assert.notEqual(o.shadow, m.try.shadow, `at ${size.width}`);
      }
    }
  });
});

test('the page does not scroll sideways at either size', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of SIZES) {
      const m = await browser.measure(size, () => document.documentElement.scrollWidth <= innerWidth);
      assert.ok(m, `at ${size.width}`);
    }
  });
});

test('app.js does not name play-title as the focus target any more', () => {
  assert.doesNotMatch(app, /takeFocus\(els\['play-title'\]\)/);
});
