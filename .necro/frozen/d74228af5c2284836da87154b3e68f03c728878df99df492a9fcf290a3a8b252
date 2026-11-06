// Contracts for reading a receipt cleanly: R7.1, R7.2, R7.3 and R7.4 of the receipt-viewer spec.
//
// All four are about what the page shows, so each test runs site/app.js against a small fake DOM. The fake DOM is built
// from the ids, tags and attributes in site/index.html, so the test and the page cannot drift apart. It is a copy of
// the one in look.contract.test.js, because a shared helper file would not be frozen. Nothing touches the network:
// fetch is a stub that serves only the files a test hands it.
//
// The site modules are loaded with a dynamic import inside each test, so this file always loads and every contract
// name is registered even while the viewer does not do these things yet.
//
// Dynamic imports are not followed by necro's import tracing, so the modules are also named below the way a static
// import would name them. Keep these lines: the receipt pins files it finds this way.
//   import {} from '../../site/app.js';
//   import {} from '../../site/lib/receipt.js';
//   import {} from '../../site/lib/repo.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP_URL = new URL('../../site/app.js', import.meta.url);
const HTML_URL = new URL('../../site/index.html', import.meta.url);
const SAMPLE_URL = new URL('../../site/sample-receipt.json', import.meta.url);
const README_URL = new URL('../../README.md', import.meta.url);

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

// Start the page. `files` maps the end of a URL to the text a fetch of it returns.
async function openPage(files = {}) {
  const page = createDom();
  page.requested = [];
  const fetchStub = async (url) => {
    page.requested.push(String(url));
    const hit = Object.entries(files).find(([suffix]) => String(url).endsWith(suffix));
    if (!hit) throw new Error('these contracts do not use the network');
    return new Response(hit[1], { status: 200 });
  };
  const { start } = await import(APP_URL.href);
  await start({
    document: page.document,
    location: { search: '', href: 'https://example.test/' },
    fetch: fetchStub,
    navigator: { clipboard: { writeText: async () => {} } },
  });
  return page;
}

