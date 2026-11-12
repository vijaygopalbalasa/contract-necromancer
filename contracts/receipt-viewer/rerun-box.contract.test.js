// Contracts for Requirement 15 of the receipt-viewer spec: the re-run box offers a command that works for the receipt it
// is shown with, or does not offer it. R15.1 to R15.5.
//
// What they run
// - R15.1 to R15.4 drive site/app.js against a small fake DOM built from site/index.html, and read what the page shows:
//   the visible lines of the re-run box (the section with id "run"), its visible <pre> elements and its visible copy
//   buttons. They do not call site/lib/repo.js directly, so the module that decides between the three kinds can be
//   named as the design likes. Nothing touches the network: fetch is a stub and git is pointed at a local copy.
// - R15.1 and R15.5 run the command the page shows, in sh, against a local copy of this repository, the way the R5.2
//   contract (fresh-clone.contract.test.js) does: git is told that the GitHub address of this repository means a local
//   folder (url.<base>.insteadOf, set through GIT_CONFIG_* variables), so the text of the command is exactly what the
//   page shows.
//
// Two differences from R5.2, both on purpose
// - The local copy is a bare repository made from this repository's HEAD, with a branch called main as its default
//   branch. GitHub always has a default branch. This repository's own checkout may sit on a detached HEAD (a pull
//   request build does), and a clone of that has no origin/HEAD for reasons that have nothing to do with the command.
// - HOME is the real one. The receipt that R15.5 re-runs pins page contracts that start a headless Chrome or Chromium,
//   and that browser hangs on macOS when HOME is an empty folder (seen on macOS with Chrome 157). Git is kept away from
//   the user's configuration with GIT_CONFIG_GLOBAL and GIT_CONFIG_NOSYSTEM instead. R5.2 keeps checking that the
//   command changes nothing outside the folder it clones; these contracts do not repeat that.
//
// Fixtures, all real files of this repository (their shape is asserted before each use)
// - committed:   .necro/receipts/receipt-viewer/a5577499...json, commit 3596b034, `uncommitted` is empty and it pins
//                the R5.2 contract. It is the first kind, and the one that failed with MISMATCH on R5.2 before the fix.
// - uncommitted: .necro/receipts/receipt-viewer/00e62843...json, two files in `uncommitted`. The second kind.
// - buried:      site/sample-buried.json, `gitCommit` is null. The third kind.
// - pasted:      site/play/risen-receipt.json, what `necro demo` writes, `gitCommit` is null. The third kind.
//
// R15.5 re-runs the committed fixture with the real verifier, which takes about 45 seconds, and needs git, Node.js 24
// and a Chrome or Chromium on this machine (set CHROME_PATH when it is not in a usual place). It does not repeat the
// risen sample, which R5.2 already re-runs through the same command.
//
// The page is loaded with a dynamic import inside each test, so this file always loads and every contract name is
// registered. Dynamic imports are not followed by necro's import tracing, so the modules are also named below the way
// a static import would name them. Keep these lines: the receipt pins files it finds this way.
//   import {} from '../../site/app.js';
//   import {} from '../../site/lib/repo.js';
//   import {} from '../../site/lib/receipt.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const APP_URL = new URL('../../site/app.js', import.meta.url);
const HTML_URL = new URL('../../site/index.html', import.meta.url);

const REPO = 'vijaygopalbalasa/contract-necromancer';
const PROJECT_URL = `https://github.com/${REPO}.git`;
const RAW_PREFIX = 'https://raw.githubusercontent.com/';
const SYSTEM_PATH = '/usr/bin:/bin';
const HEX = (c) => c.repeat(64);
const COMMIT_A = '0123456789abcdef0123456789abcdef01234567';

const FIXTURE_FILES = {
  committed: '.necro/receipts/receipt-viewer/a5577499357b8583ce89ff5e03474c5eda2843adbc3564bd4478ebfc0e022ab2.json',
  uncommitted: '.necro/receipts/receipt-viewer/00e628430c4951cc4adf08c7f46e49289ab98be9096a024239beb95530b50999.json',
  buried: 'site/sample-buried.json',
  pasted: 'site/play/risen-receipt.json',
};

