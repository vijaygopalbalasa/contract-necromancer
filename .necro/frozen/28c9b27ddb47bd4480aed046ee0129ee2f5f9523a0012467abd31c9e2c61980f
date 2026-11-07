// Contracts for the first visit: R9.1, R9.2, R9.3 and R9.4 of the receipt-viewer spec.
//
// R9.1 to R9.3 are about what the page does, so each test runs site/app.js against a small fake DOM built from the
// ids, tags and attributes in site/index.html. It is a copy of the idea in clean.contract.test.js, trimmed to what these
// tests need, because a shared helper file would not be frozen. Nothing touches the network: fetch is a stub that serves
// only the files a test hands it. R9.4 is about a background, so it can only be checked here as CSS text; whether a
// browser really draws no band is checked by hand.
//
// The site modules are loaded with a dynamic import inside each test, so this file always loads and every contract
// name is registered even while the viewer does not do these things yet.
//
// Dynamic imports are not followed by necro's import tracing, so the modules are also named below the way a static
// import would name them. Keep these lines: the receipt pins files it finds this way.
//   import {} from '../../site/app.js';
//   import {} from '../../site/lib/canon.js';
//   import {} from '../../site/lib/receipt.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const APP_URL = new URL('../../site/app.js', import.meta.url);
const CANON_URL = new URL('../../site/lib/canon.js', import.meta.url);
const HTML_URL = new URL('../../site/index.html', import.meta.url);
const CSS_URL = new URL('../../site/style.css', import.meta.url);
const RISEN_URL = new URL('../../site/sample-receipt.json', import.meta.url);
const BURIED_URL = new URL('../../site/sample-buried.json', import.meta.url);
const LEDGER_URL = new URL('../../examples/pumpkin-ledger/', import.meta.url);

const RISEN_TEXT = fs.readFileSync(RISEN_URL, 'utf8');
const BURIED_TEXT = fs.readFileSync(BURIED_URL, 'utf8');
const SAMPLES = { 'sample-receipt.json': RISEN_TEXT, 'sample-buried.json': BURIED_TEXT };
const RAW = 'https://raw.githubusercontent.com/o/n/main/r.json';
const VERDICT = /\bRisen\b|Still buried/;

// ---- a small fake DOM, built from site/index.html ----

class FakeNode {
  constructor(tag, log) {
    this.tagName = String(tag).toUpperCase();
    this.log = log;
    this.attrs = new Map();
    this.children = [];
    this.own = '';
    this.value = '';
    this.files = [];
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
  }
  get id() {
    return this.attrs.get('id') || '';
  }
  get className() {
    return this.attrs.get('class') || '';
  }
  set className(v) {
    this.attrs.set('class', String(v));
  }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (...cs) => {
        el.className = [...new Set([...list(), ...cs])].join(' ');
      },
      remove: (...cs) => {
        el.className = list().filter((c) => !cs.includes(c)).join(' ');
      },
      toggle(c, force) {
        const on = force === undefined ? !list().includes(c) : force;
        if (on) this.add(c);
        else this.remove(c);
        return on;
      },
    };
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
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  appendChild(n) {
    const node = typeof n === 'string' ? Object.assign(new FakeNode('#text', this.log), { own: n }) : n;
    this.children.push(node);
    return node;
  }
  append(...ns) {
    for (const n of ns) this.appendChild(n);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  async dispatch(type) {
    const event = { type, target: this, preventDefault() {}, stopPropagation() {} };
    await Promise.all((this.listeners.get(type) || []).map((fn) => fn(event)));
  }
  // Records what the page asked for and what the element looked like at that moment.
  scrollIntoView(options) {
    this.log.push({ node: this, options, hidden: this.hidden, text: this.textContent });
  }
}

