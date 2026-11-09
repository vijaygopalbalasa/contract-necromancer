import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDom } from './fixtures/fake-dom.js';
import { withBrowser } from './fixtures/browser.js';
import { start } from '../site/app.js';
import { SAMPLES } from '../site/lib/samples.js';

// Requirement 11: the first screen tells the story. Three beats taken from the real `necro demo` output sit between the
// heading and the verdict banner, the demo command can be copied from the first screen, the sample buttons use plain
// words, and the page has an inline favicon. Text checks read the files; layout checks run the page in a headless browser.

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('site/index.html');
const css = read('site/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

const DEMO = 'npx -y github:vijaygopalbalasa/contract-necromancer demo';
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'";

const idAt = (id) => {
  const i = html.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
};
const textOf = (fragment) => fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// The strip: from its opening tag to its closing tag, and its three beats as plain text.
function strip() {
  const at = idAt('strip');
  const start = html.lastIndexOf('<section', at);
  const end = html.indexOf('</section>', start);
  assert.ok(start >= 0 && end > start && html.slice(start, at).indexOf('>') < 0, 'the strip is a <section id="strip">');
  const text = html.slice(start, end + '</section>'.length);
  const list = /<ol\b[^>]*>([\s\S]*?)<\/ol>/.exec(text);
  assert.ok(list, 'the beats are an ordered list');
  const beats = [...list[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
  return { start, end: end + '</section>'.length, text, beats };
}

// ---- R11.1 ----

test('R11.1 a strip of three beats sits between the heading and the verdict banner, in reading order', () => {
  const s = strip();
  assert.equal(s.beats.length, 3, 'three beats');
  assert.ok(html.indexOf('<h1') < s.start, 'after the page heading');
  assert.ok(s.end < idAt('verdict'), 'before the verdict banner');
  assert.match(s.beats[0], /Kiro says task 4 is done/);
  assert.match(s.beats[1], /gate refuses the tick/);
  assert.match(s.beats[1], /R2\.1/);
  assert.match(s.beats[1], /R2\.2/);
  assert.match(s.beats[2], /gate accepts the tick/);
  assert.match(s.beats[2], /writes a receipt/);
  assert.match(s.beats[2], /necro verify prints CONFIRMED/);
  assert.ok(s.beats[1].indexOf('R2.1') < s.beats[1].indexOf('R2.2'));
});

test('R11.1 the beats are plain text in the HTML: no script, no hidden parts, no generated text, no em dashes', () => {
  const s = strip();
  assert.doesNotMatch(s.text, /<script|\bhidden\b|aria-hidden|<svg|<img|data-/i);
  assert.doesNotMatch(s.text, /[\u2013\u2014]/, 'no em or en dashes');
  assert.equal(s.beats.every((b) => b.length > 20 && b.length <= 110), true, 'each beat is a short sentence or two');
  // The strip is styled only by CSS: app.js does not know the beats.
  assert.doesNotMatch(read('site/app.js'), /strip-beat|beats|id="strip"|'strip'/);
});

test('R11.1 the beats say what the real `necro demo` prints', () => {
  const run = spawnSync(process.execPath, ['bin/necro.js', 'demo'], { cwd: rootPath, encoding: 'utf8', timeout: 120000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const out = run.stdout;
  const failed = /Contracts failed: ([^\n]+)/.exec(out);
  assert.ok(failed, 'the demo lists the failing contracts');
  const ids = failed[1].split(',').map((x) => x.trim());
  const [, beat2, beat3] = strip().beats;
  assert.deepEqual(ids.slice(0, 2), ['R2.1', 'R2.2'], 'the demo names R2.1 and R2.2 first');
  assert.ok(beat2.includes(`${ids[0]}, ${ids[1]} and ${ids.length - 2} more`), `the strip says "${ids[0]}, ${ids[1]} and ${ids.length - 2} more"`);
  assert.match(out, /Reopen task 4/);
  assert.match(out, /round each share, so cents are lost/);
  assert.match(out, /The gate refused the tick \(exit 2\)/);
  assert.match(out, /The gate accepted the tick \(exit 0\)/);
  assert.match(out, /Receipt: /);
  assert.match(out, /CONFIRMED [0-9a-f]{64}/);
  assert.match(beat3, /CONFIRMED/);
});

test('R11.1 with scripts off the three beats are on screen in order', async () => {
  await withBrowser(async (browser) => {
    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844, mobile: true }]) {
      const m = await browser.measure({ ...size, scripts: false, settle: false }, () => {
        const items = [...document.querySelectorAll('#strip li')];
        return {
          texts: items.map((li) => li.innerText.replace(/\s+/g, ' ').trim()),
          rects: items.map((li) => {
            const b = li.getBoundingClientRect();
            const style = getComputedStyle(li);
            return { top: b.top, left: b.left, width: b.width, height: b.height, visibility: style.visibility, display: style.display };
          }),
        };
      });
      assert.equal(m.texts.length, 3);
      assert.match(m.texts[0], /task 4 is done/);
      assert.match(m.texts[1], /R2\.1, R2\.2/);
      assert.match(m.texts[2], /CONFIRMED/);
      for (const r of m.rects) {
        assert.ok(r.width > 0 && r.height > 0 && r.visibility === 'visible' && r.display !== 'none', `${size.width}: a beat is not drawn`);
      }
      // Reading order is drawing order: left to right on a wide window, top to bottom on a phone.
      const key = size.width > 800 ? 'left' : 'top';
      assert.ok(m.rects[0][key] < m.rects[1][key] && m.rects[1][key] < m.rects[2][key], `${size.width}: the beats are drawn out of order`);
    }
  });
});

// ---- R11.2 ----

test('R11.2 the strip animates in CSS only, and only for people who have not asked for less motion', () => {
  const blocks = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*{([\s\S]*?)\n}\n/g)].map((m) => m[1]);
  assert.ok(blocks.length > 0);
  const inMotion = blocks.join('\n');
  assert.match(inMotion, /\.beat\b[^{]*{[^}]*animation:/, 'the beats animate under no-preference');
  // No rule outside that block sets an animation on the strip.
  const outside = css.replace(/@media\s*\(prefers-reduced-motion:[^)]*\)\s*{[\s\S]*?\n}\n/g, '');
  assert.doesNotMatch(outside, /(\.beat|\.strip)[^{]*{[^}]*(animation|transition)\s*:/, 'no animation on the strip outside the motion block');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*{\s*\*,[\s\S]*?animation:\s*none !important/, 'the reduce block turns every animation off');
});

test('R11.2 under prefers-reduced-motion: reduce all three beats are fully shown at once, with no animation', async () => {
  await withBrowser(async (browser) => {
    const beats = () => {
      const items = [...document.querySelectorAll('#strip li')];
      return {
        count: items.length,
        running: items.flatMap((li) => li.getAnimations({ subtree: true })).length,
        names: items.map((li) => getComputedStyle(li).animationName),
        opacities: items.map((li) => getComputedStyle(li).opacity),
        transforms: items.map((li) => getComputedStyle(li).transform),
      };
    };
    const reduced = await browser.measure({ width: 1280, height: 800, reducedMotion: true, settle: false }, beats);
    assert.equal(reduced.count, 3);
    assert.equal(reduced.running, 0, 'nothing is animating');
    assert.deepEqual(reduced.names, ['none', 'none', 'none']);
    assert.deepEqual(reduced.opacities, ['1', '1', '1']);
    assert.deepEqual(reduced.transforms, ['none', 'none', 'none']);

    // Where motion is welcome, the beats do animate: the check above is not passing because nothing ever animates.
    const motion = await browser.measure({ width: 1280, height: 800, reducedMotion: false, settle: false }, beats);
    assert.ok(motion.names.every((n) => n !== 'none'), 'under no-preference the beats are animated');
  });
});

// ---- R11.3 ----

test('R11.3 the demo command and its copy button are in the first screen at 1280x800', async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure({ width: 1280, height: 800 }, () => {
      const box = (id) => {
        const e = document.getElementById(id);
        const b = e.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height, text: e.textContent.trim() };
      };
      return { w: innerWidth, h: innerHeight, scrollY, command: box('strip-command'), copy: box('strip-copy') };
    });
    assert.equal(m.scrollY, 0);
    assert.equal(m.command.text, DEMO);
    assert.match(m.copy.text, /copy/i);
    for (const [name, b] of [['command', m.command], ['copy button', m.copy]]) {
      assert.ok(b.width > 0 && b.height > 0, `the ${name} is drawn`);
      assert.ok(b.top >= 0 && b.bottom <= m.h && b.left >= 0 && b.right <= m.w, `the ${name} is inside the first 1280x800 screen`);
    }
  });
});

