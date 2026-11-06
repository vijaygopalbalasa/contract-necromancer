// Frozen contract: planner, Requirement 4 (the page).
// One test per acceptance criterion. Page behaviour is checked through the view-model function
// (src/page.js) and by reading the files in site/ as text, because there is no browser here.
// Expected to fail until src/ and site/ exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSite = (name) => readFile(new URL(`../../site/${name}`, import.meta.url), 'utf8');

const EXAMPLE = '?date=2026-10-31&time=20:00&zone=America/New_York&guests=Europe/London,Asia/Kolkata';

test('R4.1 shows the party start for every guest in the link, using the same src/ functions as the tests', async () => {
  // from '../../src/page.js'
  const { buildView } = await import('../../src/page.js');
  // from '../../src/resolve.js'
  const { resolveLocal } = await import('../../src/resolve.js');
  // from '../../src/guests.js'
  const { planGuests } = await import('../../src/guests.js');

  // buildView takes the link and nothing else: it must not touch location, window or document.
  const trap = (name) => Object.defineProperty(globalThis, name, {
    configurable: true,
    get() { throw new Error(`buildView read the global "${name}"`); },
  });
  for (const name of ['location', 'window', 'document']) trap(name);
  let view;
  try {
    view = buildView(EXAMPLE);
  } finally {
    for (const name of ['location', 'window', 'document']) delete globalThis[name];
  }

  assert.equal(view.status, 'ok');
  assert.deepEqual(view.host, { date: '2026-10-31', time: '20:00', offset: '-04:00', zone: 'America/New_York' });
  assert.equal(view.rows.length, 2, 'one row per guest in the link');
  assert.deepEqual(
    view.rows.map((r) => [r.zone, r.date, r.time, r.offset, r.dayLabel]),
    [
      ['Europe/London', '2026-11-01', '00:00', '+00:00', 'the day after'],
      ['Asia/Kolkata', '2026-11-01', '05:30', '+05:30', 'the day after'],
    ],
  );

  // The page rows are exactly what the src/ functions give for the same link.
  const start = resolveLocal({ date: '2026-10-31', time: '20:00', zone: 'America/New_York' });
  assert.equal(start.ms, Date.UTC(2026, 10, 1, 0, 0));
  const plan = planGuests(start.ms, 'America/New_York', ['Europe/London', 'Asia/Kolkata']);
  assert.equal(view.rows.length, plan.rows.length);
  view.rows.forEach((row, i) => {
    for (const key of ['zone', 'date', 'time', 'offset', 'dayLabel', 'deadOfNight']) {
      assert.equal(row[key], plan.rows[i][key], `row ${i} ${key}`);
    }
  });

  // Guests are comma separated; spaces are trimmed and empty items are dropped.
  const spaced = buildView('?date=2026-10-31&time=20:00&zone=America/New_York&guests=Europe/London,,%20Asia/Kolkata%20,');
  assert.deepEqual(spaced.rows.map((r) => r.zone), ['Europe/London', 'Asia/Kolkata']);
  // A link without the leading "?" and with encoded commas and colons reads the same.
  const encoded = buildView('date=2026-10-31&time=20%3A00&zone=America%2FNew_York&guests=Europe%2FLondon%2CAsia%2FKolkata');
  assert.deepEqual(encoded.rows.map((r) => r.time), ['00:00', '05:30']);

  // No guests: the host line is still there and rows are empty.
  for (const search of ['?date=2026-10-31&time=20:00&zone=America/New_York&guests=', '?date=2026-10-31&time=20:00&zone=America/New_York']) {
    const alone = buildView(search);
    assert.equal(alone.status, 'ok', search);
    assert.deepEqual(alone.rows, [], search);
    assert.equal(alone.host.time, '20:00');
  }

  // The static page calls buildView with the link and shows the empty state.
  const main = await readSite('main.js');
  assert.match(main, /buildView\(\s*(?:window\.)?location\.search\s*\)/, 'site/main.js should call buildView(location.search)');
  assert.ok(main.includes('No guests yet.'), 'site/main.js should say "No guests yet." when there are no rows');
  const html = await readSite('index.html');
  assert.match(html, /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']main\.js["']|<script\b[^>]*\bsrc=["']main\.js["'][^>]*\btype=["']module["']/i,
    'site/index.html should load main.js as a module');
});