function createDom() {
  const html = fs.readFileSync(HTML_URL, 'utf8');
  const log = [];
  const byId = new Map();
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const attrs = [...m[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)];
    const idAttr = attrs.find((a) => a[1] === 'id');
    if (!idAttr) continue;
    const el = new FakeNode(m[1], log);
    for (const a of attrs) el.attrs.set(a[1], a[2] ?? a[3] ?? '');
    el.hidden = el.attrs.has('hidden');
    el.own = /^[^<]*/.exec(html.slice(m.index + m[0].length))[0].replace(/\s+/g, ' ').trim();
    byId.set(idAttr[2] ?? idAttr[3], el);
  }
  const document = {
    body: new FakeNode('body', log),
    createElement: (tag) => new FakeNode(tag, log),
    createTextNode: (text) => Object.assign(new FakeNode('#text', log), { own: String(text) }),
    getElementById: (id) => byId.get(id) || null,
  };
  return { document, byId, log };
}

// All visible text in page order, one chunk per element that has an id. With `skipButtons`, button labels are left out.
function textOf(el, skipButtons) {
  if (skipButtons && el.tagName === 'BUTTON') return '';
  return el.own + el.children.map((c) => textOf(c, skipButtons)).join('');
}
const visibleText = (page, skipButtons = false) =>
  [...page.byId.values()].filter((el) => !el.hidden).map((el) => textOf(el, skipButtons)).join('\n');

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

function buttonLabelled(page, ...words) {
  const found = [...page.byId.values()].filter((el) => el.tagName === 'BUTTON' && words.every((w) => w.test(el.own)));
  assert.equal(found.length, 1, `index.html needs exactly one button labelled with ${words.join(' and ')}`);
  return found[0];
}
const risenButton = (page) => buttonLabelled(page, /sample/i, /risen/i);
const buriedButton = (page) => buttonLabelled(page, /sample/i, /buried/i);

// Start the page. `files` maps the end of a URL to the text a fetch of it returns. `pasted` is text already in the
// paste box. `matchMedia` is passed to the page the way a browser would.
async function openPage({ search = '', files = SAMPLES, pasted = '', matchMedia } = {}) {
  const page = createDom();
  page.requested = [];
  const fetchStub = async (url) => {
    page.requested.push(String(url));
    const hit = Object.entries(files).find(([suffix]) => String(url).endsWith(suffix));
    if (!hit) throw new Error('these contracts do not use the network');
    return new Response(hit[1], { status: 200 });
  };
  const box = [...page.byId.values()].find((el) => el.tagName === 'TEXTAREA');
  assert.ok(box, 'index.html needs a textarea for pasting a receipt');
  box.value = pasted;
  page.box = box;
  const { start } = await import(APP_URL.href);
  await start({
    document: page.document,
    location: { search, href: `https://example.test/${search}` },
    fetch: fetchStub,
    navigator: { clipboard: { writeText: async () => {} } },
    matchMedia,
  });
  await settle();
  return page;
}

// ---- the two sample files ----

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ---- R9.1 ----

test('R9.1 a page with no ?receipt= and nothing pasted shows the bundled sample at once, without a click, and says it is a sample', async () => {
  const risen = JSON.parse(RISEN_TEXT);

  // No click: the page fetches the sample from the same origin and shows it.
  const page = await openPage();
  assert.equal(page.requested.length, 1, `the page fetched ${page.requested.join(', ') || 'nothing'}`);
  assert.ok(page.requested[0].endsWith('sample-receipt.json'), 'the bundled sample is the risen one');
  assert.ok(!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(page.requested[0]), 'the sample comes from the same origin');
  const text = visibleText(page);
  assert.ok(text.includes(risen.spec), 'the sample receipt is shown: its spec');
  assert.ok(text.includes(risen.receiptHash), 'the sample receipt is shown: its receipt hash');
  assert.ok(text.includes(risen.contracts[0].name), 'the sample receipt is shown: its contracts');
  assert.match(text, /\bRisen\b/);

  // It says so: some visible text that is not a button label calls it a sample.
  assert.match(visibleText(page, true), /\bsample\b/i, 'the page must say that what it shows is a sample');

  // A link to a receipt wins: only that receipt is fetched, no sample.
  const linked = await openPage({ search: `?receipt=${RAW}`, files: { ...SAMPLES, [RAW]: BURIED_TEXT } });
  assert.deepEqual(linked.requested, [RAW]);
  assert.ok(visibleText(linked).includes(JSON.parse(BURIED_TEXT).receiptHash));
  assert.doesNotMatch(visibleText(linked, true), /\bsample\b/i, 'a linked receipt is not called a sample');

  // Text already in the paste box is left alone: no sample is fetched or shown over it.
  const pasted = await openPage({ pasted: '{"text":"the visitor was here first"}' });
  assert.deepEqual(pasted.requested, []);
  assert.ok(!visibleText(pasted).includes(risen.receiptHash), 'the sample must not replace what is already pasted');
  assert.equal(pasted.box.value, '{"text":"the visitor was here first"}');
});