test('R11.3 the copy button next to the command puts exactly the demo command on the clipboard', async () => {
  for (const refuse of [false, true]) {
    const dom = createDom();
    dom.el('paste').value = '{}'; // like a restored form: the page loads no sample
    const written = [];
    await start({
      document: dom.document,
      location: { search: '', href: 'https://example.test/' },
      fetch: async () => new Response('no', { status: 404 }),
      navigator: {
        clipboard: {
          writeText: async (text) => {
            if (refuse) throw new Error('denied');
            written.push(text);
          },
        },
      },
    });
    assert.match(html, /<code\b[^>]*\bid="strip-command"[^>]*>npx -y github:vijaygopalbalasa\/contract-necromancer demo<\/code>/);
    dom.el('strip-command').textContent = DEMO;
    await dom.el('strip-copy').dispatch('click');
    if (refuse) {
      assert.deepEqual(written, []);
      assert.equal(dom.el('strip-copy-note').textContent, 'Select the command and copy it.');
    } else {
      assert.deepEqual(written, [DEMO]);
      assert.equal(dom.el('strip-copy-note').textContent, 'Copied.');
    }
    assert.equal(dom.el('demo-copy-note').textContent, '', 'the copy button in How it works is not touched');
  }
});

// ---- R11.4 ----

