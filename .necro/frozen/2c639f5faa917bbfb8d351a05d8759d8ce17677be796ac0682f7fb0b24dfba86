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
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';


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

const ROOT = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
const HTML = read('site/index.html');
const CSS = read('site/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const ABOVE_FOLD = 'contracts/receipt-viewer/above-fold-v2.contract.test.js';
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

test('R10.5 a short plain link above the verdict banner jumps to the How it works section, and the page still passes the frozen R9.5 contract', { skip: NO_BROWSER }, () => {
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
  // Revised Nov 16 (16.2): How it works now follows the play, so the link in the sample bar jumps up to it.
  const order = ['brand', 'play', 'how', 'sample-row', 'open', 'verdict', 'receipt'];
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

  // The R9.5 contract (as revised Nov 16) is a file the lock pins, and it equals its pin. necro freeze re-pins every contract
  // file of the spec, so this comparison passes from the freeze on. Until a person freezes receipt-viewer again it is EXPECTED
  // to fail, because above-fold-v2 was revised on Nov 16: that is the review step, not a bug. Do not drop it. Then it passes
  // on its own against this page, run as a child, which starts a browser (this test skips when there is none).
  const lock = JSON.parse(read('.necro/lock.json'));
  const pinned = lock.specs?.['receipt-viewer']?.contracts?.find((c) => c.path === ABOVE_FOLD);
  assert.ok(pinned, 'the lock pins the above-fold contract');
  assert.equal(
    createHash('sha256').update(fs.readFileSync(new URL(ABOVE_FOLD, ROOT))).digest('hex'),
    pinned.sha256,
    `${ABOVE_FOLD} is not the file the lock pins; a person freezes receipt-viewer again after reviewing it`,
  );
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  const run = spawnSync(process.execPath, ['--test', ABOVE_FOLD], { cwd: fileURLToPath(ROOT), encoding: 'utf8', env });
  assert.equal(run.status, 0, `the frozen R9.5 contract fails:\n${run.stdout}${run.stderr}`);
});