// Paste a receipt and press the show button.
async function showReceipt(receipt) {
  const page = await openPage();
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

test('R7.1 the task line is shown without Markdown emphasis markers', async () => {
  const line = '3. **Receipt parsing** and __validation__ with `parseReceipt` (Req 1.3)';
  const page = await showReceipt(makeReceipt([['R1.3 first', 'pass']], { task: line, required: ['R1.3 first'] }));
  const text = visibleText(page);

  // The words are all still there, in order, with the markers taken out.
  assert.ok(
    text.includes('Receipt parsing and validation with parseReceipt (Req 1.3)'),
    'the page must show the task line text without its markers',
  );

  // Nothing on the page carries a marker.
  assert.ok(!text.includes('**'), 'the page must not show ** around task text');
  assert.ok(!text.includes('__'), 'the page must not show __ around task text');
  assert.ok(!text.includes('`'), 'the page must not show backticks around task text');
});

test('R7.2 requirements and the contracts inside each one are ordered by criterion number', async () => {
  // Every contract passes, so the verdict banner does not name any of them. The receipt lists them out of order.
  const inOrder = [
    'R1.1 one one',
    'R1.2 one two',
    'R1.10 one ten',
    'R2.1 two one',
    'R2.2 two two',
    'R2.10 two ten',
    'R10.1 ten one',
    'R10.2 ten two',
  ];
  const shuffled = [
    'R10.2 ten two',
    'R2.10 two ten',
    'R1.10 one ten',
    'R2.2 two two',
    'R1.2 one two',
    'R10.1 ten one',
    'R2.1 two one',
    'R1.1 one one',
  ];
  const page = await showReceipt(makeReceipt(shuffled.map((name) => [name, 'pass'])));
  const text = visibleText(page);

  const positions = inOrder.map((name) => text.indexOf(name));
  inOrder.forEach((name, i) => assert.ok(positions[i] >= 0, `the page does not show "${name}"`));
  for (let i = 1; i < inOrder.length; i += 1) {
    assert.ok(
      positions[i - 1] < positions[i],
      `"${inOrder[i - 1]}" must be shown before "${inOrder[i]}" (criterion numbers are compared as numbers, not as text)`,
    );
  }
});

test('R7.3 a contract that was not required is labelled "not required for this task" when it passes and "not built yet" when it fails', async () => {
  const [alpha, bravo, charlie, delta] = ['R1.1 alpha gate', 'R1.2 bravo gate', 'R1.3 charlie gate', 'R1.4 delta gate'];
  const names = [alpha, bravo, charlie, delta];
  const notRequiredPass = /not required for this task/i;
  const notBuilt = /not built yet/i;

  // alpha: passes, required. bravo: passes, not required. charlie: fails, required. delta: fails, not required.
  const marked = await showReceipt(
    makeReceipt(
      [
        [alpha, 'pass'],
        [bravo, 'pass'],
        [charlie, 'fail'],
        [delta, 'fail'],
      ],
      { task: 'Open the gates', required: [alpha, charlie] },
    ),
  );
  const text = (name) => rowOf(marked, name, names).textContent;

  assert.match(text(bravo), notRequiredPass, 'a passing contract that was not required needs the label');
  assert.doesNotMatch(text(bravo), notBuilt, 'a passing contract is never "not built yet"');
  assert.match(text(delta), notBuilt, 'a failing contract that was not required needs the label');
  assert.doesNotMatch(text(delta), notRequiredPass, 'a failing contract that was not required gets the other label');
  for (const name of [alpha, charlie]) {
    assert.doesNotMatch(text(name), notRequiredPass, `${name} was required and gets no "not required" label`);
    assert.doesNotMatch(text(name), notBuilt, `${name} was required and gets no "not built yet" label`);
  }

  // A receipt that does not say what was required gets neither label.
  const unmarked = await showReceipt(
    makeReceipt([
      [alpha, 'pass'],
      [delta, 'fail'],
    ]),
  );
  for (const name of [alpha, delta]) {
    const row = rowOf(unmarked, name, [alpha, delta]).textContent;
    assert.doesNotMatch(row, notRequiredPass, `${name}: no task, so no "not required" label`);
    assert.doesNotMatch(row, notBuilt, `${name}: no task, so no "not built yet" label`);
  }
});

test('R7.4 the sample and the re-run command use vijaygopalbalasa/contract-necromancer, and the README gives the page address', async () => {
  const REPO = 'vijaygopalbalasa/contract-necromancer';
  const ADDRESS = 'https://vijaygopalbalasa.github.io/contract-necromancer/';

  // Press "Load the sample": the repository box and the re-run command name this project's repository.
  const page = await openPage({ 'sample-receipt.json': fs.readFileSync(SAMPLE_URL, 'utf8') });
  await button(page, /sample/i).dispatch('click');
  await settle();
  assert.ok(
    page.requested.some((url) => url.endsWith('sample-receipt.json')),
    'the sample button must fetch sample-receipt.json',
  );

  const box = [...page.byId.values()].find((el) => el.tagName === 'INPUT' && el.getAttribute('type') === 'text');
  assert.ok(box, 'index.html needs a text input for the repository');
  assert.equal(box.value, REPO, 'the sample must prefill the repository box');

  const command = [...page.byId.values()].find((el) => el.tagName === 'PRE');
  assert.ok(command, 'index.html needs a pre element for the re-run command');
  assert.ok(
    command.textContent.includes(`git clone https://github.com/${REPO}.git`),
    `the re-run command for the sample must clone ${REPO}`,
  );
  assert.doesNotMatch(command.textContent, /OWNER\/NAME/, 'the placeholder must not be left in the command');

  // The README gives the real page address.
  const readme = fs.readFileSync(README_URL, 'utf8');
  assert.ok(readme.includes(ADDRESS), `README.md must give the page address ${ADDRESS}`);
});
