// Contracts for the Kiroween look: R8.1, R8.2, R8.3 and R8.4 of the receipt-viewer spec.
//
// R8.1 and the row checks of R8.4 are about what the page shows, so they run site/app.js against a small fake DOM built
// from the ids, tags and attributes in site/index.html. It is a copy of the one in clean.contract.test.js, because a
// shared helper file would not be frozen. R8.2, R8.3 and the style checks of R8.4 read site/index.html, site/style.css
// and the site scripts as text. None of this can lay the page out or play an animation; see
// contracts/receipt-viewer/README.md. Nothing touches the network.
//
// The site modules are loaded with a dynamic import inside each test, so this file always loads and every contract
// name is registered even while the viewer does not do these things yet.
//
// Dynamic imports are not followed by necro's import tracing, so the modules are also named below the way a static
// import would name them. Keep these lines: the receipt pins files it finds this way.
//   import {} from '../../site/app.js';
//   import {} from '../../site/lib/receipt.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP_URL = new URL('../../site/app.js', import.meta.url);
const HTML_URL = new URL('../../site/index.html', import.meta.url);
const CSS_URL = new URL('../../site/style.css', import.meta.url);
const SITE_URL = new URL('../../site/', import.meta.url);

const HEX = (c) => c.repeat(64);

// ---- a small fake DOM, built from site/index.html ----

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parent = null;
    this.own = '';
    this.value = '';
    this.files = [];
    this.disabled = false;
    this.listeners = new Map();
  }
  get isText() {
    return this.tagName === '#TEXT';
  }
  get id() {
    return this.attrs.get('id') || '';
  }
  set id(v) {
    this.attrs.set('id', String(v));
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
  get dataset() {
    const attrs = this.attrs;
    const key = (k) => `data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    return new Proxy({}, { get: (_, k) => attrs.get(key(k)), set: (_, k, v) => (attrs.set(key(k), String(v)), true) });
  }
  get textContent() {
    return this.own + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.own = String(v);
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  hasAttribute(name) {
    return this.attrs.has(name);
  }
  removeAttribute(name) {
    this.attrs.delete(name);
  }
  adopt(n) {
    const node = typeof n === 'string' ? Object.assign(new FakeNode('#text'), { own: n }) : n;
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    node.parent = this;
    return node;
  }
  appendChild(n) {
    const node = this.adopt(n);
    this.children.push(node);
    return node;
  }
  append(...ns) {
    for (const n of ns) this.appendChild(n);
  }
  prepend(...ns) {
    const nodes = ns.map((n) => this.adopt(n));
    this.children.unshift(...nodes);
  }
  insertBefore(n, ref) {
    const node = this.adopt(n);
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node);
    else this.children.splice(i, 0, node);
    return node;
  }
  removeChild(n) {
    this.children = this.children.filter((c) => c !== n);
    n.parent = null;
    return n;
  }
  remove() {
    if (this.parent) this.parent.removeChild(this);
  }
  replaceChildren(...ns) {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.own = '';
    this.append(...ns);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  // Run every listener for `type` and wait for the async ones.
  async dispatch(type) {
    const event = { type, target: this, preventDefault() {}, stopPropagation() {} };
    await Promise.all((this.listeners.get(type) || []).map((fn) => fn(event)));
  }
}

// Every element that has an id in index.html exists from the start, in page order, with the tag, the attributes
// (hidden included) and the text that the HTML gives it.
function createDom() {
  const html = fs.readFileSync(HTML_URL, 'utf8');
  const byId = new Map();
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const attrs = [...m[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)];
    const idAttr = attrs.find((a) => a[1] === 'id');
    if (!idAttr) continue;
    const el = new FakeNode(m[1]);
    for (const a of attrs) el.attrs.set(a[1], a[2] ?? a[3] ?? '');
    el.own = /^[^<]*/.exec(html.slice(m.index + m[0].length))[0].replace(/\s+/g, ' ').trim();
    byId.set(idAttr[2] ?? idAttr[3], el);
  }
  const document = {
    body: new FakeNode('body'),
    createElement: (tag) => new FakeNode(tag),
    createElementNS: (_ns, tag) => new FakeNode(tag),
    createTextNode: (text) => Object.assign(new FakeNode('#text'), { own: String(text) }),
    getElementById: (id) => byId.get(id) || null,
  };
  return { document, byId };
}

function walk(el, visit) {
  visit(el);
  for (const c of el.children) walk(c, visit);
}

// The elements the reader can see: those with an id and without the hidden attribute, and everything below them.
function visibleElements(page) {
  const out = [];
  for (const root of page.byId.values()) if (!root.hidden) walk(root, (el) => !el.isText && out.push(el));
  return out;
}

// All visible text in page order, one line per element that has an id.
function visibleText(page) {
  return [...page.byId.values()].filter((el) => !el.hidden).map((el) => el.textContent).join('\n');
}

// The row of one contract: start at the smallest element that holds the name, then go up while the parent still
// holds no other contract's name.
function rowOf(page, name, allNames) {
  let best = null;
  for (const el of visibleElements(page)) {
    if (el.textContent.includes(name) && (best === null || el.textContent.length < best.textContent.length)) best = el;
  }
  assert.ok(best, `the page does not show the contract "${name}"`);
  let row = best;
  while (row.parent && !allNames.some((n) => n !== name && row.parent.textContent.includes(n))) row = row.parent;
  return row;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

function button(page, label) {
  const found = [...page.byId.values()].find((el) => el.tagName === 'BUTTON' && label.test(el.own));
  assert.ok(found, `index.html needs a button labelled ${label}`);
  return found;
}

// Start the page with no network, paste a receipt and press the show button.
async function showReceipt(receipt) {
  const page = createDom();
  const { start } = await import(APP_URL.href);
  await start({
    document: page.document,
    location: { search: '', href: 'https://example.test/' },
    fetch: async () => {
      throw new Error('these contracts do not use the network');
    },
    navigator: { clipboard: { writeText: async () => {} } },
  });
  const box = [...page.byId.values()].find((el) => el.tagName === 'TEXTAREA');
  assert.ok(box, 'index.html needs a textarea for pasting a receipt');
  box.value = JSON.stringify(receipt);
  await button(page, /show/i).dispatch('click');
  await settle();
  return page;
}

// A receipt that passes the viewer's structural checks. `contracts` is a list of [name, result].
function makeReceipt(contracts, { task, required } = {}) {
  const receipt = {
    spec: 'zombie-spec',
    gitCommit: null,
    requirements: { path: '.kiro/specs/zombie-spec/requirements.md', sha256: HEX('a') },
    contracts: contracts.map(([name, result]) => ({
      name,
      path: 'contracts/zombie-spec/a.contract.test.js',
      sha256: HEX('b'),
      result,
    })),
    receiptHash: HEX('d'),
    createdAt: '2026-11-07T00:00:00.000Z',
  };
  if (task !== undefined) receipt.task = { id: '3', line: task };
  if (required !== undefined) receipt.required = required;
  return receipt;
}

// ---- small CSS helpers, kept in this file so the contract does not depend on any unfrozen file ----

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Every `selector { declarations }` rule with the media query it sits in (null when none), found by counting braces.
// @keyframes blocks are returned as their own kind, and other @-rules (@font-face) as kind 'at'.
function parseCss(css) {
  const out = [];
  (function read(src, media) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth += 1;
        else if (src[j] === '}') depth -= 1;
        j += 1;
      }
      const inner = src.slice(open + 1, j - 1);
      if (/^@media\b/i.test(head)) {
        const query = head.slice(6).trim();
        read(inner, media ? `${media} and ${query}` : query);
      } else if (/^@(supports|layer)\b/i.test(head)) read(inner, media);
      else if (/^@(-\w+-)?keyframes\b/i.test(head)) out.push({ kind: 'keyframes', head, body: inner, media });
      else if (head.startsWith('@')) out.push({ kind: 'at', head, body: inner, media });
      else out.push({ kind: 'rule', selector: head, body: inner, media });
      i = j;
    }
  })(stripComments(css), null);
  return out;
}

// property → value, split on `;` outside parentheses so `url(data:...;base64,...)` stays whole.
function declarations(body) {
  const out = new Map();
  let depth = 0;
  let current = '';
  const parts = [];
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  for (const part of parts) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).replace(/!important/i, '').trim());
  }
  return out;
}

function ruleList(css) {
  return parseCss(css).filter((r) => r.kind === 'rule');
}

function selectorParts(selector) {
  return selector.split(',').map((s) => s.trim()).filter(Boolean);
}

function rootTokens(css) {
  const tokens = new Map();
  for (const r of ruleList(css)) {
    if (!selectorParts(r.selector).includes(':root')) continue;
    for (const [name, value] of declarations(r.body)) if (name.startsWith('--')) tokens.set(name, value);
  }
  return tokens;
}

// Resolve `var(--x)` through the :root tokens, then read a #rgb or #rrggbb color. Null when it is anything else.
function colorOf(value, tokens, depth = 0) {
  if (typeof value !== 'string' || depth > 5) return null;
  const v = value.trim();
  const variable = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(v);
  if (variable) return colorOf(tokens.get(variable[1]), tokens, depth + 1);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!hex) return null;
  const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The page background: the first background declaration on body, html or :root, resolved to a color.
function pageBackground(css, tokens) {
  for (const wanted of ['body', 'html', ':root']) {
    for (const r of ruleList(css)) {
      if (!selectorParts(r.selector).includes(wanted)) continue;
      const d = declarations(r.body);
      for (const prop of ['background-color', 'background']) {
        const color = colorOf(d.get(prop), tokens);
        if (color) return color;
      }
    }
  }
  return null;
}

// ---- R8.1 ----

test('R8.1 a verdict banner comes first: "Risen" with the count of living contracts, or "Still buried" with the count of failing required contracts', async () => {
  const RISEN = /\bRisen\b/;
  const BURIED = /Still buried/;

  // Show a receipt and find the banner: the smallest visible element that holds the verdict word and a number.
  async function verdict(contracts, options, word) {
    const receipt = makeReceipt(contracts, options);
    const page = await showReceipt(receipt);
    const text = visibleText(page);
    const at = word.exec(text);
    assert.ok(at, `the page must show ${word}`);

    let banner = null;
    for (const el of visibleElements(page)) {
      const t = el.textContent;
      if (word.test(t) && /\d/.test(t) && (banner === null || t.length < banner.textContent.length)) banner = el;
    }
    assert.ok(banner, `${word} must come with a number`);
    const numbers = banner.textContent.match(/\b\d+\b/g) || [];

    // First: the verdict is shown before the spec name, the receipt hash and the first contract.
    for (const later of ['zombie-spec', receipt.receiptHash, receipt.contracts[0].name]) {
      assert.ok(text.indexOf(later) >= 0, `the page does not show ${later}`);
      assert.ok(at.index < text.indexOf(later), `the verdict must come before "${later}"`);
    }
    return { numbers, text };
  }

  const gate = (n) => `${n} gate`;

  // Every required contract passes: "Risen" with the count of living (passing) contracts, 3 here. Two of them were
  // required, one passing contract was not, and one failing contract was not required either.
  {
    const { numbers, text } = await verdict(
      [
        [gate('alpha'), 'pass'],
        [gate('bravo'), 'pass'],
        [gate('charlie'), 'pass'],
        [gate('delta'), 'fail'],
      ],
      { task: 'Open the gates', required: [gate('alpha'), gate('bravo')] },
      RISEN,
    );
    assert.ok(numbers.includes('3'), `Risen must give the 3 living contracts, it gave ${numbers.join(', ') || 'no number'}`);
    assert.ok(!numbers.includes('2'), 'Risen counts all living contracts, not only the required ones');
    assert.doesNotMatch(text, BURIED);
  }

  // A required contract fails: "Still buried" with the count of failing required contracts, 2 here. Three contracts
  // fail in all, and one of them was not required.
  {
    const { numbers, text } = await verdict(
      [
        [gate('alpha'), 'pass'],
        [gate('bravo'), 'fail'],
        [gate('charlie'), 'fail'],
        [gate('delta'), 'fail'],
        [gate('echo'), 'pass'],
        [gate('foxtrot'), 'pass'],
        [gate('golf'), 'pass'],
      ],
      { task: 'Open the gates', required: [gate('alpha'), gate('bravo'), gate('charlie')] },
      BURIED,
    );
    assert.ok(numbers.includes('2'), `Still buried must give the 2 failing required contracts, it gave ${numbers.join(', ') || 'no number'}`);
    assert.ok(!numbers.includes('3'), 'Still buried counts failing required contracts, not every failing contract');
    assert.doesNotMatch(text, RISEN);
  }

  // A receipt that does not say what was required counts every contract as required.
  {
    const { numbers } = await verdict(
      [
        [gate('alpha'), 'pass'],
        [gate('bravo'), 'pass'],
        [gate('charlie'), 'pass'],
      ],
      {},
      RISEN,
    );
    assert.ok(numbers.includes('3'), 'with no task, Risen gives the 3 living contracts');
  }
  {
    const { numbers, text } = await verdict(
      [
        [gate('alpha'), 'pass'],
        [gate('bravo'), 'pass'],
        [gate('charlie'), 'pass'],
        [gate('delta'), 'fail'],
        [gate('echo'), 'fail'],
      ],
      {},
      BURIED,
    );
    assert.ok(numbers.includes('2'), 'with no task, Still buried gives the 2 failing contracts');
    assert.ok(!numbers.includes('3'), 'with no task, Still buried does not give the living count');
    assert.doesNotMatch(text, RISEN);
  }
});

// ---- R8.2 ----

test('R8.2 an inline SVG mark is drawn in the page with no external images or fonts, and text keeps AA contrast', () => {
  const html = fs.readFileSync(HTML_URL, 'utf8');
  const css = fs.readFileSync(CSS_URL, 'utf8');

  // An inline SVG with at least two drawn shapes: the gravestone and the checkmark.
  const svgs = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].map((m) => m[0]);
  assert.ok(svgs.length > 0, 'index.html needs an inline <svg> mark');
  const shapeCount = (svg) => (svg.match(/<(path|polyline|polygon|rect|circle|ellipse|line)\b/gi) || []).length;
  assert.ok(svgs.some((svg) => shapeCount(svg) >= 2), 'the SVG mark needs a gravestone shape and a checkmark shape');

  // No external images or fonts in the HTML. Links to other pages (<a href>) are allowed.
  const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
  for (const tag of html.match(/<[a-zA-Z][^>]*>/g) || []) {
    const name = /^<([\w:-]+)/.exec(tag)[1].toLowerCase();
    if (name === 'a') continue;
    for (const m of tag.matchAll(/\s(?:src|href|xlink:href|data|poster|srcset)\s*=\s*["']?([^"'\s>]+)/gi)) {
      const url = m[1];
      assert.ok(
        !external.test(url) || /^data:/i.test(url),
        `<${name}> loads ${url}: the page must draw its mark itself, with nothing external`,
      );
      if (['img', 'image', 'picture', 'object', 'embed', 'iframe', 'source'].includes(name)) {
        assert.ok(/^data:/i.test(url), `<${name}> loads ${url}: images must be inline`);
      }
    }
  }

  // No external images or fonts in the CSS.
  const bare = stripComments(css);
  assert.doesNotMatch(bare, /@import\b/, 'style.css must not import other stylesheets');
  assert.doesNotMatch(bare, /@font-face\b/, 'style.css must not load fonts');
  for (const m of bare.matchAll(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi)) {
    assert.ok(/^(#|data:)/i.test(m[2].trim()), `style.css loads ${m[2]}: images must be inline or drawn with CSS`);
  }

  // Text keeps WCAG AA (4.5:1). Every rule that sets a text color is checked against the background it sits on:
  // the background the same rule sets, or else the page background and the card surface when the stylesheet has one.
  const tokens = rootTokens(css);
  const page = pageBackground(css, tokens);
  assert.ok(page, 'style.css needs a hex page background');
  const surfaces = [page];
  for (const name of ['--surface', '--card', '--panel']) {
    const surface = colorOf(`var(${name})`, tokens);
    if (surface) surfaces.push(surface);
  }
  const keywords = /^(inherit|initial|unset|revert|currentcolor|transparent)$/i;
  for (const r of ruleList(css)) {
    if (selectorParts(r.selector).includes(':root')) continue;
    const d = declarations(r.body);
    if (!d.has('color') || keywords.test(d.get('color'))) continue;
    const text = colorOf(d.get('color'), tokens);
    assert.ok(text, `${r.selector}: color ${d.get('color')} must be a hex color or a var() of one, so contrast can be checked`);
    const own = colorOf(d.get('background-color'), tokens) || colorOf(d.get('background'), tokens);
    for (const background of own ? [own] : surfaces) {
      const ratio = contrast(text, background);
      assert.ok(ratio >= 4.5, `${r.selector}: text has contrast ${ratio.toFixed(2)}:1, AA needs 4.5:1`);
    }
  }
});

// ---- R8.3 ----

test('R8.3 every animation is off under prefers-reduced-motion: reduce', () => {
  const html = fs.readFileSync(HTML_URL, 'utf8');
  const css = fs.readFileSync(CSS_URL, 'utf8');
  const noPreference = (media) =>
    media !== null &&
    (/\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/i.test(media) ||
      /not\s+all\s+and\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i.test(media));
  const reduce = (media) =>
    media !== null && /\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i.test(media) && !/not\s+all/i.test(media);

  // Selector parts compared without spacing differences, with :before written as ::before.
  const normal = (s) =>
    s
      .toLowerCase()
      .replace(/\s*([>+~])\s*/g, '$1')
      .replace(/\s+/g, ' ')
      .replace(/(^|[^:]):(before|after)\b/g, '$1::$2');
  const pseudoOf = (part) => (/::(before|after)$/.exec(part) || [])[1] || null;

  // What a declaration block starts: a moving animation, or a moving transition.
  const starts = (d) => {
    const out = new Set();
    for (const prop of ['animation', 'animation-name']) {
      if (d.has(prop) && !/^(none|initial|unset)\b/i.test(d.get(prop))) out.add('animation');
    }
    for (const prop of ['transition', 'transition-property']) {
      const v = d.get(prop);
      if (v && !/^(none|initial|unset)\b/i.test(v) && /\b(transform|translate|scale|rotate|all|top|left|right|bottom|margin[\w-]*|height|width)\b/i.test(v)) {
        out.add('transition');
      }
    }
    return out;
  };
  // What a declaration block stops.
  const stops = (d) => {
    const out = new Set();
    const zero = /^0*\.?0*1?m?s$/i;
    if (/^none\b/i.test(d.get('animation') || '') || /^none\b/i.test(d.get('animation-name') || '') || zero.test(d.get('animation-duration') || '')) {
      out.add('animation');
    }
    if (/^none\b/i.test(d.get('transition') || '') || zero.test(d.get('transition-duration') || '') || /^none\b/i.test(d.get('transition-property') || '')) {
      out.add('transition');
    }
    return out;
  };

  const rules = ruleList(css);
  const off = [];
  for (const r of rules.filter((x) => reduce(x.media))) {
    const kinds = stops(declarations(r.body));
    for (const part of selectorParts(r.selector)) off.push({ part: normal(part), kinds });
  }
  const covered = (part, kind) => {
    const p = normal(part);
    return off.some((o) => {
      if (!o.kinds.has(kind)) return false;
      if (o.part === p) return true;
      if (o.part === '*') return pseudoOf(p) === null;
      return o.part === `*::${pseudoOf(p)}`;
    });
  };

  // A rule that starts motion must sit in a no-preference block, or be switched off by a reduce block.
  for (const r of rules) {
    if (noPreference(r.media)) continue;
    for (const kind of starts(declarations(r.body))) {
      for (const part of selectorParts(r.selector)) {
        assert.ok(
          covered(part, kind),
          `${part} starts a ${kind} outside prefers-reduced-motion: no-preference, and no prefers-reduced-motion: reduce rule turns it off`,
        );
      }
    }
  }

  // Animation the stylesheet cannot switch off: SVG animation elements in the page.
  assert.doesNotMatch(html, /<(animate|animateTransform|animateMotion|set)\b/i, 'index.html must not use SVG animation elements');

  // Script animation must ask for the preference.
  const files = [new URL('app.js', SITE_URL), new URL('main.js', SITE_URL)];
  for (const name of fs.readdirSync(new URL('lib/', SITE_URL))) if (name.endsWith('.js')) files.push(new URL(`lib/${name}`, SITE_URL));
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (/\.animate\s*\(|requestAnimationFrame|setInterval/.test(source)) {
      assert.match(source, /prefers-reduced-motion/, `${file.pathname.split('/site/')[1]} animates, so it must check prefers-reduced-motion`);
    }
  }
});

// ---- R8.4 ----

test('R8.4 a failing contract row is drawn as a gravestone and a passing one as alive, with CSS only', async () => {
  const css = fs.readFileSync(CSS_URL, 'utf8');
  const tokens = rootTokens(css);
  const live = 'R1.1 alpha gate';
  const dead = 'R1.2 bravo gate';
  const page = await showReceipt(makeReceipt([[live, 'pass'], [dead, 'fail']]));
  const names = [live, dead];
  const liveRow = rowOf(page, live, names);
  const deadRow = rowOf(page, dead, names);

  // The rows read as plain text: the state is a word, and any decorative glyph is hidden from screen readers.
  assert.match(liveRow.textContent, /\bPASS\b/, 'a passing row says PASS in words');
  assert.match(deadRow.textContent, /\bFAIL\b/, 'a failing row says FAIL in words');
  for (const row of [liveRow, deadRow]) {
    walk(row, (el) => {
      if (el === row) return;
      assert.ok(!['IMG', 'SVG', 'CANVAS', 'PICTURE', 'VIDEO', 'OBJECT', 'EMBED'].includes(el.tagName), `rows are drawn with CSS only, not with <${el.tagName.toLowerCase()}>`);
      if (el.isText || el.children.length > 0 || !/[^\x00-\x7f]/.test(el.textContent)) return;
      let hidden = false;
      for (let up = el; up; up = up.parent === row.parent ? null : up.parent) {
        if (up.getAttribute && up.getAttribute('aria-hidden') === 'true') hidden = true;
        if (up === row) break;
      }
      assert.ok(hidden, `the symbol "${el.textContent}" in a row needs aria-hidden="true"`);
    });
  }

  // Which CSS rules reach a row: a rule matches when one compound selector in it matches the row's tag, classes and
  // attributes. `itself` is true when the last compound does (the row or its ::before / ::after).
  const describe = (row) => {
    const attrs = new Map([...row.attrs].filter(([k]) => k !== 'class' && k !== 'id'));
    return { tag: row.tagName.toLowerCase(), classes: new Set(row.className.split(/\s+/).filter(Boolean)), attrs };
  };
  const compoundMatches = (compound, row) => {
    const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+|\[[^\]]+\])*)$/.exec(compound);
    if (!m || (!m[1] && !m[2])) return false;
    if (m[1] && m[1].toLowerCase() !== row.tag) return false;
    for (const part of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) || []) {
      if (part[0] === '.') {
        if (!row.classes.has(part.slice(1))) return false;
      } else {
        const a = /^\[\s*([\w-]+)\s*(?:=\s*["']?([^"'\]]*)["']?)?\s*\]$/.exec(part);
        if (!a || !row.attrs.has(a[1]) || (a[2] !== undefined && row.attrs.get(a[1]) !== a[2])) return false;
      }
    }
    return true;
  };
  const reaching = (row) => {
    const out = new Map();
    ruleList(css).forEach((r, index) => {
      for (const part of selectorParts(r.selector)) {
        const bare = part.replace(/::?(before|after)$/, '');
        if (/:/.test(bare.replace(/\[[^\]]*\]/g, ''))) continue; // :hover, :not() and the like
        const compounds = bare.split(/\s*[>+~]\s*|\s+/);
        const itself = compoundMatches(compounds.at(-1), row);
        if (itself || compounds.some((c) => compoundMatches(c, row))) {
          out.set(`${index}:${part}`, { itself, decls: declarations(r.body) });
        }
      }
    });
    return out;
  };
  const liveRules = reaching(describe(liveRow));
  const deadRules = reaching(describe(deadRow));
  const onlyIn = (a, b) => [...a].filter(([key]) => !b.has(key)).map(([, rule]) => rule);
  const deadOnly = onlyIn(deadRules, liveRules);
  const liveOnly = onlyIn(liveRules, deadRules);
  assert.ok(deadOnly.length > 0, 'style.css needs rules that apply to a failing row and not to a passing one');
  assert.ok(liveOnly.length > 0, 'style.css needs rules that apply to a passing row and not to a failing one');

  // Gravestone: the row itself gets an arched top (larger top corner radii than bottom ones), or a clip-path.
  const merged = (rules) => {
    const out = new Map();
    for (const { itself, decls } of rules) if (itself) for (const [k, v] of decls) out.set(k, v);
    return out;
  };
  const arched = (d) => {
    if (d.has('clip-path') && !/^none$/i.test(d.get('clip-path'))) return true;
    const num = (v) => (/^(-?[\d.]+)/.exec(String(v).trim()) || [0, '0'])[1] * 1;
    let c = null;
    if (d.has('border-radius')) {
      const v = d.get('border-radius').split('/')[0].trim().split(/\s+/).map(num);
      c = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v.length === 3 ? [v[0], v[1], v[2], v[1]] : v.slice(0, 4);
    }
    ['top-left', 'top-right', 'bottom-right', 'bottom-left'].forEach((corner, i) => {
      if (d.has(`border-${corner}-radius`)) {
        c = c || [0, 0, 0, 0];
        c[i] = num(d.get(`border-${corner}-radius`).split(/\s+/)[0]);
      }
    });
    return c !== null && Math.min(c[0], c[1]) > 0 && Math.min(c[0], c[1]) > Math.max(c[2], c[3]);
  };
  assert.ok(arched(merged(deadOnly)), 'a failing row must be drawn as a gravestone: an arched top (border-radius like 999px 999px 0 0) or a clip-path');
  assert.ok(!arched(merged(liveOnly)), 'a passing row must not be drawn as a gravestone');

  // Alive: a passing row glows (shadow, filter or animation) in the alive color.
  const aliveHex = colorOf('var(--alive)', tokens);
  assert.ok(aliveHex, 'style.css needs a hex --alive token');
  const usesAlive = (value) => /var\(\s*--alive\s*\)/.test(value) || (colorOf(value.trim(), tokens) || []).join() === aliveHex.join();
  assert.ok(
    liveOnly.some(({ decls }) => [...decls.values()].some(usesAlive)),
    'a passing row must use the --alive color',
  );
  assert.ok(
    liveOnly.some(({ decls }) => ['box-shadow', 'text-shadow', 'filter', 'animation', 'animation-name'].some((p) => decls.has(p) && !/^none\b/i.test(decls.get(p)))),
    'a passing row must glow: box-shadow, text-shadow, filter or animation',
  );

  // CSS only, and plain text to a screen reader: no images, and no generated text that a screen reader would read.
  for (const { decls } of [...deadRules.values(), ...liveRules.values()]) {
    for (const [prop, value] of decls) {
      assert.doesNotMatch(value, /url\(/i, `${prop}: rows are drawn with CSS only, with no url()`);
    }
    if (decls.has('content')) {
      const v = decls.get('content').trim();
      assert.ok(
        /^(none|normal|""|'')$/.test(v) || /\/\s*(""|'')$/.test(v),
        `content: ${v} would be read by a screen reader; use an empty string or give it empty alt text`,
      );
    }
  }
});