// Where `necro verify` is told to find a receipt: the default place the gate writes it. Receipt fields that the page
// puts in a command are quoted by the page when they hold anything unusual; the fixtures hold only safe characters.
const receiptPath = (r) => `.necro/receipts/${r.spec}/${r.receiptHash}.json`;
const localLine = (r) => `necro verify ${receiptPath(r)}`;

// The paths a receipt pins, as the Check files button lists them.
function pinnedPaths(r) {
  const paths = [r.requirements && r.requirements.path, ...(r.contracts || []).map((c) => c.path), ...(r.sources || []).map((s) => s.path)];
  for (const key of ['runners', 'frozen']) {
    const value = r[key];
    if (value && typeof value === 'object') paths.push(...(Array.isArray(value) ? value : [value]).map((v) => (typeof v === 'string' ? v : v && v.path)));
  }
  return new Set(paths.filter((p) => typeof p === 'string'));
}

// A fixture, read from disk, with its shape checked so that a changed file cannot quietly turn a test into another test.
function fixture(name) {
  const text = fs.readFileSync(new URL(`../../${FIXTURE_FILES[name]}`, import.meta.url), 'utf8');
  const receipt = JSON.parse(text);
  const where = FIXTURE_FILES[name];
  if (name === 'committed') {
    assert.match(receipt.gitCommit, /^[0-9a-f]{40}$/, `${where} must name a full commit id`);
    assert.deepEqual(receipt.uncommitted, [], `${where} must have an empty uncommitted list`);
    assert.ok(
      receipt.contracts.some((c) => c.name.startsWith('R5.2 ') && c.path.endsWith('fresh-clone.contract.test.js')),
      `${where} must pin the R5.2 contract`,
    );
  } else if (name === 'uncommitted') {
    assert.match(receipt.gitCommit, /^[0-9a-f]{40}$/, `${where} must name a full commit id`);
    assert.ok(Array.isArray(receipt.uncommitted) && receipt.uncommitted.length >= 2, `${where} must list at least two uncommitted files`);
    for (const p of receipt.uncommitted) assert.ok(pinnedPaths(receipt).has(p), `${where}: ${p} must be a pinned file`);
    assert.ok(receipt.requirements && !receipt.uncommitted.includes(receipt.requirements.path), `${where}: its requirements file must be committed`);
  } else {
    assert.equal(receipt.gitCommit, null, `${where} must name no commit`);
  }
  return { text, receipt };
}

// A receipt that passes the viewer's structural checks, with the two fields that decide the kind and nothing else that
// matters. Its hash is made up, so the page shows ALTERED for it, which must not change what the re-run box offers.
function makeReceipt({ gitCommit, uncommitted, spec = 'zombie-spec', result = 'pass' }) {
  const receipt = {
    spec,
    gitCommit,
    requirements: { path: `.kiro/specs/${spec}/requirements.md`, sha256: HEX('a') },
    contracts: [{ name: 'R1.1 first', path: `contracts/${spec}/a.contract.test.js`, sha256: HEX('b'), result }],
    receiptHash: HEX('d'),
    createdAt: '2026-11-07T00:00:00.000Z',
  };
  if (uncommitted !== undefined) receipt.uncommitted = uncommitted;
  return receipt;
}

// ---- a small fake DOM, built from the whole tree of site/index.html ----

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BUTTON', 'SUMMARY', 'DETAILS', 'LABEL', 'HEADER', 'MAIN', 'TABLE', 'TR', 'TEXTAREA',
]);
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parent = null;
    this.data = '';
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
    return this.isText ? this.data : this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    if (this.isText) {
      this.data = String(v);
      return;
    }
    for (const c of this.children) c.parent = null;
    this.children = [];
    if (String(v) !== '') this.appendChild(String(v));
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
    const node = typeof n === 'string' ? Object.assign(new FakeNode('#text'), { data: n }) : n;
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