// ---- R9.2 ----

test('R9.2 the page offers a risen and a buried sample from this repository, and one click switches between them', async () => {
  // The buried sample is a real `necro check` receipt of a spec with a planted bug.
  const buried = JSON.parse(BURIED_TEXT);
  const { computeReceiptHash } = await import(CANON_URL.href);
  assert.equal(await computeReceiptHash(buried), buried.receiptHash, 'the buried sample has not been edited by hand');
  assert.equal(buried.task, null, 'necro check writes task null');
  assert.deepEqual([...buried.required].sort(), buried.contracts.map((c) => c.name).sort(), 'necro check requires every contract');
  const failing = buried.contracts.filter((c) => c.result === 'fail');
  assert.ok(failing.length > 0, 'a buried receipt has failing required contracts');
  assert.ok(buried.contracts.some((c) => c.result === 'pass'), 'and still some living ones');
  assert.ok(failing.every((c) => buried.required.includes(c.name)));

  // It was written on the pumpkin-ledger example of this repository: its requirements and contracts are that spec's
  // files byte for byte, and one source file differs from the example's, which is where the bug was planted.
  assert.equal(buried.requirements.sha256, sha(fs.readFileSync(new URL(buried.requirements.path, LEDGER_URL))));
  for (const c of buried.contracts) {
    assert.equal(c.sha256, sha(fs.readFileSync(new URL(c.path, LEDGER_URL))), `${c.path} is the example's contract file`);
  }
  const changed = buried.sources.filter((s) => s.sha256 !== sha(fs.readFileSync(new URL(s.path, LEDGER_URL))));
  assert.equal(changed.length, 1, `exactly one source differs from the example, ${changed.map((s) => s.path).join(', ') || 'none do'}`);

  // The risen sample: every required contract passes.
  const risen = JSON.parse(RISEN_TEXT);
  assert.ok(risen.contracts.every((c) => c.result === 'pass'), 'the risen sample has no failing contract');

  // Both are on offer from the start, and again after each is shown. One click switches.
  const page = await openPage();
  const offered = () => {
    for (const button of [risenButton(page), buriedButton(page)]) assert.equal(button.hidden, false, `"${button.own}" must stay visible`);
    for (const el of page.byId.values()) if (/sample/i.test(el.id) && el.tagName !== 'P') assert.equal(el.hidden, false, `#${el.id} must stay visible`);
  };
  offered();
  assert.match(visibleText(page), /\bRisen\b/);

  const before = page.requested.length;
  await buriedButton(page).dispatch('click');
  await settle();
  assert.equal(page.requested.length, before + 1, 'one click fetches one file');
  assert.ok(page.requested.at(-1).endsWith('sample-buried.json'));
  let text = visibleText(page);
  assert.match(text, /Still buried/);
  assert.doesNotMatch(text, /\bRisen\b/);
  assert.ok(text.includes(buried.receiptHash));
  assert.ok(text.includes(failing[0].name), 'a failing contract is listed by name');
  assert.match(text, /\bFAIL\b/);
  assert.match(visibleText(page, true), /\bsample\b/i, 'the buried receipt is called a sample too');
  offered();

  await risenButton(page).dispatch('click');
  await settle();
  assert.ok(page.requested.at(-1).endsWith('sample-receipt.json'));
  text = visibleText(page);
  assert.match(text, /\bRisen\b/);
  assert.doesNotMatch(text, /Still buried/);
  assert.ok(text.includes(risen.receiptHash));
  offered();
});

