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

test('index.html says necro verify re-runs the contracts (Requirement 12.2) and the browser checks hashes, not test runs', () => {
  const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
  assert.match(text, /necro verify re-runs JavaScript contracts and runner contracts \(for example pytest\) alike\./);
  assert.doesNotMatch(text, /re-run in Node/);
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

// ---- Task 16: Kiroween look (8.2, 8.3, 8.4) ----

// Every rule as { selector, body, media }, braces counted. @keyframes come back with selector '@keyframes <name>'.
function cssRules(text) {
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
      if (head.startsWith('@media')) read(inner, head.slice(6).trim());
      else out.push({ selector: head, body: inner, media });
      i = j;
    }
  })(bare, null);
  return out;
}
const rulesFor = (selector) => cssRules(bare).filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector));
const decl = (body, prop) => (new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body) || [])[1]?.trim();

test('index.html draws an inline SVG mark, a gravestone with a checkmark, hidden from screen readers next to the title', () => {
  const svg = /<svg\b[^>]*class="mark"[^>]*>([\s\S]*?)<\/svg>/.exec(html);
  assert.ok(svg, 'an inline <svg class="mark">');
  assert.match(svg[0], /aria-hidden="true"/);
  assert.match(svg[1], /class="mark-stone"/, 'the gravestone shape');
  assert.match(svg[1], /class="mark-check"/, 'the checkmark shape');
  assert.doesNotMatch(svg[0], /<(animate|animateTransform|animateMotion|set|image|use)\b/);
  assert.match(html, /<h1\b/);
});

test('index.html and style.css load nothing external: no images, fonts, imports or remote URLs', () => {
  assert.doesNotMatch(html, /<(img|picture|object|embed|iframe)\b/i);
  for (const m of html.matchAll(/<(\w+)\b[^>]*\s(?:src|href)="([^"]*)"/g)) {
    if (m[1] === 'a') continue;
    // The one other thing a <link> may name is the inline favicon, which is data and loads nothing (Req 11.5).
    if (m[1] === 'link' && /^data:image\/svg\+xml,/.test(m[2])) continue;
    assert.ok(['style.css', 'main.js'].includes(m[2]), `<${m[1]}> loads ${m[2]}`);
  }
  assert.doesNotMatch(bare, /@import|@font-face|url\(/i);
});

test('style.css uses system font stacks only', () => {
  for (const name of ['--font-body', '--font-display', '--font-mono']) {
    const value = tokens().get(name);
    assert.ok(value, name);
    assert.match(value, /\b(sans-serif|serif|monospace)$/, `${name} ends in a generic family`);
  }
  assert.match(tokens().get('--font-body'), /^system-ui\b/);
  assert.match(tokens().get('--font-mono'), /^ui-monospace\b/);
});

test('every @keyframes and every animation sits inside prefers-reduced-motion: no-preference', () => {
  const noPreference = /\(prefers-reduced-motion:\s*no-preference\)/;
  const all = cssRules(bare);
  assert.ok(all.some((r) => r.selector.startsWith('@keyframes')), 'there is motion to switch off');
  for (const r of all) {
    if (r.media !== null && noPreference.test(r.media)) continue;
    assert.ok(!r.selector.startsWith('@keyframes'), `${r.selector} outside no-preference`);
    const a = decl(r.body, 'animation') || decl(r.body, 'animation-name');
    assert.ok(!a || /^none\b/.test(a), `${r.selector} animates outside no-preference`);
    const t = decl(r.body, 'transition');
    assert.ok(!t || /^none\b/.test(t), `${r.selector} has a transition outside no-preference`);
  }
});

