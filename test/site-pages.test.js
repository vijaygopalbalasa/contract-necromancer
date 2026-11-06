import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const yml = fs.readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
const lines = yml.split('\n').filter((l) => !l.trim().startsWith('#'));
const body = lines.join('\n');

test('the workflow uploads the site folder with actions/upload-pages-artifact', () => {
  assert.match(body, /uses:\s*actions\/upload-pages-artifact@v\d+/);
  assert.match(body, /upload-pages-artifact@v\d+\s*\n\s*with:\s*\n\s*path:\s*['"]?site\/?['"]?\s*(\n|$)/);
});

test('the workflow deploys with actions/deploy-pages in the github-pages environment', () => {
  assert.match(body, /uses:\s*actions\/deploy-pages@v\d+/);
  assert.match(body, /environment:\s*\n\s*name:\s*github-pages/);
});

test('the workflow asks for pages: write and id-token: write and no other write permission', () => {
  assert.match(body, /^\s*pages:\s*write\s*$/m);
  assert.match(body, /^\s*id-token:\s*write\s*$/m);
  const writes = [...body.matchAll(/^\s*([\w-]+):\s*write\s*$/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(writes)].sort(), ['id-token', 'pages']);
  assert.doesNotMatch(body, /write-all|permissions:\s*write/);
  assert.match(body, /^\s*contents:\s*read\s*$/m, 'checkout needs contents: read');
});

test('the workflow has no build or install step', () => {
  assert.doesNotMatch(body, /^\s*-?\s*run:/m);
  assert.doesNotMatch(body, /\b(npm|yarn|pnpm|npx|pip|make)\b/);
  assert.doesNotMatch(body, /setup-node/);
});

test('the workflow runs on a push to the default branch and by hand', () => {
  assert.match(body, /^on:\s*\n\s*push:\s*\n\s*branches:\s*\[\s*main\s*\]/m);
  assert.match(body, /^\s*workflow_dispatch:/m);
});

test('the workflow does not use third-party actions', () => {
  const used = [...body.matchAll(/uses:\s*([^\s@]+)@/g)].map((m) => m[1]);
  assert.ok(used.length >= 3);
  for (const u of used) assert.match(u, /^actions\//, u);
});

test('the folder the workflow publishes exists and holds the page', () => {
  for (const f of ['index.html', 'style.css', 'main.js', 'app.js', 'sample-receipt.json']) {
    assert.ok(fs.existsSync(new URL(`../site/${f}`, import.meta.url)), f);
  }
});

test('the workflow serializes deployments', () => {
  assert.match(body, /^concurrency:\s*\n\s*group:\s*['"]?pages['"]?/m);
});

// ---- Task 15: the README gives the published address (7.4) ----

test('README.md gives the page address and the repository, with no OWNER/REPO placeholder left', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('https://vijaygopalbalasa.github.io/contract-necromancer/'));
  assert.ok(readme.includes('https://raw.githubusercontent.com/vijaygopalbalasa/contract-necromancer/'));
  assert.doesNotMatch(readme, /OWNER\.github\.io|\/OWNER\/REPO\//);
});