// Every element of index.html, nested as the HTML nests them, with its attributes (hidden included) and its text.
// Elements with an id are reachable through getElementById.
function createDom() {
  const html = fs
    .readFileSync(HTML_URL, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '<$1></$1>');
  const root = new FakeNode('#document');
  const byId = new Map();
  const stack = [root];
  let last = 0;
  const addText = (raw) => {
    const text = decode(raw).replace(/\s+/g, ' ');
    if (text !== '') stack[stack.length - 1].appendChild(text);
  };
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    addText(html.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((n) => n.tagName.toLowerCase()).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const el = new FakeNode(tag);
    for (const a of m[3].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) el.attrs.set(a[1], decode(a[2] ?? a[3] ?? ''));
    stack[stack.length - 1].appendChild(el);
    if (el.id) byId.set(el.id, el);
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(m[3])) stack.push(el);
  }
  const body = [...walkNodes(root)].find((n) => n.tagName === 'BODY') || root;
  const document = {
    body,
    createElement: (tag) => new FakeNode(tag),
    createElementNS: (_ns, tag) => new FakeNode(tag),
    createTextNode: (text) => Object.assign(new FakeNode('#text'), { data: String(text) }),
    getElementById: (id) => byId.get(id) || null,
  };
  return { document, byId, root };
}

function* walkNodes(node) {
  yield node;
  for (const c of node.children) yield* walkNodes(c);
}

// An element the reader can see: neither it nor anything above it has the hidden attribute.
function isVisible(node) {
  for (let n = node; n; n = n.parent) if (!n.isText && n.hidden) return false;
  return true;
}

// The visible text below `root`, one entry per block (paragraph, list item, code block, button, ...), spaces collapsed.
function visibleLines(root) {
  const out = [''];
  const visit = (n) => {
    if (n.isText) {
      out[out.length - 1] += n.data;
      return;
    }
    if (n.hidden) return;
    const block = BLOCK_TAGS.has(n.tagName);
    if (block && out[out.length - 1] !== '') out.push('');
    for (const c of n.children) visit(c);
    if (block && out[out.length - 1] !== '') out.push('');
  };
  if (isVisible(root)) visit(root);
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const sentencesOf = (lines) => lines.flatMap((l) => l.split(/(?<=[.!?])\s+/));

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

// Start the page. `fetchFn(url)` answers fetches; by default every fetch fails, because these contracts use no network.
async function openPage({ fetchFn } = {}) {
  const page = createDom();
  page.requested = [];
  page.clipboard = [];
  const fetchStub = async (url, options) => {
    page.requested.push(String(url));
    if (!fetchFn) throw new Error('these contracts do not use the network');
    return fetchFn(String(url), options);
  };
  const { start } = await import(APP_URL.href);
  await start({
    document: page.document,
    location: { search: '', href: 'https://example.test/' },
    fetch: fetchStub,
    navigator: { clipboard: { writeText: async (text) => void page.clipboard.push(String(text)) } },
  });
  return page;
}

function element(page, id) {
  const el = page.byId.get(id);
  assert.ok(el, `index.html needs an element with id "${id}"`);
  return el;
}

// Type the repository, paste the receipt text and press Show receipt.
async function showReceipt(page, text, repo = REPO) {
  element(page, 'repo').value = repo;
  element(page, 'paste').value = text;
  await element(page, 'show').dispatch('click');
  await settle();
}

async function typeRepo(page, repo) {
  element(page, 'repo').value = repo;
  await element(page, 'repo').dispatch('input');
  await settle();
}

// What the re-run box shows right now: its visible lines and sentences, its visible code blocks and its visible copy buttons.
function runBox(page) {
  const run = element(page, 'run');
  assert.ok(isVisible(run), 'the re-run box (id "run") must be shown when a receipt is shown');
  const shown = [...walkNodes(run)].filter((n) => !n.isText && isVisible(n));
  const lines = visibleLines(run);
  return {
    lines,
    sentences: sentencesOf(lines),
    text: lines.join('\n'),
    blocks: shown.filter((n) => n.tagName === 'PRE').map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
    copyButtons: shown.filter((n) => n.tagName === 'BUTTON' && /copy/i.test(n.textContent)),
  };
}

// Every visible line of the whole page that holds a git clone or checkout: the clone command, wherever it is drawn.
function cloneLines(page) {
  return visibleLines(page.document.body).filter((l) => /git\s+(clone|checkout)\b/.test(l));
}

// The copy button of the box, pressed: the text it puts on the clipboard.
async function copied(page, box) {
  assert.equal(box.copyButtons.length, 1, `the re-run box must show exactly one copy button, it shows ${box.copyButtons.length}`);
  const before = page.clipboard.length;
  await box.copyButtons[0].dispatch('click');
  await settle();
  assert.equal(page.clipboard.length, before + 1, 'the copy button must put one text on the clipboard');
  return page.clipboard[page.clipboard.length - 1].replace(/\s+/g, ' ').trim();
}

// For a receipt of the second or third kind: no clone command anywhere, `necro verify <path>` once, with a copy button.
async function assertLocalOnly(page, receipt, label) {
  assert.deepEqual(cloneLines(page), [], `${label}: the page must not offer a git clone or checkout command`);
  const box = runBox(page);
  assert.deepEqual(
    box.blocks.filter((b) => /^necro\b/.test(b)),
    [localLine(receipt)],
    `${label}: the box must give exactly one command line, ${localLine(receipt)}`,
  );
  assert.equal(await copied(page, box), localLine(receipt), `${label}: its copy button must copy that line`);
  return box;
}

// ---- a local copy of this repository, and the environment to run the page's command in ----

function which(name, searchPath) {
  for (const dir of searchPath.split(':')) {
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      // not in this folder
    }
  }
  return null;
}