// ---- R9.3 ----

// A matchMedia that reports "reduce" for the reduced-motion query and nothing for any other.
const reducedMotion = (reduce) => (query) => ({
  matches: /prefers-reduced-motion\s*:\s*reduce/i.test(query) ? reduce : /prefers-reduced-motion\s*:\s*no-preference/i.test(query) ? !reduce : false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
});

function stylesheet() {
  const css = fs.readFileSync(CSS_URL, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  (function read(src, media) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) return;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth += 1;
        if (src[j] === '}') depth -= 1;
        j += 1;
      }
      const inner = src.slice(open + 1, j - 1);
      if (/^@media\b/i.test(head)) read(inner, head.slice(6).trim());
      else if (!head.startsWith('@')) out.push({ selector: head, body: inner, media });
      i = j;
    }
  })(css, null);
  return out;
}

function declared(body) {
  const out = new Map();
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).replace(/!important/i, '').trim());
  }
  return out;
}

test('R9.3 a receipt shown after a user action brings the verdict banner into view, with no scrolling animation under reduced motion', async () => {
  // After each action the page has asked for exactly one scroll, to an element that holds the verdict (and not the
  // whole receipt), when that element was already visible and already said Risen or Still buried.
  const scrolledOnce = (page, since, what) => {
    const calls = page.log.slice(since);
    assert.equal(calls.length, 1, `${what}: the page must bring the banner into view once, it did ${calls.length} times`);
    const [call] = calls;
    assert.equal(call.hidden, false, `${what}: the banner must be shown before it is scrolled to`);
    assert.match(call.text, VERDICT, `${what}: the banner must hold its verdict when it is scrolled to`);
    const receipt = JSON.parse(page.shown ?? RISEN_TEXT);
    assert.ok(!call.text.includes(receipt.contracts[0].name), `${what}: scroll to the banner, not to the whole receipt`);
    return call;
  };

  const page = await openPage({ matchMedia: reducedMotion(false) });
  const show = [...page.byId.values()].find((el) => el.tagName === 'BUTTON' && /show/i.test(el.own));
  assert.ok(show, 'index.html needs a button labelled Show');
  const fileInput = [...page.byId.values()].find((el) => el.tagName === 'INPUT' && el.getAttribute('type') === 'file');
  assert.ok(fileInput, 'index.html needs a file input');

  // paste
  let mark = page.log.length;
  page.box.value = RISEN_TEXT;
  await show.dispatch('click');
  await settle();
  scrolledOnce(page, mark, 'paste');

  // pick a file
  mark = page.log.length;
  fileInput.files = [{ size: BURIED_TEXT.length, text: async () => BURIED_TEXT }];
  await fileInput.dispatch('change');
  await settle();
  page.shown = BURIED_TEXT;
  const picked = scrolledOnce(page, mark, 'file pick');
  assert.match(picked.text, /Still buried/);

  // sample switch, both ways
  mark = page.log.length;
  await risenButton(page).dispatch('click');
  await settle();
  page.shown = RISEN_TEXT;
  scrolledOnce(page, mark, 'switch to the risen sample');
  mark = page.log.length;
  await buriedButton(page).dispatch('click');
  await settle();
  page.shown = BURIED_TEXT;
  scrolledOnce(page, mark, 'switch to the buried sample');

  // load from a link
  const linked = await openPage({ search: `?receipt=${RAW}`, files: { [RAW]: BURIED_TEXT }, matchMedia: reducedMotion(false) });
  linked.shown = BURIED_TEXT;
  scrolledOnce(linked, 0, 'a ?receipt= load');

  // Under prefers-reduced-motion: reduce no scroll the page asks for animates.
  const reduced = await openPage({ matchMedia: reducedMotion(true) });
  const reducedShow = [...reduced.byId.values()].find((el) => el.tagName === 'BUTTON' && /show/i.test(el.own));
  reduced.box.value = RISEN_TEXT;
  await reducedShow.dispatch('click');
  await buriedButton(reduced).dispatch('click');
  await settle();
  assert.ok(reduced.log.length >= 2, 'the banner is still brought into view under reduced motion');
  for (const call of reduced.log) {
    const behavior = call.options && typeof call.options === 'object' ? call.options.behavior : undefined;
    assert.ok(behavior === undefined || behavior === 'auto' || behavior === 'instant', `reduced motion: scrollIntoView behavior was ${behavior}`);
  }

  // The stylesheet cannot make the scroll smooth under reduce either: smooth scrolling is only set under no-preference.
  for (const rule of stylesheet()) {
    const value = declared(rule.body).get('scroll-behavior');
    if (!value || /^auto\b/i.test(value)) continue;
    assert.match(rule.media || '', /\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/i, `${rule.selector} sets scroll-behavior: ${value} outside prefers-reduced-motion: no-preference`);
  }
});

