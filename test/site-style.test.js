import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../site/style.css', import.meta.url), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

// The CSP from design.md.
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'";

function tokens() {
  const out = new Map();
  const root = /:root\s*\{([^}]*)\}/g;
  for (const m of bare.matchAll(root)) {
    for (const d of m[1].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
  }
  return out;
}

function rgb(hex) {
  const h = hex.replace('#', '');
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
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The CSS with every @media block removed, braces counted.
function outsideMedia(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf('@media', i);
    if (at < 0) return out + text.slice(i);
    out += text.slice(i, at);
    let depth = 0;
    let j = text.indexOf('{', at);
    do {
      if (text[j] === '{') depth += 1;
      if (text[j] === '}') depth -= 1;
      j += 1;
    } while (j < text.length && depth > 0);
    i = j;
  }
  return out;
}

test('index.html has a lang attribute and the viewport meta tag', () => {
  assert.match(html, /<html[^>]*\blang="en"/);
  assert.match(html, /<meta[^>]*name="viewport"[^>]*content="width=device-width, initial-scale=1"/);
});

test('index.html carries the content security policy from the design', () => {
  const m = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(html);
  assert.ok(m, 'CSP meta tag');
  assert.equal(m[1], CSP);
});

test('index.html has no inline script, no inline style and one module script main.js', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /type="module"/);
  assert.match(scripts[0][1], /src="main\.js"/);
  assert.equal(scripts[0][2].trim(), '');
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'no inline event handlers');
  assert.match(html, /<link[^>]*rel="stylesheet"[^>]*href="style\.css"/);
});

test('index.html says contracts re-run in Node with necro verify and the browser checks hashes, not test runs', () => {
  const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
  assert.match(text, /Contracts re-run in Node with necro verify\./);
  assert.match(text, /The browser checks hashes, not test runs\./);
});

test('index.html has the elements the app fills in, each id once', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of ['paste', 'show', 'file', 'sample', 'error', 'receipt', 'spec', 'commit', 'receipt-hash', 'created', 'task', 'summary', 'groups', 'hash-check', 'hash-badge', 'hash-detail', 'run', 'command', 'copy', 'copy-note', 'command-note', 'file-check', 'repo', 'check', 'repo-error', 'file-notice', 'file-summary', 'files']) {
    assert.ok(ids.includes(id), `missing id ${id}`);
  }
  assert.match(html, /id="error"[^>]*role="alert"/);
  assert.match(html, /id="repo-error"[^>]*role="alert"/);
  assert.match(html, /id="hash-badge"[^>]*aria-live="polite"/);
  assert.match(html, /<label for="paste">/);
  assert.match(html, /<label for="repo">/);
  assert.match(html, /<input type="file" id="file"/);
});

test('index.html labels a passing contract PASS and a failing one FAIL', () => {
  const text = html.replace(/<[^>]*>/g, '');
  assert.match(text, /\bPASS\b/);
  assert.match(text, /\bFAIL\b/);
});

test('style.css tokens meet WCAG AA on the page background and the card surface', () => {
  const t = tokens();
  const bg = t.get('--bg');
  const surface = t.get('--surface');
  assert.match(bg, /^#[0-9a-f]{6}$/i);
  assert.match(surface, /^#[0-9a-f]{6}$/i);
  assert.ok(luminance(rgb(bg)) < 0.1, 'dark page');
  for (const name of ['--text', '--muted', '--alive', '--grave', '--accent', '--link']) {
    const c = t.get(name);
    assert.match(c, /^#[0-9a-f]{6}$/i, name);
    assert.ok(contrast(c, bg) >= 4.5, `${name} on --bg ${contrast(c, bg).toFixed(2)}`);
    assert.ok(contrast(c, surface) >= 4.5, `${name} on --surface ${contrast(c, surface).toFixed(2)}`);
  }
  assert.ok(contrast(t.get('--border'), bg) >= 3, `--border on --bg ${contrast(t.get('--border'), bg).toFixed(2)}`);
  assert.ok(contrast(t.get('--border'), surface) >= 3, `--border on --surface ${contrast(t.get('--border'), surface).toFixed(2)}`);
  assert.ok(contrast('#14101c', t.get('--accent')) >= 4.5, 'button label on accent');
  assert.match(bare, /#14101c/i, 'button label color is the one that was checked');
});

test('style.css lets long strings wrap and has no fixed width above 320px outside media queries', () => {
  assert.match(bare, /overflow-wrap\s*:\s*anywhere/);
  assert.match(bare, /pre\b[^{]*\{[^}]*white-space\s*:\s*pre-wrap/);
  assert.match(bare, /min-width\s*:\s*0/);
  for (const m of outsideMedia(bare).matchAll(/(?<![\w-])(min-width|width)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
    assert.ok(Number(m[2]) <= 320, `${m[0]}`);
  }
});

test('style.css animates the glow only when the user has not asked for reduced motion', () => {
  assert.match(bare, /@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
  const outside = outsideMedia(bare);
  assert.doesNotMatch(outside, /animation\s*:/);
  assert.doesNotMatch(outside, /@keyframes/);
  assert.match(bare, /@media\s*\(prefers-reduced-motion:\s*no-preference\)[\s\S]*animation\s*:/);
});

test('style.css styles a passing contract alive and a failing one as a gravestone, in separate classes', () => {
  assert.match(bare, /\.contract\.pass[^{]*\{[^}]*var\(--alive\)/);
  assert.match(bare, /\.contract\.fail[^{]*\{[^}]*var\(--grave\)/);
  assert.match(bare, /\.contract\.fail[^{]*\{[^}]*border-left\s*:\s*[^;]*(\dpx|\drem)/, 'heavier left border for a failing contract');
  assert.match(bare, /\.contract\.notyet/, 'a failing contract that was not required has its own style');
});

test('style.css has a visible focus ring and a style for the hash verdicts and file statuses', () => {
  assert.match(bare, /:focus-visible\s*\{[^}]*outline/);
  for (const cls of ['.hash-match', '.hash-altered', '.status-match', '.status-different', '.status-uncommitted', '.status-unavailable']) {
    assert.ok(bare.includes(cls), cls);
  }
});

test('style.css has no external resources', () => {
  assert.doesNotMatch(bare, /@import|url\(\s*['"]?https?:/i);
});