function tail(text, n = 3500) {
  return text.length > n ? `...${text.slice(-n)}` : text;
}

// A bare copy of this repository's HEAD with main as its default branch, a folder with only git and node (the PATH has
// no necro), and the environment that sends the project's GitHub address to the copy. `cleanup()` removes it all.
function localClone(receipt) {
  const git = which('git', `${SYSTEM_PATH}:${process.env.PATH ?? ''}`);
  assert.ok(git, 'git is needed to run this contract');
  const sh = which('sh', SYSTEM_PATH);
  assert.ok(sh, 'this machine has no sh');
  assert.ok(fs.existsSync(path.join(ROOT, '.git')), 'this contract copies the repository it runs in, so it needs the .git folder');
  const has = (spec) => spawnSync(git, ['cat-file', '-t', spec], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  assert.equal(has(receipt.gitCommit), 'commit', `the receipt's commit ${receipt.gitCommit} is not in this repository; fetch the full history`);
  assert.equal(
    spawnSync(git, ['cat-file', '-e', `HEAD:${receiptPath(receipt)}`], { cwd: ROOT }).status,
    0,
    `${receiptPath(receipt)} must be committed in this repository's HEAD`,
  );

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-rerun-'));
  const cleanup = () => fs.rmSync(temp, { recursive: true, force: true });
  try {
    const bin = path.join(temp, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(git, path.join(bin, 'git'));
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    const searchPath = `${bin}:${SYSTEM_PATH}`;
    assert.equal(which('necro', searchPath), null, 'the PATH for this contract must hold no necro');

    const mirror = path.join(temp, 'github.git');
    const env = {
      PATH: searchPath,
      HOME: process.env.HOME ?? temp,
      TMPDIR: temp,
      LANG: 'C',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${mirror}.insteadOf`,
      GIT_CONFIG_VALUE_0: PROJECT_URL,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'rerun box',
      GIT_AUTHOR_EMAIL: 'rerun-box@example.invalid',
      GIT_COMMITTER_NAME: 'rerun box',
      GIT_COMMITTER_EMAIL: 'rerun-box@example.invalid',
      ...(process.env.CHROME_PATH ? { CHROME_PATH: process.env.CHROME_PATH } : {}),
    };
    const run = (args, options = {}) => spawnSync(git, args, { encoding: 'utf8', env, ...options });
    for (const args of [['init', '--bare', '-q', mirror], ['-C', mirror, 'fetch', '-q', ROOT, 'HEAD:refs/heads/main'], ['-C', mirror, 'symbolic-ref', 'HEAD', 'refs/heads/main']]) {
      const done = run(args, { cwd: temp });
      assert.equal(done.status, 0, `git ${args.join(' ')} failed: ${done.stderr}`);
    }
    const work = (label) => {
      const dir = path.join(temp, label);
      fs.mkdirSync(dir);
      return dir;
    };
    return { temp, env, run, sh, cleanup, work };
  } catch (error) {
    cleanup();
    throw error;
  }
}

// The steps of a clone command: it is one line of steps joined with " && ".
function stepsOf(command) {
  return command.split(' && ');
}

// ---- the contracts ----

test('R15.1 for a receipt with a valid commit and no uncommitted files the page offers the re-run command, and the command checks the commit out on a named branch, so a clone of the checkout has origin/HEAD', async () => {
  const { text, receipt } = fixture('committed');
  const page = await openPage();
  await showReceipt(page, text);

  // Offered: a clone command in the re-run box, with a copy button that copies it.
  const box = runBox(page);
  const command = box.blocks.find((b) => b.startsWith('git clone '));
  assert.ok(command, `the box must offer the clone command for a receipt that names a valid commit and has no uncommitted files. It shows: ${box.blocks.join(' | ') || 'no code block'}`);
  assert.ok(command.startsWith(`git clone ${PROJECT_URL} necro-check`), 'the command must clone the repository typed in the box');
  assert.ok(command.includes(` ${receipt.gitCommit}`), 'the command must check out the receipt commit');
  assert.ok(command.includes(`necro verify ${receiptPath(receipt)}`), 'the command must run necro verify on the receipt');
  assert.equal(await copied(page, box), command, 'the copy button must copy the command shown');

  // Run the project's part of the command (everything before the verifier is cloned) in sh against the local copy.
  const steps = stepsOf(command);
  const enter = steps.indexOf('cd necro-check');
  const verifier = steps.findIndex((s, i) => i > enter && s.startsWith('git clone '));
  assert.ok(enter > 0 && verifier > enter, `the command must clone the project, enter necro-check and then clone the verifier: ${command}`);
  const local = localClone(receipt);
  try {
    const work = local.work('work');
    const ran = spawnSync(local.sh, ['-c', steps.slice(0, verifier).join(' && ')], { cwd: work, env: local.env, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(ran.status, 0, `the steps that check the commit out must run. Output:\n${tail(ran.stdout + ran.stderr)}`);
    const checkout = path.join(work, 'necro-check');
    const inCheckout = (args) => local.run(args, { cwd: checkout });

    const head = inCheckout(['symbolic-ref', '-q', 'HEAD']);
    assert.equal(head.status, 0, 'the commit must be checked out on a named local branch, not as a detached HEAD');
    assert.match(head.stdout.trim(), /^refs\/heads\/\S+$/, 'HEAD must name a local branch');
    assert.equal(inCheckout(['rev-parse', 'HEAD']).stdout.trim(), receipt.gitCommit, 'the branch must be at the receipt commit');
    assert.ok(fs.existsSync(path.join(checkout, receiptPath(receipt))), `the command must still bring ${receiptPath(receipt)} into the checkout`);

    // What R5.2 does inside the check: clone the checkout and read origin/HEAD.
    const nested = path.join(work, 'nested');
    const cloned = local.run(['clone', '-q', checkout, nested]);
    assert.equal(cloned.status, 0, `a clone of the checkout must work: ${cloned.stderr}`);
    const originHead = local.run(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { cwd: nested });
    assert.equal(originHead.status, 0, 'a clone of the checkout must find origin/HEAD, as a clone of a repository on a branch does');
    assert.equal(local.run(['rev-parse', '--verify', '-q', 'origin/HEAD'], { cwd: nested }).stdout.trim(), receipt.gitCommit, 'origin/HEAD in that clone must be the receipt commit');
  } finally {
    local.cleanup();
  }
});

test('R15.2 for a receipt with uncommitted files the page offers no clone command, says the receipt was written before those files were committed, names them, and gives necro verify with a copy button', async () => {
  const { text, receipt } = fixture('uncommitted');
  const page = await openPage();
  await showReceipt(page, text);

  const box = await assertLocalOnly(page, receipt, 'a receipt with uncommitted files');

  // Plain words: why a clone cannot re-run it, in one sentence.
  const why = box.sentences.find((s) => /written before/i.test(s) && /committed/i.test(s) && /clone/i.test(s));
  assert.ok(why, `the box must say that the receipt was written before some of the files it pins were committed, so a clone cannot re-run it. It says:\n${box.text}`);
  assert.match(box.text, /working copy/i, "the box must say to run the line in the project's own working copy");

  // It names those files, and only those: a committed pinned file is not named.
  for (const file of receipt.uncommitted) assert.ok(box.lines.some((l) => l.includes(file)), `the box must name the uncommitted file ${file}`);
  assert.ok(!box.lines.some((l) => l.includes(receipt.requirements.path)), `the box must not name ${receipt.requirements.path}, which is committed`);

  // Typing another repository changes nothing about it: there is no clone to point anywhere.
  await typeRepo(page, 'octo/spec-repo');
  await assertLocalOnly(page, receipt, 'after the repository box changes');
});

test('R15.3 for a receipt with no commit (the buried sample, a pasted demo receipt) the page offers no clone command, says it can be re-run only in the folder that made it, and gives necro verify with a copy button', async () => {
  for (const name of ['buried', 'pasted']) {
    const { text, receipt } = fixture(name);
    const page = await openPage();
    await showReceipt(page, text);
    const box = await assertLocalOnly(page, receipt, FIXTURE_FILES[name]);
    const why = box.sentences.find((s) => /names no commit/i.test(s) && /\bonly\b/i.test(s) && /folder/i.test(s));
    assert.ok(why, `${FIXTURE_FILES[name]}: the box must say that the receipt names no commit, so it can be re-run only in the folder that made it. It says:\n${box.text}`);
    assert.ok(!box.lines.some((l) => /written before/i.test(l)), `${FIXTURE_FILES[name]}: a receipt with no commit has no uncommitted files to name`);

    // Typing a repository does not bring a clone command back.
    await typeRepo(page, 'octo/spec-repo');
    await assertLocalOnly(page, receipt, `${FIXTURE_FILES[name]} after the repository box changes`);
  }
});

test('R15.4 the page decides between the three from gitCommit and uncommitted alone, with no network request, and the Check files button keeps working', async () => {
  // Only the two fields differ between these receipts. Everything else in them is made up, and the hash is wrong on
  // purpose, so nothing but gitCommit and uncommitted can be what the page decides from. One page shows them in turn, so
  // a line left over from the receipt before would show.
  const cases = [
    ['a valid commit and no uncommitted field', COMMIT_A, undefined, 'clone'],
    ['a valid commit and an empty list', COMMIT_A, [], 'clone'],
    ['a valid commit and a file listed', COMMIT_A, ['src/a.js'], 'local'],
    ['no commit and no uncommitted field', null, undefined, 'local'],
    ['no commit and an empty list', null, [], 'local'],
    ['no commit and a file listed', null, ['src/a.js'], 'local'],
    ['a valid commit, an empty list and a failing contract', COMMIT_A, [], 'clone'],
    ['a valid commit and two files listed in another spec', COMMIT_A, ['src/a.js', 'src/b.js'], 'local'],
  ];
  const page = await openPage();
  const before = page.requested.length;
  for (const [i, [label, gitCommit, uncommitted, kind]] of cases.entries()) {
    const spec = i === cases.length - 1 ? 'other-spec' : 'zombie-spec';
    const receipt = makeReceipt({ gitCommit, uncommitted, spec, result: label.includes('failing') ? 'fail' : 'pass' });
    for (const repo of [REPO, '']) {
      await showReceipt(page, JSON.stringify(receipt), repo);
      if (kind === 'clone') {
        const box = runBox(page);
        const command = box.blocks.find((b) => b.startsWith('git clone '));
        assert.ok(command, `${label}: the box must offer the clone command`);
        assert.ok(command.startsWith(`git clone https://github.com/${repo === '' ? 'OWNER/NAME' : REPO}.git necro-check`), `${label}: the clone command names the repository box`);
        assert.ok(command.includes(` ${COMMIT_A}`) && command.includes(`necro verify ${receiptPath(receipt)}`), `${label}: the command is for this receipt`);
        assert.ok(!box.blocks.some((b) => b === localLine(receipt)), `${label}: a committed receipt gets the clone command, not the local line`);
      } else {
        await assertLocalOnly(page, receipt, `${label} (repository box ${repo === '' ? 'empty' : 'filled'})`);
      }
    }
  }
  assert.equal(page.requested.length, before, `showing receipts must not fetch anything, the page asked for: ${page.requested.slice(before).join(', ')}`);

  // The Check files button keeps working as it does (Requirement 4): nothing is fetched until it is pressed, a file that
  // is not in the commit yet is marked and never requested, and a receipt with no commit is told that the check needs one.
  const answer404 = async () => new Response('not found', { status: 404 });
  for (const name of ['committed', 'uncommitted']) {
    const { text, receipt } = fixture(name);
    const checking = await openPage({ fetchFn: answer404 });
    await showReceipt(checking, text);
    const asked = checking.requested.length;
    await element(checking, 'check').dispatch('click');
    await settle();
    const urls = checking.requested.slice(asked);
    assert.ok(urls.length > 0, `${name}: pressing Check files must fetch the pinned files`);
    for (const url of urls) assert.ok(url.startsWith(`${RAW_PREFIX}${REPO}/${receipt.gitCommit}/`), `${name}: ${url} must be a file at the receipt commit`);
    const rows = element(checking, 'files').children.map((row) => row.textContent);
    for (const file of receipt.uncommitted) {
      assert.ok(!urls.some((u) => decodeURIComponent(u).endsWith(`/${file}`)), `${name}: ${file} is not in the commit and must not be requested`);
      assert.ok(rows.some((r) => r.includes(file) && r.includes('NOT IN THE COMMIT YET')), `${name}: ${file} must be marked as not in the commit yet`);
    }
    if (receipt.uncommitted.length > 0) assert.match(element(checking, 'file-notice').textContent, /not in the commit yet/i, `${name}: the notice about uncommitted files must show`);
    else assert.equal(element(checking, 'file-notice').textContent, '', `${name}: no notice when every file is in the commit`);
  }
  for (const name of ['buried', 'pasted']) {
    const { text } = fixture(name);
    const checking = await openPage({ fetchFn: answer404 });
    await showReceipt(checking, text);
    const asked = checking.requested.length;
    await element(checking, 'check').dispatch('click');
    await settle();
    assert.equal(checking.requested.length, asked, `${name}: a receipt with no commit must not fetch anything`);
    assert.match(element(checking, 'repo-error').textContent, /commit/i, `${name}: the file check must say it needs a commit`);
  }
});

