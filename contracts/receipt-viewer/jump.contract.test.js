// Contract for R10.5 of the receipt-viewer spec: above the verdict banner there is one short plain link that jumps to the
// "How it works" section, which sits thousands of pixels down, and the page still passes the frozen R9.5 contract.
//
// This is a draft contract in its own file. The R10.1 to R10.4 contracts are in story.contract.test.js, which is frozen,
// so R10.5 cannot be added there without breaking its pinned hash. A person reviews this file and freezes it with the spec.
//
// Node cannot lay a page out, so this reads site/index.html and site/style.css as text. It also runs the frozen R9.5
// contract on its own, as a separate Node process, and checks that file against the hash the lock pins. How far down the
// section is, and that the link lands it in view, is measured by hand in a headless browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
const HTML = read('site/index.html');
const CSS = read('site/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const ABOVE_FOLD = 'contracts/receipt-viewer/above-fold.contract.test.js';
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'";

const idAt = (id) => {
  const i = HTML.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
};
const words = (fragment) => fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// The tags still open where `index` falls in the HTML.
function openTagsAt(index) {
  const stack = [];
  const voids = new Set(['meta', 'link', 'input', 'br', 'hr', 'img', 'path', 'circle']);
  for (const m of HTML.slice(0, index).matchAll(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
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

test('R10.5 a short plain link above the verdict banner jumps to the How it works section, and the page still passes the frozen R9.5 contract', () => {
  // One plain link to the section, with at most six words, that names where it goes.
  const links = [...HTML.matchAll(/<a\b([^>]*\bhref="#how"[^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 1, 'exactly one link points at #how');
  const [whole, , inner] = links[0];
  assert.doesNotMatch(inner, /</, 'the link text is plain words');
  const text = words(inner);
  const count = text.split(' ').filter(Boolean).length;
  assert.ok(count >= 2 && count <= 6, `"${text}" has ${count} words, the limit is 6`);
  assert.match(text, /how it works/i, 'the link says where it goes');
  assert.doesNotMatch(HTML, /\bonclick=|href="javascript:/i, 'the link needs no script');

  // The target is the section called How it works.
  const target = HTML.lastIndexOf('<section', idAt('how'));
  assert.match(HTML.slice(target, HTML.indexOf('</section>', target)), /<h2[^>]*>\s*How it works\s*<\/h2>/);

  // It sits above the verdict banner, on the page from the first visit: not in the closed paste form, not hidden.
  const at = HTML.indexOf(whole);
  assert.ok(at < idAt('verdict'), 'the link comes before the verdict banner');
  assert.ok(at > HTML.indexOf('<h1'), 'the link comes after the page heading');
  const open = openTagsAt(at);
  assert.ok(open.some((t) => t.tag === 'main'), 'the link is inside main');
  assert.ok(!open.some((t) => t.tag === 'details' || /\bhidden\b/.test(t.attrs)), 'the link is not inside a closed or hidden element');

  // The page reads in the order it is drawn, and the CSS keeps the link in the flow and readable.
  const order = ['brand', 'sample-row', 'open', 'verdict', 'receipt', 'how'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(idAt(order[i - 1]) < idAt(order[i]), `#${order[i - 1]} must come before #${order[i]}`);
  }
  const rules = [...CSS.matchAll(/(?:^|})\s*([^{}@]+){([^{}]*)}/g)].filter((m) => /\.jump\b/.test(m[1]));
  assert.ok(rules.length > 0, 'style.css styles the link');
  for (const m of rules) {
    assert.doesNotMatch(m[2], /position\s*:\s*(fixed|absolute|sticky)/, `${m[1].trim()} takes the link out of the flow`);
    assert.doesNotMatch(m[2], /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0\s*(;|$)|font-size\s*:\s*0(?![\d.])/, `${m[1].trim()} hides the link`);
    assert.doesNotMatch(m[2], /(?:^|[\s;])(?:min-)?width\s*:\s*[\d.]+(?:px|rem|em|vw)/, `${m[1].trim()} sets a fixed width`);
  }
  assert.doesNotMatch(CSS, /(^|[\s;{])order\s*:|(row|column)-reverse|grid-template-areas|grid-area\s*:/, 'no CSS moves the story');

  // Nothing new is loaded for it: the Content Security Policy is the same and there is still one script.
  assert.equal(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(HTML)?.[1], CSP);
  assert.equal((HTML.match(/<script\b/g) || []).length, 1);

  // The frozen R9.5 contract is the file the lock pins, and it passes on its own against this page.
  const lock = JSON.parse(read('.necro/lock.json'));
  const pinned = lock.specs?.['receipt-viewer']?.contracts?.find((c) => c.path === ABOVE_FOLD);
  assert.ok(pinned, 'the lock pins the above-fold contract');
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL(ABOVE_FOLD, ROOT))).digest('hex'), pinned.sha256, 'the above-fold contract is unchanged');
  const run = spawnSync(process.execPath, ['--test', ABOVE_FOLD], { cwd: fileURLToPath(ROOT), encoding: 'utf8' });
  assert.equal(run.status, 0, `the frozen R9.5 contract fails:\n${run.stdout}${run.stderr}`);
});