test('prefers-reduced-motion: reduce switches every animation and transition off, pseudo-elements included', () => {
  const reduce = cssRules(bare).filter((r) => r.media !== null && /\(prefers-reduced-motion:\s*reduce\)/.test(r.media));
  const off = reduce.find((r) => ['*', '*::before', '*::after'].every((s) => r.selector.split(',').map((x) => x.trim()).includes(s)));
  assert.ok(off, 'a reduce rule for *, *::before, *::after');
  assert.match(decl(off.body, 'animation'), /^none\s*!important$/);
  assert.match(decl(off.body, 'transition'), /^none\s*!important$/);
});

test('a slow fog layer drifts behind the page, decorative and out of the way', () => {
  assert.match(html, /<div class="fog" aria-hidden="true"><\/div>/);
  const fog = rulesFor('.fog');
  assert.ok(fog.some((r) => decl(r.body, 'pointer-events') === 'none'));
  assert.ok(fog.some((r) => decl(r.body, 'position') === 'fixed'));
  const drift = cssRules(bare).filter((r) => /^\.fog::(before|after)$/.test(r.selector) && /no-preference/.test(r.media || ''));
  assert.ok(drift.length > 0, 'the fog drifts only when motion is welcome');
  for (const r of drift) {
    const seconds = Number((/(\d+(?:\.\d+)?)s\b/.exec(decl(r.body, 'animation')) || [])[1]);
    assert.ok(seconds >= 40, `${r.selector} drifts slowly (${seconds}s)`);
  }
  // Fog is light on light text only if it stays faint: no alpha above 0.12 in the fog layers.
  for (const r of cssRules(bare).filter((x) => /^\.fog/.test(x.selector))) {
    for (const m of r.body.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)) assert.ok(Number(m[1]) <= 0.12, `${r.selector} alpha ${m[1]}`);
  }
});

test('a failing row is an arched gravestone and a passing row glows alive, drawn with CSS and no generated text', () => {
  const fail = rulesFor('.contract.fail').map((r) => r.body).join(';');
  const radius = decl(fail, 'border-radius');
  assert.ok(radius, '.contract.fail sets a border-radius');
  const [top1, top2, bottom1, bottom2] = radius.split('/')[0].trim().split(/\s+/).map((v) => parseFloat(v));
  assert.ok(Math.min(top1, top2) > Math.max(bottom1, bottom2), `arched top: ${radius}`);
  assert.match(radius, /%/, 'the arch follows the row width');

  const pass = rulesFor('.contract.pass').map((r) => r.body).join(';');
  assert.match(decl(pass, 'box-shadow') || '', /var\(--alive\)/, 'a passing row glows in --alive');
  assert.doesNotMatch(decl(pass, 'border-radius') || '0', /%/, 'a passing row is not a gravestone');

  for (const r of cssRules(bare).filter((x) => /\.contract/.test(x.selector))) {
    const content = decl(r.body, 'content');
    if (content) assert.match(content, /^""$/, `${r.selector} content must be empty`);
  }
});

test('passing rows rise into place and failing rows stay still', () => {
  const motion = cssRules(bare).filter((r) => /no-preference/.test(r.media || ''));
  assert.ok(motion.some((r) => r.selector === '.contract.pass' && /\brise\b/.test(decl(r.body, 'animation') || '')));
  assert.ok(!motion.some((r) => /\.contract\.fail\b/.test(r.selector) && decl(r.body, 'animation')));
  assert.ok(motion.some((r) => r.selector === '@keyframes rise'));
});

test('the verdict banner has a style for Risen and for Still buried', () => {
  assert.ok(rulesFor('.verdict').length > 0);
  assert.match(rulesFor('.verdict.risen').map((r) => r.body).join(';'), /var\(--alive\)/);
  assert.match(rulesFor('.verdict.buried').map((r) => r.body).join(';'), /var\(--grave\)/);
});