test("R15.5 without the network, the command for a committed receipt reaches CONFIRMED from a clone of this repository, including for a receipt that pins R5.2's contract, and receipts with uncommitted files or no commit get no clone command", async () => {
  // The kinds: the committed fixture is offered a clone command; the other three fixtures are not.
  for (const name of ['committed', 'uncommitted', 'buried', 'pasted']) {
    const { text } = fixture(name);
    const page = await openPage();
    await showReceipt(page, text);
    const offered = cloneLines(page);
    if (name === 'committed') assert.ok(offered.length > 0, `${FIXTURE_FILES[name]} must be offered the clone command`);
    else assert.deepEqual(offered, [], `${FIXTURE_FILES[name]} must not be offered a clone command`);
  }

  // The command the page shows for the committed receipt, pasted into sh with git and node but no necro, against a local
  // copy of this repository. The receipt pins R5.2's contract, which clones the checkout, so this only reaches CONFIRMED
  // when the checkout is on a branch.
  const { text, receipt } = fixture('committed');
  const page = await openPage();
  await showReceipt(page, text);
  const command = runBox(page).blocks.find((b) => b.startsWith('git clone '));
  assert.ok(command, 'the page must offer the clone command for the committed receipt');
  assert.ok(!/[\r\n]/.test(command), 'the command must be one line');

  const local = localClone(receipt);
  try {
    const work = local.work('work');
    const ran = spawnSync(local.sh, ['-c', command], { cwd: work, env: local.env, encoding: 'utf8', timeout: 280_000, maxBuffer: 64 * 1024 * 1024 });
    const output = `${ran.stdout}${ran.stderr}`;
    assert.ok(
      ran.stdout.includes(`CONFIRMED ${receipt.receiptHash}`),
      `the command must print CONFIRMED ${receipt.receiptHash}; it exited ${ran.status}. Output:\n${tail(output)}`,
    );
    assert.equal(ran.status, 0, `the command must exit 0, it exited ${ran.status}. Output:\n${tail(output)}`);
  } finally {
    local.cleanup();
  }
});
