// Contracts for R10.1 to R10.4 of the receipt-viewer spec: the story in one glance. The page heading says the idea, a
// "How it works" section follows the receipt card, the demo command can be copied, and the video and the repository are
// plain links.
//
// Node cannot lay a page out or load a video, so R10.1, R10.3 and R10.4 read site/index.html and site/style.css as text,
// and R10.2 also runs the copy button of site/app.js against a small fake DOM built from the ids in index.html.
// The above-fold contract (R9.5) is a separate frozen file that the gate runs on its own; R10.1 here checks the heading
// and where it sits. Whether the page really fits 1280x800 and 390x844 is measured by hand in a headless browser.
//
// app.js is loaded with a dynamic import so this file always loads and the contract names are always registered.
// Dynamic imports are not followed by necro's import tracing, so the module is also named below the way a static import
// would name it. Keep this line: the receipt pins files it finds this way.
//   import {} from '../../site/app.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const HTML = fs.readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const APP_URL = new URL('../../site/app.js', import.meta.url);

const IDEA = 'Kiro cannot call a task done until its frozen contracts pass.';
const DEMO = 'npx -y github:vijaygopalbalasa/contract-necromancer demo';
const VIDEO = 'https://youtu.be/TYrSyhIYqlk';
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
  // The heading must not push the first-visit view out of Requirement 9.5: it is the only heading above the banner,
  // and its size is still compact. The above-fold contract measures the rest.
  const above = HTML.slice(HTML.indexOf('<body'), idAt('verdict'));
  assert.doesNotMatch(above, /<h2/, 'no second heading above the banner');
  const size = /(^|[\s;{}])h1\s*{[^}]*font-size:\s*clamp\(\s*([\d.]+)rem/.exec(CSS);
  assert.ok(size && Number(size[2]) <= 1.5, 'the heading stays compact at phone width');
});

// ---- R10.2 ----

test('R10.2 a "How it works" section follows the receipt card with three steps, the demo command, a copy button and what the demo needs', async () => {
  // Directly after the receipt card in reading order.
  const receipt = section('receipt');
  const how = section('how');
  assert.equal(HTML.slice(receipt.end, how.start).trim(), '', 'nothing stands between the receipt card and the section');
  assert.match(how.text, /<h2[^>]*>\s*How it works\s*<\/h2>/);

  // Three numbered steps, in this order.
  const list = /<ol\b[^>]*>([\s\S]*?)<\/ol>/.exec(how.text);
  assert.ok(list, 'the steps are an ordered list');
  const steps = [...list[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => words(m[1]));
  assert.equal(steps.length, 3, 'three steps');
  assert.match(steps[0], /person.*freezes.*contracts/i);
  assert.match(steps[1], /gate.*refuses.*pass/i);
  assert.match(steps[2], /receipt.*re-run/i);

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
  assert.match(how, /<a\b[^>]*href="https:\/\/youtu\.be\/TYrSyhIYqlk"[^>]*>[^<]*video[^<]*<\/a>/i, 'the video link says what it is');
  assert.match(how, /<a\b[^>]*href="https:\/\/github\.com\/vijaygopalbalasa\/contract-necromancer"[^>]*>[^<]*repository[^<]*<\/a>/i, 'the repository link says what it is');

  // The Content Security Policy is the one from the design, byte for byte.
  const csp = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(HTML);
  assert.ok(csp, 'the page has a Content Security Policy');
  assert.equal(csp[1], CSP);

  // Nothing is embedded or loaded for the story: no frame, media, image, object, extra script, style or style sheet.
  assert.doesNotMatch(HTML, /<(iframe|video|audio|embed|object|img|source|picture|style)\b/i);
  assert.equal((HTML.match(/<script\b/g) || []).length, 1, 'the one module script');
  assert.equal((HTML.match(/<link\b(?![^>]*rel="icon")/g) || []).length, 1, 'the one style sheet (the inline data: favicon of R11.5 aside)');
});

// ---- R10.4 ----

test('R10.4 the title starts with "Contract Necromancer", the page reads in the order it is drawn, and it wraps at phone width', () => {
  assert.match(HTML, /<title>Contract Necromancer\b[^<]*<\/title>/);

  // The document order is the story: idea, samples, own receipt, verdict, receipt, how it works, the checks, about.
  const order = ['brand', 'sample-row', 'open', 'verdict', 'receipt', 'how', 'hash-check', 'run', 'file-check', 'about'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(idAt(order[i - 1]) < idAt(order[i]), `#${order[i - 1]} must come before #${order[i]}`);
  }

  // No CSS moves anything away from its place in the document.
  assert.doesNotMatch(CSS, /(^|[\s;{])order\s*:/, 'no flex or grid order');
  assert.doesNotMatch(CSS, /(row|column)-reverse/, 'no reversed flex direction');
  assert.doesNotMatch(CSS, /grid-template-areas|grid-area\s*:/, 'no grid areas');
  assert.doesNotMatch(CSS, /direction\s*:\s*rtl/, 'no right-to-left flow');

  // It can wrap at phone width: a viewport tag, no fixed widths on the section, and a command block that wraps.
  assert.match(HTML, /<meta[^>]*name="viewport"[^>]*content="width=device-width, initial-scale=1"/);
  const rules = [...CSS.matchAll(/(?:^|})\s*([^{}@]+){([^{}]*)}/g)].filter((m) => /\.(how|steps|demo|links)\b|#how\b/.test(m[1]));
  assert.ok(rules.length > 0, 'style.css styles the section');
  for (const m of rules) {
    assert.doesNotMatch(m[2], /(?:^|[\s;])(?:min-)?width\s*:\s*[\d.]+(?:px|rem|em|vw)/, `${m[1].trim()} sets a fixed width`);
    assert.doesNotMatch(m[2], /white-space\s*:\s*(?:pre|nowrap)\s*(?:;|$)/, `${m[1].trim()} stops wrapping`);
  }
  assert.match(CSS, /(^|[\s,}])pre\s*{[^}]*white-space:\s*pre-wrap/, 'pre wraps');
  assert.match(CSS, /overflow-wrap\s*:\s*anywhere/);
});
