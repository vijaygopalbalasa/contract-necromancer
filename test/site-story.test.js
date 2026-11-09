import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDom } from './fixtures/fake-dom.js';
import { start } from '../site/app.js';

// Requirement 10: the story in one glance. The page heading says the idea, a "How it works" section sits right after the
// receipt card, and the demo command can be copied. Node cannot lay the page out, so these tests read the files as text
// and drive app.js with the small fake DOM. Task 18's frozen contract (above-fold) is run unchanged.

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('site/index.html');
const css = read('site/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

const IDEA = 'Kiro cannot call a task done until its frozen contracts pass.';
const DEMO = 'npx -y github:vijaygopalbalasa/contract-necromancer demo';
const VIDEO = 'https://youtu.be/TYrSyhIYqlk';
const REPO = 'https://github.com/vijaygopalbalasa/contract-necromancer';
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'";

const idAt = (id) => {
  const i = html.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
};
// The <section> that carries this id, from its opening tag to its closing tag (sections do not nest here).
function section(id) {
  const start = html.lastIndexOf('<section', idAt(id));
  const end = html.indexOf('</section>', start);
  assert.ok(start >= 0 && end > start, `no <section id="${id}">`);
  return { start, end: end + '</section>'.length, text: html.slice(start, end + '</section>'.length) };
}
const textOf = (fragment) => fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// ---- R10.1 ----

test('R10.1 the page heading is the one-sentence idea and sits above the sample bar', () => {
  const h1s = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) || [];
  assert.equal(h1s.length, 1, 'one page heading');
  assert.equal(textOf(h1s[0]), IDEA);
  assert.ok(html.indexOf('<h1') < idAt('sample-note'), 'the heading comes before the sample bar');
  assert.ok(html.indexOf('<h1') < idAt('sample-row'));
  assert.ok(idAt('brand') < html.indexOf('<h1') && html.indexOf('<h1') < idAt('start'), 'the heading is in the header');
});

test('R10.1 the frozen above-fold contract still passes, unchanged', () => {
  const run = spawnSync(process.execPath, ['--test', 'contracts/receipt-viewer/above-fold.contract.test.js'], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const changed = spawnSync('git', ['status', '--porcelain', '--', 'contracts/receipt-viewer/above-fold.contract.test.js'], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  });
  assert.equal(changed.stdout.trim(), '', 'the frozen file has no local change');
});

// ---- R10.2 ----

test('R10.2 a "How it works" section follows the receipt card directly, with three numbered steps', () => {
  const receipt = section('receipt');
  const how = section('how');
  assert.equal(html.slice(receipt.end, how.start).trim(), '', 'nothing stands between the receipt card and the section');
  assert.match(how.text, /<h2[^>]*>\s*How it works\s*<\/h2>/);
  const list = /<ol\b[^>]*>([\s\S]*?)<\/ol>/.exec(how.text);
  assert.ok(list, 'the steps are an ordered list');
  const steps = [...list[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
  assert.equal(steps.length, 3);
  assert.match(steps[0], /person/i);
  assert.match(steps[0], /freezes/i);
  assert.match(steps[0], /contracts/i);
  assert.match(steps[1], /gate/i);
  assert.match(steps[1], /refuses/i);
  assert.match(steps[1], /pass/i);
  assert.match(steps[2], /receipt/i);
  assert.match(steps[2], /re-run/i);
});

test('R10.2 the demo command is in a code block with a copy button, and one line names what it needs and shows', () => {
  const how = section('how').text;
  const block = /<pre\b[^>]*>\s*<code\b[^>]*\bid="demo-command"[^>]*>([^<]*)<\/code>\s*<\/pre>/.exec(how);
  assert.ok(block, 'the command is a <pre><code id="demo-command"> block');
  assert.equal(block[1].trim(), DEMO);
  // The first <pre> that has an id must stay the re-run command: frozen contracts look for it by tag. So the demo block
  // is the code element that carries the id, not the pre.
  assert.doesNotMatch(/<pre\b[^>]*>/.exec(how)[0], /\bid=/);
  assert.match(how, /<button\b[^>]*\bid="demo-copy"[^>]*>[^<]*copy[^<]*<\/button>/i);
  assert.match(how, /id="demo-copy-note"/);
  const line = textOf(how);
  assert.match(line, /Needs Node\.js 24 and git, and shows the gate refuse a planted bug, accept the fix and re-check the receipt\./);
});

test('R10.2 the copy button writes the demo command to the clipboard, and says what to do when the clipboard is refused', async () => {
  for (const refuse of [false, true]) {
    const dom = createDom();
    dom.el('paste').value = '{}'; // like a restored form: the page loads no sample
    dom.el('demo-command').textContent = DEMO;
    const written = [];
    const clipboard = {
      writeText: async (text) => {
        if (refuse) throw new Error('denied');
        written.push(text);
      },
    };
    await start({
      document: dom.document,
      location: { search: '', href: 'https://example.test/' },
      fetch: async () => new Response('no', { status: 404 }),
      navigator: { clipboard },
    });
    await dom.el('demo-copy').dispatch('click');
    if (refuse) {
      assert.deepEqual(written, []);
      assert.equal(dom.el('demo-copy-note').textContent, 'Select the command and copy it.');
    } else {
      assert.deepEqual(written, [DEMO]);
      assert.equal(dom.el('demo-copy-note').textContent, 'Copied.');
    }
    assert.equal(dom.el('copy-note').textContent, '', 'the other copy button is not touched');
  }
});

// ---- R10.3 ----

test('R10.3 the video and the repository are plain links in the section, and the page loads nothing new', () => {
  const how = section('how').text;
  const links = [...how.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], text: textOf(m[2]) }));
  const hrefs = links.map((l) => /\bhref="([^"]*)"/.exec(l.attrs)?.[1]);
  assert.deepEqual(hrefs.sort(), [REPO, VIDEO].sort());
  for (const l of links) assert.ok(l.text.length > 0 && !/<|>/.test(l.text), 'each link has plain words');
  assert.match(how, /<a\b[^>]*href="https:\/\/youtu\.be\/TYrSyhIYqlk"[^>]*>[^<]*video[^<]*<\/a>/i);
  assert.match(how, /<a\b[^>]*href="https:\/\/github\.com\/vijaygopalbalasa\/contract-necromancer"[^>]*>[^<]*<\/a>/);
  // Nothing is embedded or loaded: no frame, media, object, image, extra script or extra style sheet.
  assert.doesNotMatch(html, /<(iframe|video|audio|embed|object|img|source|picture|style)\b/i);
  assert.equal((html.match(/<script\b/g) || []).length, 1);
  assert.equal((html.match(/<link\b/g) || []).length, 1);
});