// ---- R9.4 ----

test('R9.4 the root element paints the whole background fixed to the window, so a tall page has no band or seam at any scroll position', () => {
  const rules = stylesheet().filter((r) => r.media === null);
  const parts = (r) => r.selector.split(',').map((s) => s.trim());
  const on = (name) => rules.filter((r) => parts(r).includes(name)).map((r) => declared(r.body));
  const merged = (name) => new Map(on(name).flatMap((d) => [...d]));

  // 1. The root element (html or :root) carries the page color and the fixed background, at least as tall as the window.
  const root = new Map([...merged('html'), ...merged(':root')].filter(([k]) => !k.startsWith('--')));
  assert.ok(root.has('background-color') || root.has('background'), 'html must paint the page background');
  assert.match(root.get('background-attachment') || '', /\bfixed\b/, 'html must use background-attachment: fixed, so the background does not end partway down a tall page');
  assert.match(root.get('background-repeat') || root.get('background') || '', /no-repeat/, 'a gradient on html must not tile into visible bands');
  assert.match(root.get('min-height') || '', /^100(%|vh|dvh|svh|lvh)$/, 'html must be at least as tall as the window');

  // 2. The body adds no second background that could end where the body does.
  const body = merged('body');
  for (const prop of ['background', 'background-color', 'background-image']) {
    assert.doesNotMatch(body.get(prop) || 'transparent', /#|rgb|var\(|gradient|url/i, `body ${prop} would paint a second layer`);
  }
  assert.ok(!/fixed/.test(body.get('background-attachment') || ''), 'background-attachment: fixed belongs on the root element');

  // 3. No rule pushes a decorative layer past the top or bottom of the window: a layer hung below the edge is cut off
  //    there, and the cut shows as a band when the window height changes.
  for (const r of stylesheet()) {
    for (const prop of ['top', 'bottom']) {
      const value = declared(r.body).get(prop);
      assert.ok(!value || !/^-/.test(value), `${r.selector} sets ${prop}: ${value}, which hangs a layer past the window edge`);
    }
    // 4. Every fixed layer fills the window, so there is no gap beside it.
    const d = declared(r.body);
    if (d.get('position') === 'fixed' && /pointer-events/.test(r.body)) {
      const fills = d.get('inset') === '0' || ['top', 'right', 'bottom', 'left'].every((p) => d.get(p) === '0');
      assert.ok(fills, `${r.selector} is a fixed decorative layer and must fill the window (inset: 0)`);
    }
  }
});
