// Contract for site/index.html and site/style.css: R6.1 of the receipt-viewer spec.
//
// Both files are read as text and checked statically. The test cannot lay the page out, so it cannot prove there is
// no horizontal scrolling at phone width; it checks the CSS rules that cause sideways scrolling when they are
// missing. See contracts/receipt-viewer/README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const HTML_URL = new URL('../../site/index.html', import.meta.url);
const CSS_URL = new URL('../../site/style.css', import.meta.url);

// ---- small CSS helpers, kept in this file so the contract does not depend on any unfrozen file ----

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Every `selector { declarations }` pair. A rule inside @media is returned with its own selector, because the
// pattern only matches braces that hold no further braces.
function rules(css) {
  const out = [];
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

// The CSS text with every `@media ... { ... }` block removed, braces counted so nested rules go with it.
function withoutMediaBlocks(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at < 0) return out + css.slice(i);
    out += css.slice(i, at);
    const open = css.indexOf('{', at);
    if (open < 0) return out;
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    i = j;
  }
  return out;
}

function declarations(body) {
  const out = new Map();
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return out;
}

function rootTokens(css) {
  const tokens = new Map();
  for (const r of rules(css)) {
    if (!r.selector.split(',').some((s) => s.trim() === ':root')) continue;
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
    for (const r of rules(css)) {
      if (!r.selector.split(',').some((s) => s.trim() === wanted)) continue;
      const d = declarations(r.body);
      for (const prop of ['background-color', 'background']) {
        const color = colorOf(d.get(prop), tokens);
        if (color) return color;
      }
    }
  }
  return null;
}

test('R6.1 dark theme with AA contrast, alive and gravestone contract styles, and a layout that can wrap at phone width', () => {
  const html = fs.readFileSync(HTML_URL, 'utf8');
  const css = fs.readFileSync(CSS_URL, 'utf8');
  const tokens = rootTokens(css);

  // Phone width: the viewport meta tag, so a phone does not render a wide desktop page and zoom out.
  const viewport = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((m) => m[0])
    .find((tag) => /name\s*=\s*["']viewport["']/i.test(tag));
  assert.ok(viewport, 'index.html needs a viewport meta tag');
  assert.match(viewport, /width\s*=\s*device-width/i);

  // Dark theme: a dark page background and light text.
  const background = pageBackground(css, tokens);
  assert.ok(background, 'style.css needs a hex background color on body, html or :root (directly or through a --token)');
  assert.ok(luminance(background) < 0.1, 'the page background must be dark');
  const text = colorOf('var(--text)', tokens);
  assert.ok(text, 'style.css needs a --text color token on :root');
  assert.ok(luminance(text) > 0.5, 'the body text must be light');

  // WCAG AA: 4.5:1 for text colors on the page background, 3:1 for the border (a UI boundary).
  for (const name of ['--text', '--muted', '--alive', '--grave', '--accent', '--link']) {
    const color = colorOf(`var(${name})`, tokens);
    assert.ok(color, `style.css needs a hex ${name} token on :root`);
    const ratio = contrast(color, background);
    assert.ok(ratio >= 4.5, `${name} has contrast ${ratio.toFixed(2)}:1 on the page background, AA needs 4.5:1`);
  }
  const border = colorOf('var(--border)', tokens);
  assert.ok(border, 'style.css needs a hex --border token on :root');
  assert.ok(contrast(border, background) >= 3, `--border has contrast ${contrast(border, background).toFixed(2)}:1, AA needs 3:1`);

  // Card surfaces too, when the stylesheet names one.
  for (const surfaceName of ['--surface', '--card', '--panel']) {
    const surface = colorOf(`var(${surfaceName})`, tokens);
    if (!surface) continue;
    for (const name of ['--text', '--muted', '--alive', '--grave', '--accent', '--link']) {
      const ratio = contrast(colorOf(`var(${name})`, tokens), surface);
      assert.ok(ratio >= 4.5, `${name} has contrast ${ratio.toFixed(2)}:1 on ${surfaceName}, AA needs 4.5:1`);
    }
    assert.ok(contrast(border, surface) >= 3, `--border has less than 3:1 on ${surfaceName}`);
  }

  // A passing contract is styled alive and a failing one as a gravestone: separate rules that use the two colors.
  const outsideRoot = rules(css).filter((r) => !r.selector.split(',').some((s) => s.trim() === ':root'));
  const alive = outsideRoot.filter((r) => /var\(\s*--alive\s*\)/.test(r.body));
  const grave = outsideRoot.filter((r) => /var\(\s*--grave\s*\)/.test(r.body));
  assert.ok(alive.length > 0, 'a rule must use var(--alive) for passing contracts');
  assert.ok(grave.length > 0, 'a rule must use var(--grave) for failing contracts');
  const aliveSelectors = new Set(alive.map((r) => r.selector));
  assert.ok(
    grave.some((r) => !aliveSelectors.has(r.selector)),
    'passing and failing contracts need different selectors',
  );

  // Long unbroken strings (hashes, paths, the command) must be able to wrap, and preformatted text must wrap too.
  const bare = stripComments(css);
  assert.match(bare, /overflow-wrap\s*:\s*anywhere/, 'style.css needs overflow-wrap: anywhere');
  const pre = rules(css).filter((r) => r.selector.split(',').some((s) => /(^|[\s>+~])pre\b/.test(s.trim())));
  assert.ok(pre.length > 0, 'style.css needs a rule for pre');
  assert.ok(
    pre.some((r) => /white-space\s*:\s*(pre-wrap|pre-line|break-spaces|normal)/.test(r.body)),
    'pre must wrap (white-space: pre-wrap)',
  );

  // No fixed width wider than a small phone (320 px) in rules that apply at every screen size. Rules inside
  // @media blocks are left out: they apply only when the screen matches the query.
  for (const m of withoutMediaBlocks(bare).matchAll(/(?<![\w-])(min-width|width)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
    assert.ok(Number(m[2]) <= 320, `${m[1]}: ${m[2]}px is wider than a 320 px phone`);
  }
});