test('every text token keeps AA on the gravestone color too', () => {
  const t = tokens();
  const stone = t.get('--stone');
  assert.match(stone, /^#[0-9a-f]{6}$/i);
  for (const name of ['--text', '--muted', '--alive', '--grave', '--accent', '--link']) {
    assert.ok(contrast(t.get(name), stone) >= 4.5, `${name} on --stone ${contrast(t.get(name), stone).toFixed(2)}`);
  }
  assert.ok(contrast(t.get('--border'), stone) >= 3, '--border on --stone');
});

// ---- Task 17: first visit (9.3, 9.4) ----

test('9.4 the root element paints the whole background once, fixed to the window, so a tall page has no seam', () => {
  const root = rulesFor('html').map((r) => r.body).join(';');
  assert.match(decl(root, 'background-color') || '', /^var\(--bg\)$/, 'html has the page color');
  assert.match(decl(root, 'background-image') || '', /radial-gradient/, 'html paints the moon glow');
  assert.equal(decl(root, 'background-attachment'), 'fixed');
  assert.equal(decl(root, 'background-repeat'), 'no-repeat');
  assert.match(decl(root, 'min-height') || '', /^100%$/, 'html is at least as tall as the window');

  // The body paints nothing of its own, so no second background can end partway down the page.
  const body = rulesFor('body').map((r) => r.body).join(';');
  assert.doesNotMatch(decl(body, 'background') || 'none', /var\(--bg\)|#/);
  assert.doesNotMatch(decl(body, 'background-color') || 'transparent', /var\(--bg\)|#/);
});

test('9.4 the fog layers fill the fixed layer and fade out before every edge, so no blob is cut off into a band', () => {
  const fog = rulesFor('.fog').map((r) => r.body).join(';');
  assert.equal(decl(fog, 'position'), 'fixed');
  assert.equal(decl(fog, 'inset'), '0');
  assert.equal(decl(fog, 'background'), undefined, 'the glow moved to the root element');
  for (const sel of ['.fog::before', '.fog::after']) {
    const body = cssRules(bare)
      .filter((r) => r.selector.split(',').map((s) => s.trim()).includes(sel) && r.media === null)
      .map((r) => r.body)
      .join(';');
    assert.equal(decl(body, 'top'), '0', `${sel} starts at the top`);
    assert.equal(decl(body, 'bottom'), '0', `${sel} ends at the bottom`);
    assert.equal(decl(body, 'height'), undefined, `${sel} has no height that could leave a gap`);
    const gradients = body.match(/radial-gradient\([^)]*\)/g) || [];
    assert.ok(gradients.length > 0, `${sel} paints fog`);
    for (const g of gradients) assert.match(g, /closest-side/, `${sel}: ${g} fades to nothing inside the layer`);
  }
});

test('9.3 smooth scrolling is only on under no-preference, and the banner leaves room above it', () => {
  const all = cssRules(bare);
  for (const r of all) {
    const v = decl(r.body, 'scroll-behavior');
    if (v === undefined || /^auto\b/.test(v)) continue;
    assert.match(r.media || '', /\(prefers-reduced-motion:\s*no-preference\)/, `${r.selector} sets scroll-behavior: ${v} outside no-preference`);
  }
  assert.ok(
    all.some((r) => /no-preference/.test(r.media || '') && r.selector.split(',').map((s) => s.trim()).includes('html') && decl(r.body, 'scroll-behavior') === 'smooth'),
    'html scrolls smoothly when motion is welcome',
  );
  assert.ok(rulesFor('.verdict').some((r) => decl(r.body, 'scroll-margin-top')), 'scroll-margin-top on the banner');
});

test('5.3 the run section warns that verifying runs the project\'s own contracts and names where the verifier comes from', () => {
  const run = html.slice(html.indexOf('id="run"'), html.indexOf('id="file-check"'));
  const text = run.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /runs the project's own contracts, which is code from that repository/);
  assert.match(text, /only for a repository you are willing to run/);
  assert.match(text, /vijaygopalbalasa\/contract-necromancer/);
  assert.match(text, /fixed commit/);
  assert.match(text, /never from the repository being verified/);
  assert.doesNotMatch(text, /node bin\/necro\.js/, 'the page no longer says the verified repository supplies bin/necro.js');
});