test('R11.4 the sample buttons say "A passing receipt" and "A refused one" in plain words', () => {
  const buttons = Object.fromEntries([...html.matchAll(/<button[^>]*id="(sample|sample-buried)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2].trim()]));
  assert.match(buttons.sample, /^A passing receipt\b/);
  assert.match(buttons['sample-buried'], /^A refused one\b/);
  assert.equal(buttons.sample, SAMPLES[0].label);
  assert.equal(buttons['sample-buried'], SAMPLES[1].label);
  for (const label of Object.values(buttons)) assert.doesNotMatch(label, /^Load\b|[\u2013\u2014]/);
});

test('R11.4 each sample note says in one sentence what a receipt is, and still says it is a sample', () => {
  for (const s of SAMPLES) {
    assert.match(s.note, /^A receipt lists the contracts that had to pass before Kiro could tick the task\./, `${s.id}: the first sentence says what a receipt is`);
    assert.match(s.note, /\bsample\b/i, `${s.id}: the note still says it is a sample`);
    assert.doesNotMatch(s.note, /[\u2013\u2014]/);
    assert.ok(s.note.length <= 260, `${s.id}: the note stays short`);
  }
  assert.match(SAMPLES[1].note, /necro check/);
  assert.match(SAMPLES[1].note, /not stored in this repository/);
});

// ---- R11.5 ----

test('R11.5 an inline data: SVG favicon of the gravestone mark, a title that says what the page does, and the CSP unchanged', () => {
  const icons = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /\brel="icon"/.test(tag));
  assert.equal(icons.length, 1, 'one favicon link');
  const href = /\bhref="(data:image\/svg\+xml,[^"]+)"/.exec(icons[0]);
  assert.ok(href, 'the favicon is a data:image/svg+xml URL');
  assert.match(icons[0], /\btype="image\/svg\+xml"/);
  const svg = decodeURIComponent(href[1].slice('data:image/svg+xml,'.length));
  assert.match(svg, /^<svg\b[^>]*xmlns='http:\/\/www\.w3\.org\/2000\/svg'[^>]*viewBox='0 0 64 64'/);
  assert.match(svg, /<path\b/);
  assert.doesNotMatch(svg, /<(script|image|use|style|foreignObject)\b|href=|url\(|@import/i, 'the favicon loads nothing');
  assert.equal(svg.match(/https?:\/\/[^'"\s]+/g).join(), 'http://www.w3.org/2000/svg', 'the only address is the SVG namespace');

  const title = /<title>([^<]*)<\/title>/.exec(html)[1];
  assert.match(title, /^Contract Necromancer\b/);
  assert.match(title, /contracts/i);
  assert.match(title, /done/i);
  assert.ok(title.length <= 72, `the title is ${title.length} characters`);
  assert.doesNotMatch(title, /[\u2013\u2014]/);

  const csp = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(html);
  assert.equal(csp[1], CSP);
});

test('R11.5 the browser asks for no icon file and no request fails', async () => {
  await withBrowser(async (browser) => {
    await browser.measure({ width: 1280, height: 800 }, () => true);
    const paths = browser.requests.map((r) => r.path);
    assert.ok(!paths.includes('/favicon.ico'), `the browser requested /favicon.ico (${paths.join(', ')})`);
    assert.deepEqual(browser.requests.filter((r) => r.status !== 200), []);
  });
});

test('the old above-fold file is gone and the frozen above-fold-v2 contract file is untouched', () => {
  const lock = JSON.parse(read('.necro/lock.json'));
  const contracts = lock.specs['receipt-viewer'].contracts;
  assert.ok(!fs.existsSync(new URL('contracts/receipt-viewer/above-fold.contract.test.js', root)), 'the old file is removed');
  assert.ok(!contracts.some((c) => c.path === 'contracts/receipt-viewer/above-fold.contract.test.js'), 'the lock no longer lists the old file');
  const pinned = contracts.find((c) => c.path === 'contracts/receipt-viewer/above-fold-v2.contract.test.js');
  assert.ok(pinned, 'the lock lists above-fold-v2');
  const sha = createHash('sha256').update(fs.readFileSync(new URL(pinned.path, root))).digest('hex');
  assert.equal(sha, pinned.sha256);
});