test('R10.3 the Content Security Policy is byte for byte the one the design gives', () => {
  const csp = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(html);
  assert.ok(csp);
  assert.equal(csp[1], CSP);
});

// ---- R10.4 ----

test('R10.4 the title starts with "Contract Necromancer" and the story reads in the order it is drawn', () => {
  assert.match(html, /<title>Contract Necromancer\b[^<]*<\/title>/);
  const order = ['brand', 'sample-row', 'open', 'verdict', 'receipt', 'how', 'hash-check', 'run', 'file-check', 'about'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(idAt(order[i - 1]) < idAt(order[i]), `#${order[i - 1]} must come before #${order[i]}`);
  }
  // No CSS moves anything away from its place in the document.
  assert.doesNotMatch(css, /(^|[\s;{])order\s*:/, 'no flex or grid order');
  assert.doesNotMatch(css, /(row|column)-reverse/);
  assert.doesNotMatch(css, /grid-template-areas|grid-area\s*:/);
  assert.doesNotMatch(css, /direction\s*:\s*rtl/);
});

test('R10.4 the section can wrap at phone width: no fixed widths, and the command block wraps', () => {
  assert.match(html, /<meta[^>]*name="viewport"/);
  const rules = [...css.matchAll(/(?:^|})\s*([^{}@]+){([^{}]*)}/g)].filter((m) => /\.(how|steps|demo|story)\b|#how\b/.test(m[1]));
  assert.ok(rules.length > 0, 'style.css styles the section');
  for (const m of rules) {
    assert.doesNotMatch(m[2], /(?:^|[\s;])(?:min-)?width\s*:\s*[\d.]+(?:px|rem|em|vw)/, `${m[1].trim()} sets a fixed width`);
    assert.doesNotMatch(m[2], /white-space\s*:\s*(?:pre|nowrap)\s*(?:;|$)/, `${m[1].trim()} stops wrapping`);
  }
  assert.match(css, /pre\s*{[^}]*white-space:\s*pre-wrap/);
});

// ---- R10.5 ----
// A short link above the verdict banner jumps to "How it works", which sits far below the contract rows.

// The tags that are open (opened and not yet closed) where `index` falls in the HTML.
function openTagsAt(index) {
  const stack = [];
  const voids = new Set(['meta', 'link', 'input', 'br', 'hr', 'img', 'path', 'circle']);
  for (const m of html.slice(0, index).matchAll(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const [whole, closing, tag, attrs] = m;
    if (closing) {
      const at = stack.map((t) => t.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
    } else if (!voids.has(tag) && !whole.endsWith('/>')) {
      stack.push({ tag, attrs });
    }
  }
  return stack;
}

test('R10.5 a plain link of at most six words, above the verdict banner, points at the How it works section', () => {
  const links = [...html.matchAll(/<a\b([^>]*\bhref="#how"[^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 1, 'exactly one link to #how');
  const [whole, attrs, inner] = links[0];
  assert.match(attrs, /\bid="jump-how"/);
  assert.doesNotMatch(inner, /</, 'the link text is plain words');
  const text = textOf(inner);
  const words = text.split(' ').filter(Boolean);
  assert.ok(words.length >= 2 && words.length <= 6, `"${text}" has ${words.length} words, the limit is 6`);
  assert.match(text, /how it works/i, 'the link says where it goes');
  assert.equal(section('how').text.includes('id="how"'), true, 'the target section carries id="how"');
  const at = html.indexOf(whole);
  assert.ok(at < idAt('verdict'), 'the link comes before the verdict banner');
});

test('R10.5 the link is visible on a first visit: after the heading and the sample bar, outside the closed paste form and any hidden section', () => {
  const at = html.indexOf('id="jump-how"');
  assert.ok(at > html.indexOf('<h1'), 'after the page heading');
  assert.ok(at > idAt('sample-row'), 'after the sample buttons');
  assert.ok(at > idAt('open'), 'after the way to open your own receipt, so the page reads in the order it is drawn');
  assert.ok(at < idAt('verdict'));
  const open = openTagsAt(at);
  assert.ok(!open.some((t) => t.tag === 'details' || t.tag === 'summary'), 'not inside the collapsed details');
  assert.ok(!open.some((t) => /\bhidden\b/.test(t.attrs)), 'not inside a hidden element');
  assert.ok(!open.some((t) => /\bid="(verdict|receipt|how)"/.test(t.attrs)), 'not inside the banner, the card or the target');
  assert.ok(open.some((t) => t.tag === 'main'), 'inside main');
});

test('R10.5 the link works without JavaScript and nothing new is loaded for it', () => {
  assert.match(html, /<a\b[^>]*\bid="jump-how"[^>]*\bhref="#how"|<a\b[^>]*\bhref="#how"[^>]*\bid="jump-how"/);
  assert.doesNotMatch(html, /\bonclick=|href="javascript:/i);
  assert.equal((html.match(/<script\b/g) || []).length, 1);
  const csp = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(html);
  assert.equal(csp[1], CSP);
  // app.js has no code for it: the browser follows the anchor by itself.
  assert.doesNotMatch(read('site/app.js'), /jump-how/);
});

test('R10.5 the reading order is the drawn order and the link stays in the flow, readable and not moved by CSS', () => {
  const order = ['brand', 'sample-row', 'open', 'jump-how', 'verdict', 'receipt', 'how'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(idAt(order[i - 1]) < idAt(order[i]), `#${order[i - 1]} must come before #${order[i]}`);
  }
  const rules = [...css.matchAll(/(?:^|})\s*([^{}@]+){([^{}]*)}/g)].filter((m) => /\.jump\b|#jump-how\b/.test(m[1]));
  assert.ok(rules.length > 0, 'style.css styles the link');
  for (const m of rules) {
    assert.doesNotMatch(m[2], /position\s*:\s*(fixed|absolute|sticky)/, `${m[1].trim()} takes the link out of the flow`);
    assert.doesNotMatch(m[2], /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0\s*(;|$)|clip|font-size\s*:\s*0(?![\d.])/, `${m[1].trim()} hides the link`);
    assert.doesNotMatch(m[2], /(?:^|[\s;])(?:min-)?width\s*:\s*[\d.]+(?:px|rem|em|vw)/, `${m[1].trim()} sets a fixed width`);
    assert.doesNotMatch(m[2], /white-space\s*:\s*nowrap/, `${m[1].trim()} stops wrapping`);
    assert.ok(!/(^|;)\s*font-size\s*:\s*0?\.[0-7]\d*rem/.test(m[2]), `${m[1].trim()} makes the text too small`);
  }
});

test('R10.5 the target is not hidden under anything when the link is followed: it has a scroll margin', () => {
  const rule = [...css.matchAll(/(?:^|})\s*([^{}@]+){([^{}]*)}/g)].find((m) => m[1].split(',').some((s) => s.trim() === '#how' || s.trim() === '.how'));
  assert.ok(rule && /scroll-margin-top\s*:\s*[\d.]+rem/.test(rule[2]), 'the How it works section sets scroll-margin-top');
});

test('R10.5 the frozen above-fold contract still passes, unchanged, with the link in the page', () => {
  const run = spawnSync(process.execPath, ['--test', 'contracts/receipt-viewer/above-fold.contract.test.js'], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const lock = JSON.parse(read('.necro/lock.json'));
  const pinned = lock.specs['receipt-viewer'].contracts.find((c) => c.path === 'contracts/receipt-viewer/above-fold.contract.test.js');
  const sha = spawnSync('shasum', ['-a', '256', 'contracts/receipt-viewer/above-fold.contract.test.js'], { cwd: fileURLToPath(root), encoding: 'utf8' });
  assert.equal(sha.stdout.split(' ')[0], pinned.sha256, 'the file is byte for byte the frozen one');
});