test('R4.2 shows a dead-of-night row with a ghost marker and the words "dead of night"', async () => {
  // from '../../src/page.js'
  const { buildView } = await import('../../src/page.js');

  // Halloween 20:00 in New York. London 00:00, Kolkata 05:30 and Kathmandu 05:45 are in the dead of night;
  // Caracas 20:00 and Sydney 11:00 are not.
  const view = buildView('?date=2026-10-31&time=20:00&zone=America/New_York&guests=Asia/Kathmandu,Australia/Sydney,Europe/London,America/Caracas,Asia/Kolkata');
  assert.equal(view.status, 'ok');
  assert.deepEqual(view.rows.map((r) => r.zone), [
    'America/Caracas', 'Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu', 'Australia/Sydney',
  ]);

  const dead = new Set(['Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu']);
  for (const row of view.rows) {
    if (dead.has(row.zone)) {
      assert.equal(row.marker, '👻', `${row.zone}: ghost marker`);
      assert.equal(row.note, 'dead of night', `${row.zone}: the words must be in the row, not only the picture`);
    } else {
      assert.equal(row.marker, '', `${row.zone}: no marker`);
      assert.equal(row.note, '', `${row.zone}: no note`);
    }
  }
  // The marker never appears without the words.
  for (const row of view.rows) {
    if (row.marker !== '') assert.match(row.note, /dead of night/);
  }

  // The static page renders the marker and the note it is given, as text.
  const main = await readSite('main.js');
  assert.match(main, /\bmarker\b/, 'site/main.js should render row.marker');
  assert.match(main, /\bnote\b/, 'site/main.js should render row.note');
  assert.match(main, /textContent/, 'site/main.js should write with textContent');
});

