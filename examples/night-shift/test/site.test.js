// Tasks 7 and 8: static checks on site/ files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contrastRatio } from '../src/contrast.js';

const readSite = (name) => readFile(new URL(`../site/${name}`, import.meta.url), 'utf8');

test('style.css colour properties meet AA contrast and dark background', async () => {
  const css = (await readSite('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const root = css.match(/:root\s*\{([^}]*)\}/);
  assert.ok(root);
  const vars = Object.fromEntries(
    [...root[1].matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]),
  );
  for (const name of ['bg', 'fg', 'muted', 'accent', 'night-bg', 'night-fg']) {
    assert.match(vars[name] ?? '', /^#[0-9a-fA-F]{6}$/, name);
  }
  for (const [fg, bg] of [['fg', 'bg'], ['muted', 'bg'], ['accent', 'bg'], ['night-fg', 'night-bg']]) {
    assert.ok(contrastRatio(vars[fg], vars[bg]) >= 4.5, `${fg} on ${bg}`);
  }
});

test('style.css handles reduced motion and has no external assets', async () => {
  const css = await readSite('style.css');
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/);
  assert.doesNotMatch(css, /@import/i);
  assert.doesNotMatch(css, /url\s*\(/i);
  assert.doesNotMatch(css, /https?:/i);
});

test('index.html has viewport, links assets relatively, no external URL', async () => {
  const html = await readSite('index.html');
  assert.match(html, /<meta\b[^>]*name=["']viewport["'][^>]*>/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /<script\b[^>]*type=["']module["'][^>]*src=["']main\.js["']/i);
  assert.match(html, /href=["']style\.css["']/i);
});

test('main.js imports only page.js and avoids innerHTML', async () => {
  const main = await readSite('main.js');
  const specifiers = [...main.matchAll(/\bimport\s+[^'";]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(specifiers, ['../src/page.js']);
  assert.ok(!main.includes('innerHTML'));
  assert.match(main, /buildView\(\s*(?:window\.)?location\.search\s*\)/);
  assert.ok(main.includes('No guests yet.'));
});