test('R4.3 uses a dark AA-contrast theme, no external assets, a phone-width layout and no animation under reduced motion', async () => {
  const css = (await readSite('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const html = await readSite('index.html');
  const main = await readSite('main.js');

  // WCAG 2.x contrast, computed here so the contract does not depend on any src/ helper.
  const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // Sanity check of the helper above with known values.
  assert.ok(Math.abs(ratio('#000000', '#ffffff') - 21) < 1e-9);
  assert.ok(Math.abs(ratio('#ffffff', '#ffffff') - 1) < 1e-9);

  // Block helpers for @media rules (brace matching, no nesting needed).
  const mediaBlocks = [];
  const mediaHead = /@media([^{]*)\{/g;
  for (let m = mediaHead.exec(css); m; m = mediaHead.exec(css)) {
    let depth = 1;
    let i = mediaHead.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    mediaBlocks.push({ query: m[1].trim(), start: m.index, end: i, body: css.slice(mediaHead.lastIndex, i - 1) });
    mediaHead.lastIndex = i;
  }

  // --- Dark theme with AA contrast -------------------------------------------------------------------------
  const root = css.match(/:root\s*\{([^}]*)\}/);
  assert.ok(root, 'style.css should define colour custom properties in :root');
  const vars = Object.fromEntries([...root[1].matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]));
  for (const name of ['bg', 'fg', 'muted', 'accent', 'night-bg', 'night-fg']) {
    assert.match(vars[name] ?? '', /^#[0-9a-fA-F]{6}$/, `--${name} should be a 6-digit hex colour`);
  }
  assert.ok(luminance(vars.bg) < 0.1, `--bg ${vars.bg} should be dark (relative luminance below 0.1)`);
  assert.ok(luminance(vars.fg) > luminance(vars.bg), '--fg should be lighter than --bg');
  for (const [fg, bg] of [['fg', 'bg'], ['muted', 'bg'], ['accent', 'bg'], ['night-fg', 'night-bg']]) {
    const value = ratio(vars[fg], vars[bg]);
    assert.ok(value >= 4.5, `--${fg} on --${bg} is ${value.toFixed(2)}:1, needs at least 4.5:1`);
  }

  // --- No external assets ----------------------------------------------------------------------------------
  assert.doesNotMatch(css, /@import/i, 'style.css must not @import');
  assert.doesNotMatch(css, /url\s*\(/i, 'style.css must not use url(...)');
  assert.doesNotMatch(css, /@font-face/i, 'style.css must not load web fonts');
  assert.doesNotMatch(css, /https?:/i, 'style.css must not mention http');
  assert.doesNotMatch(html, /https?:\/\//i, 'index.html must not contain an http(s) URL');
  const references = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
  assert.ok(references.includes('style.css'), 'index.html should link style.css');
  assert.ok(references.includes('main.js'), 'index.html should load main.js');
  for (const ref of references) {
    assert.doesNotMatch(ref, /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i, `index.html reference "${ref}" must be relative`);
  }
  assert.doesNotMatch(main, /https?:\/\//i, 'main.js must not mention an http(s) URL');
  const specifiers = [
    ...[...main.matchAll(/\bimport\s+(?:[^'";]*?\bfrom\s*)?["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...main.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
  ];
  assert.deepEqual(specifiers, ['../src/page.js'], 'main.js should import only ../src/page.js');
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
    assert.ok(!main.includes(banned), `main.js must not use ${banned}; the link is untrusted`);
  }

  // --- Phone width without horizontal scrolling ------------------------------------------------------------
  const viewport = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0])
    .find((tag) => /name\s*=\s*["']viewport["']/i.test(tag));
  assert.ok(viewport, 'index.html should have a viewport meta tag');
  assert.match(viewport, /width=device-width/, 'viewport should use width=device-width');
  assert.match(viewport, /initial-scale=1/, 'viewport should set initial-scale=1');
  assert.match(css, /overflow-wrap\s*:\s*anywhere/, 'long zone names should wrap with overflow-wrap: anywhere');
  assert.match(css, /max-width\s*:/, 'the page should cap its width with max-width');
  assert.ok(
    mediaBlocks.some((b) => /max-width\s*:\s*40rem|width\s*<\s*40rem/.test(b.query)),
    'rows should stack under 40rem',
  );
  const declarations = css.replace(/@media[^{]*\{/g, '{'); // drop media queries so only declarations remain
  for (const m of declarations.matchAll(/(?<![\w-])(min-width|width)\s*:\s*(\d+(?:\.\d+)?)(px|rem|em)\b/g)) {
    const px = Number(m[2]) * (m[3] === 'px' ? 1 : 16);
    assert.ok(px <= 320, `${m[0]} is wider than a 320px phone`);
  }

  // --- Reduced motion --------------------------------------------------------------------------------------
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/, 'style.css should handle prefers-reduced-motion: reduce');
  const reduce = mediaBlocks.filter((b) => /prefers-reduced-motion\s*:\s*reduce/.test(b.query));
  const allowed = mediaBlocks.filter((b) => /prefers-reduced-motion\s*:\s*no-preference/.test(b.query));
  assert.ok(reduce.length > 0, 'a prefers-reduced-motion: reduce block is required');
  assert.ok(reduce.some((b) => /animation\s*:\s*none/.test(b.body)), 'the reduce block should set animation: none');
  assert.ok(reduce.some((b) => /transition\s*:\s*none/.test(b.body)), 'the reduce block should set transition: none');

  const motion = /(?<![\w-])(animation|transition)(?:-[a-z-]+)?\s*:\s*([^;}]*)/gi;
  for (const block of reduce) {
    for (const m of block.body.matchAll(motion)) {
      assert.match(m[2].trim(), /^none(\s*!important)?$/i, `inside the reduce block "${m[0].trim()}" must be none`);
    }
  }
  // Everything outside the reduce and no-preference blocks must be free of animation, transition and smooth scrolling.
  let outside = css;
  for (const block of [...reduce, ...allowed].sort((a, b) => b.start - a.start)) {
    outside = outside.slice(0, block.start) + outside.slice(block.end);
  }
  assert.doesNotMatch(outside, new RegExp(motion.source, 'i'), 'animation and transition may only be declared inside prefers-reduced-motion: no-preference');
  assert.doesNotMatch(outside, /scroll-behavior\s*:\s*smooth/i, 'smooth scrolling may only be declared inside prefers-reduced-motion: no-preference');
});
