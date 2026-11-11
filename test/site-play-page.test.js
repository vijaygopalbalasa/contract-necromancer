import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDom } from './fixtures/fake-dom.js';
import { withBrowser, NO_BROWSER } from './fixtures/browser.js';
import { start } from '../site/app.js';
import { PLAY_CONTRACTS } from '../site/lib/play-loader.js';
import { PLANTED_CHANGE } from '../site/lib/play.js';

// Requirement 13 as the page shows it (task 26): a start control in the first screen, and below the story strip a play with
// three steps. The worker and the pure checks are tested in site-play-loader.test.js and site-play.test.js; here the page is
// driven with the worker replaced by a script (fake DOM), and then with the real worker in a headless browser.

const root = new URL('../', import.meta.url);
const SITE_URL = new URL('site/', root).href;
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('site/index.html');
const css = read('site/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const appSource = read('site/app.js');

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'";
const DASHES = /[\u2013\u2014]/;
const SEVEN = ['R2.1', 'R2.2', 'R5.1', 'R5.2', 'R5.3', 'R5.4', 'R5.5'];
const MISMATCH = 'MISMATCH. Files changed: src/split.js.';

const idAt = (id) => {
  const i = html.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
};
const textOf = (fragment) => fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tagAt = (id) => {
  const at = idAt(id);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};
const sectionOf = (id) => {
  const start = html.lastIndexOf('<section', idAt(id));
  const end = html.indexOf('</section>', start) + '</section>'.length;
  return { start, end, text: html.slice(start, end) };
};

// ---- the static page ----

test('R13.9 the start control is a real button in the story strip, after the copy button, drawn only when scripts run', () => {
  const tag = tagAt('strip-play');
  assert.match(tag, /^<button\b/);
  assert.match(tag, /\btype="button"/);
  assert.match(tag, /\bclass="needs-script"/, 'CSS keeps it undrawn until the script takes the class off, so a page without scripts never shows a button that does nothing');
  assert.doesNotMatch(tag, /hidden/, 'the frozen R11.1 contract forbids the word hidden in the strip');
  assert.match(css, /\.needs-script\s*{\s*display:\s*none/);
  assert.match(tag, /\baria-controls="play"/);
  assert.match(tag, /\baria-expanded="false"/);
  const strip = sectionOf('strip');
  assert.ok(strip.text.includes('id="strip-play"'), 'it sits inside the strip');
  assert.ok(idAt('strip-copy') < idAt('strip-play'), 'it comes after the copy button');
  assert.ok(idAt('strip-play') < idAt('strip-copy-note'), 'and before the copy note');
  const label = /id="strip-play"[^>]*>([^<]*)</.exec(html)[1].trim();
  assert.match(label, /^Try it here$/);
  assert.doesNotMatch(label, /sample|show|risen|buried/i, 'the frozen first-visit contracts look buttons up by these words');
});

test('R13.9 the play is a hidden section directly after the story strip and before the evidence line and the verdict banner', () => {
  const strip = sectionOf('strip');
  const play = sectionOf('play');
  assert.equal(html.slice(strip.end, play.start).trim(), '', 'nothing stands between the strip and the play');
  assert.match(play.text, /^<section\b[^>]*\bid="play"[^>]*\bhidden\b/, 'hidden until the control is used');
  assert.ok(play.end <= idAt('evidence') && idAt('evidence') < idAt('verdict'));
  assert.match(play.text, /aria-labelledby="play-title"/);
  assert.match(play.text, /<h3\b[^>]*\bid="play-title"[^>]*\btabindex="-1"/, 'a heading that can take focus when the play opens');
  // The frozen layout tests: nothing tall above the banner.
  const above = html.slice(html.indexOf('<body'), idAt('verdict'));
  assert.doesNotMatch(above, /<h2/, 'no second heading above the banner');
  assert.doesNotMatch(play.text, /<(textarea|input|pre|img|svg|script|iframe|video)\b|style=/i);
});

test('R13.9 the play says in one short line what will happen', () => {
  const intro = /<p\b[^>]*\bid="play-intro"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(intro, 'a <p id="play-intro">');
  const words = textOf(intro[1]);
  assert.match(words, /false "done"/);
  assert.match(words, /refuse/);
  assert.match(words, /fix/);
  assert.match(words, /accept/);
  assert.ok(words.split(' ').length <= 24, `${words.split(' ').length} words`);
  assert.equal((words.match(/[.!?](\s|$)/g) || []).length, 1, 'one sentence');
  assert.doesNotMatch(words, DASHES);
});

test('R13.2 the planted change is drawn as a diff: the two changed lines of src/split.js, each removed then added', () => {
  const diff = /<div\b[^>]*\bclass="diff"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  assert.ok(diff, 'a <div class="diff">');
  assert.match(textOf(diff[1]), /src\/split\.js/);
  const lines = [...diff[1].matchAll(/<p\b[^>]*\bclass="diff-line (diff-del|diff-add)"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => ({
    kind: m[1],
    code: /<code>([^<]*)<\/code>/.exec(m[2])[1],
    inner: m[2],
  }));
  assert.deepEqual(lines.map((l) => l.kind), ['diff-del', 'diff-add', 'diff-del', 'diff-add']);
  // The old and new text are the planted change that play.js applies.
  const [[from1, to1], [from2, to2]] = PLANTED_CHANGE;
  assert.ok(lines[0].code.includes(from1) && lines[1].code.includes(to1), 'first pair is the rounding');
  assert.ok(lines[2].code.includes(from2) && lines[3].code.includes(to2), 'second pair is the extra cents');
  // The same line with only the planted text replaced.
  assert.equal(lines[0].code.replace(from1, to1), lines[1].code);
  assert.equal(lines[2].code.replace(from2, to2), lines[3].code);
  // The real file has those lines, so the diff is not made up.
  const split = read('site/play/src/split.js');
  assert.ok(split.includes(lines[0].code.trim()) && split.includes(lines[2].code.trim()), 'the removed lines are lines of the real src/split.js');
  // A screen reader hears removed or added, and the - and + marks are decoration.
  for (const l of lines) {
    assert.match(l.inner, /<span class="diff-mark" aria-hidden="true">[-+]<\/span>/);
    assert.match(l.inner, /<span class="sr-only">(Removed|Added):<\/span>/);
  }
});

test('R13.2 R13.3 R13.4 three steps, one button each, in order: send the tick with the planted change, apply the fix, change one byte', () => {
  const play = sectionOf('play').text;
  const list = /<ol\b[^>]*\bclass="play-steps"[^>]*>([\s\S]*?)<\/ol>/.exec(play);
  assert.ok(list, 'the steps are an ordered list');
  const steps = [...list[1].matchAll(/<li\b[^>]*\bclass="play-step"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(steps.length, 3);
  const ids = ['play-send', 'play-fix', 'play-byte'];
  const results = ['play-result-planted', 'play-result-fixed', 'play-result-byte'];
  steps.forEach((s, i) => {
    assert.equal((s.match(/<button\b/g) || []).length, 1, `step ${i + 1} has one button`);
    assert.ok(s.includes(`id="${ids[i]}"`), `step ${i + 1} button is #${ids[i]}`);
    assert.match(s, new RegExp(`<div\\b[^>]*\\bid="${results[i]}"[^>]*>`), `step ${i + 1} has its result place`);
  });
  assert.equal((play.match(/<button\b/g) || []).length, 3, 'three buttons in the play');
  const labels = ids.map((id) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)[1].trim());
  assert.match(labels[0], /^Send the tick$/);
  assert.match(labels[1], /^Apply the fix and send the tick$/);
  assert.match(labels[2], /^Change one byte$/);
  for (const l of labels) assert.doesNotMatch(l, /sample|show|risen|buried/i);
  assert.match(textOf(steps[0]), /task 4 is done/);
  assert.match(textOf(steps[2]), /src\/split\.js/);
});

test('R13.10 every result place can take focus, is hidden until it has a result and is named; one polite live region announces progress', () => {
  for (const id of ['play-result-planted', 'play-result-fixed', 'play-result-byte']) {
    const tag = tagAt(id);
    assert.match(tag, /\btabindex="-1"/, `${id} takes focus`);
    assert.match(tag, /\bhidden\b/, `${id} is hidden until it has a result`);
    assert.match(tag, /\brole="group"/);
    assert.match(tag, /\baria-label="[^"]+"/);
  }
  const status = tagAt('play-status');
  assert.match(status, /\baria-live="polite"/);
  assert.match(status, /\brole="status"/);
  assert.equal((html.match(/id="play-status"/g) || []).length, 1, 'one live region for the play');
});

test('R13.7 the stand-ins sentence is on the page once, and no sentence says contracts run only in Node', () => {
  const body = html.slice(html.indexOf('<body'), html.indexOf('<script'));
  const sentence = 'The browser runs the contracts with small stand-ins for node:test and node:assert, while the gate runs them in Node.js.';
  const flat = textOf(body.replace(/<\/?code>/g, ''));
  assert.equal(flat.split(sentence).length - 1, 1, 'the sentence appears exactly once');
  assert.match(tagAt('play-note'), /^<p\b/);
  assert.equal(textOf(/id="play-note"[^>]*>([\s\S]*?)<\/p>/.exec(html)[1].replace(/<\/?code>/g, '')), sentence);
  // The frozen R12.2 contract counts the sentences that name necro verify, JavaScript contracts and runner contracts.
  const play = textOf(sectionOf('play').text);
  assert.doesNotMatch(play, /JavaScript contracts|runner contracts|necro verify/, 'the play adds no second necro verify sentence');
  assert.doesNotMatch(play, /\bonly\b/i);
  assert.doesNotMatch(play, /\bsample\b/i, 'the frozen first-visit contracts read every id\'d element for the word sample');
  assert.doesNotMatch(play, DASHES);
});

test('R13.10 the Content Security Policy is unchanged, there is still one script, and the page has no inline style or script', () => {
  assert.equal(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(html)[1], CSP);
  assert.equal((html.match(/<script\b/g) || []).length, 1);
  assert.doesNotMatch(html, /\sstyle=|\sonclick=|<style\b/i);
  assert.doesNotMatch(appSource, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(appSource, /\bbeats?\b/, 'the page script does not know the story beats (frozen R11.2)');
});

test('R13.10 the play adds no animation outside the motion block, and under reduce everything is switched off', () => {
  const motion = [...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*{([\s\S]*?)\n}\n/g)].map((m) => m[1]).join('\n');
  const outside = css.replace(/@media\s*\(prefers-reduced-motion:[^)]*\)\s*{[\s\S]*?\n}\n/g, '');
  assert.doesNotMatch(outside, /(\.play|\.diff|#strip-play)[^{]*{[^}]*(animation|transition)\s*:/, 'no animation on the play outside the motion block');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*{\s*\*,[\s\S]*?animation:\s*none !important/);
  assert.doesNotMatch(motion, /\.play\b/, 'the play itself is never animated (the contract rows keep the existing rule)');
  assert.doesNotMatch(appSource, /\.animate\(|requestAnimationFrame|setInterval/);
});

test('R13.10 the play fits a phone: its text wraps, nothing in it has a fixed width, and there is a visually hidden class for the diff words', () => {
  const rules = [...css.matchAll(/(?:^|})\s*([^{}@]+){([^{}]*)}/g)].filter((m) => /\.(play|diff)/.test(m[1]));
  assert.ok(rules.length >= 8, 'style.css styles the play');
  for (const m of rules) {
    assert.doesNotMatch(m[2], /(?:^|[\s;])(?:min-)?width\s*:\s*[\d.]+(?:px|vw)/, `${m[1].trim()} sets a fixed width`);
    assert.doesNotMatch(m[2], /white-space\s*:\s*(?:pre|nowrap)\s*(?:;|$)/, `${m[1].trim()} stops wrapping`);
  }
  assert.match(css, /\.diff-line\b[^{]*{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.sr-only\s*{[^}]*clip:\s*rect\(0,? 0,? 0,? 0\)/);
});

// ---- the page driven with a scripted worker ----

const siteFile = (url) => {
  if (!url.startsWith(SITE_URL)) return null;
  const rel = decodeURIComponent(url.slice(SITE_URL.length).split('?')[0]);
  try {
    return fs.readFileSync(new URL(rel, SITE_URL));
  } catch {
    return null;
  }
};

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function result(id, outcome, message = '') {
  const c = PLAY_CONTRACTS.find((x) => x.id === id);
  return { name: c.name, result: outcome, message };
}
const PLANTED_RESULTS = SEVEN.map((id) =>
  result(id, id === 'R5.5' ? 'pass' : 'fail', id === 'R5.5' ? '' : `${id} expected 3333 but got 3334`),
);
const FIXED_RESULTS = SEVEN.map((id) => result(id, 'pass'));

// Start the page with the files served from disk and a scripted runPlay. `runPlay` gets { run } and what else the page gives.
async function openPlay({ runPlay, missing = [], clipboard = {} } = {}) {
  const dom = createDom();
  const focused = [];
  const requested = [];
  const scrolled = [];
  for (const el of dom.byId.values()) {
    el.focus = () => focused.push(el.id);
    el.scrollIntoView = (options) => scrolled.push({ id: el.id, options });
  }
  dom.el('paste').value = '{}'; // like a restored form: the page loads no sample by itself
  const fetchStub = async (url) => {
    requested.push(String(url));
    const body = missing.some((m) => String(url).endsWith(m)) ? null : siteFile(String(url));
    if (!body) return new Response('no', { status: 404 });
    return new Response(body, { status: 200 });
  };
  const calls = [];
  const scripted =
    runPlay ||
    (async (options) => {
      return options.run === 'planted'
        ? { ok: true, run: 'planted', results: PLANTED_RESULTS, ms: 40 }
        : { ok: true, run: 'fixed', results: FIXED_RESULTS, ms: 40 };
    });
  await start({
    document: dom.document,
    location: { search: '', href: 'https://example.test/' },
    fetch: fetchStub,
    navigator: { clipboard },
    matchMedia: () => ({ matches: false }),
    play: { runPlay: async (options) => (calls.push(options), scripted(options)) },
  });
  return { dom, focused, requested, scrolled, calls };
}

const el = (page, id) => page.dom.el(id);
const allText = (node) => node.textContent;
function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}
const find = (node, pred) => {
  const out = [];
  walk(node, (n) => pred(n) && out.push(n));
  return out;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
// All the text the play has made so far: every element whose id starts with play-.
const playText = (page) => [...page.dom.byId.values()].filter((e) => e.id.startsWith('play-')).map((e) => e.textContent).join('\n');

test('R13.9 the page draws the start control once scripts run, loads nothing for the play, and opens the play when it is used', async () => {
  const page = await openPlay();
  assert.equal(el(page, 'strip-play').className.includes('needs-script'), false, 'the control is drawn');
  assert.equal(el(page, 'play').hidden, true, 'the play stays closed');
  assert.deepEqual(page.requested, [], 'nothing is fetched before the play is used');
  await el(page, 'strip-play').dispatch('click');
  assert.equal(el(page, 'play').hidden, false);
  assert.equal(el(page, 'strip-play').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(page.requested, [], 'opening the play fetches nothing either');
  assert.equal(page.focused.at(-1), 'play-title', 'focus moves to the play heading');
  assert.ok(page.scrolled.some((s) => s.id === 'play'), 'the play is brought into view');
  assert.equal(page.calls.length, 0, 'no run starts by itself');
  assert.ok(!page.scrolled.some((s) => s.id === 'verdict'), 'opening the play does not scroll to the banner');
});

test('R13.2 sending the tick with the planted change runs "planted" and nothing else, lists each contract as a gravestone or alive row, and says the tick is refused', async () => {
  const page = await openPlay();
  await el(page, 'strip-play').dispatch('click');
  await el(page, 'play-send').dispatch('click');
  await settle();
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].run, 'planted');
  const box = el(page, 'play-result-planted');
  assert.equal(box.hidden, false);
  const text = allText(box);
  assert.match(text, /Refused/);
  assert.match(text, /6 of the 7 contracts the browser ran fail/);
  const rows = find(box, (n) => n.tagName === 'LI' && n.className.split(/\s+/).includes('contract'));
  assert.equal(rows.length, 7, 'seven rows');
  assert.deepEqual(
    rows.map((r) => [r.className.split(/\s+/).includes('fail') ? 'fail' : 'pass', /\b(PASS|FAIL)\b/.exec(r.textContent)[1]]),
    [...Array(6).fill(['fail', 'FAIL']), ['pass', 'PASS']],
    'the same fail and pass classes and words as the receipt rows',
  );
  assert.deepEqual(rows.map((r) => /R\d\.\d/.exec(r.textContent)[0]), SEVEN);
  for (const r of rows.slice(0, 6)) assert.match(r.textContent, /expected 3333 but got 3334/, 'a failing row carries its assertion message');
  for (const r of rows.slice(0, 6)) assert.equal(find(r, (n) => n.tagName === 'DETAILS').length, 0, 'a short message needs no details element');
  assert.doesNotMatch(rows[6].textContent, /expected/);
  assert.equal(el(page, 'play-result-fixed').hidden, true);
  assert.equal(el(page, 'play-result-byte').hidden, true);
});

test('R13.5 next to the run: the browser ran 7 of the ledger\'s 18 contracts, the other 11 start the command line, and the gate\'s full run gave 9 of 18 failing with the ids named', async () => {
  const page = await openPlay();
  await el(page, 'play-send').dispatch('click');
  await settle();
  const text = allText(el(page, 'play-result-planted'));
  assert.ok(text.includes("The browser ran 7 of the ledger's 18 contracts. The other 11 start the ledger's command line, which a browser cannot do."), text);
  assert.ok(text.includes("The gate's full run on the same code gave 9 of 18 failing: R2.1, R2.2, R3.1, R4.1, R4.2, R5.1, R5.2, R5.3 and R5.4."), text);
  assert.doesNotMatch(text, DASHES);
});

test('R13.3 applying the fix runs "fixed", shows all seven alive and the risen receipt with MATCH and its pinned files re-hashed from the copies', async () => {
  const page = await openPlay();
  await el(page, 'play-fix').dispatch('click');
  await settle();
  await settle();
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].run, 'fixed');
  const box = el(page, 'play-result-fixed');
  assert.equal(box.hidden, false);
  const text = allText(box);
  assert.match(text, /Accepted/);
  assert.match(text, /All 7 contracts the browser ran pass/);
  const rows = find(box, (n) => n.tagName === 'LI' && n.className.split(/\s+/).includes('contract'));
  assert.equal(rows.length, 7);
  for (const r of rows) assert.ok(r.className.split(/\s+/).includes('pass') && /\bPASS\b/.test(r.textContent));
  assert.ok(text.includes("The browser ran 7 of the ledger's 18 contracts. The other 11 start the ledger's command line, which a browser cannot do."));
  assert.ok(text.includes("The gate's full run on the same code gave 18 of 18 passing."), text);

  // The risen receipt, checked in the browser: the hash recomputed, the pinned files re-hashed from the copies.
  const badge = find(box, (n) => n.className.split(/\s+/).includes('badge'));
  assert.equal(badge.length, 1);
  assert.equal(badge[0].textContent, 'MATCH');
  assert.ok(badge[0].className.split(/\s+/).includes('hash-match'));
  const receipt = JSON.parse(read('site/play/risen-receipt.json'));
  const pinned = new Set([receipt.requirements.path, ...receipt.contracts.map((c) => c.path), ...receipt.sources.map((s) => s.path), receipt.runners.path, ...receipt.frozen.map((f) => f.path)]);
  const files = find(box, (n) => n.tagName === 'LI' && n.className.split(/\s+/).includes('file'));
  assert.equal(files.length, pinned.size, 'every pinned file has a row');
  for (const f of files) {
    assert.ok(f.className.split(/\s+/).includes('status-match'), f.textContent);
    assert.match(f.textContent, /MATCH/);
  }
  assert.deepEqual(new Set(files.map((f) => /(\S+)$/.exec(f.textContent)[1])), pinned);
  assert.match(text, new RegExp(`All ${pinned.size} pinned files match`));
  assert.ok(page.requested.some((u) => u.endsWith('play/risen-receipt.json')));
  assert.ok(page.requested.every((u) => u.startsWith(SITE_URL)), 'every request goes to the page\'s own folder');
});

test('R13.4 changing one byte of src/split.js shows MISMATCH. Files changed: src/split.js. and marks only that file as different', async () => {
  const page = await openPlay();
  await el(page, 'play-byte').dispatch('click');
  await settle();
  await settle();
  assert.equal(page.calls.length, 0, 'the worker is not needed for a hash check');
  const box = el(page, 'play-result-byte');
  assert.equal(box.hidden, false);
  const lines = find(box, (n) => n.textContent === MISMATCH && n.children.length === 0);
  assert.equal(lines.length, 1, `one element holds exactly the line, the text was: ${allText(box)}`);
  const files = find(box, (n) => n.tagName === 'LI' && n.className.split(/\s+/).includes('file'));
  assert.equal(files.length, 1, 'only the changed file gets a row');
  assert.ok(files[0].className.split(/\s+/).includes('status-different'));
  assert.match(files[0].textContent, /DIFFERENT.*src\/split\.js/);
  assert.match(allText(box), /\d+ of \d+ pinned files match/);
  assert.match(allText(box), /nothing was stored/i);
});

test('R13.8 a run that cannot happen ends in one plain sentence and the gate\'s full run, the buttons come back, and nothing says running', async () => {
  const stopped = async ({ run }) => ({
    ok: false,
    run,
    kind: 'start',
    message: 'The browser could not start the worker that runs the contracts.',
    full: run === 'planted' ? { passed: 9, failed: 9, total: 18 } : { passed: 18, failed: 0, total: 18 },
  });
  const page = await openPlay({ runPlay: stopped });
  await el(page, 'play-send').dispatch('click');
  await settle();
  const planted = allText(el(page, 'play-result-planted'));
  assert.ok(planted.includes('The browser could not start the worker that runs the contracts.'));
  assert.ok(planted.includes("The gate's full run on the same code gave 9 of 18 failing: R2.1, R2.2, R3.1, R4.1, R4.2, R5.1, R5.2, R5.3 and R5.4."));
  assert.equal(find(el(page, 'play-result-planted'), (n) => n.className.split(/\s+/).includes('contract')).length, 0, 'no result rows for a run that did not happen');
  assert.doesNotMatch(planted, /7 of the ledger's 18/, 'the browser ran nothing, so it does not claim it did');
  await el(page, 'play-fix').dispatch('click');
  await settle();
  await settle();
  const fixed = allText(el(page, 'play-result-fixed'));
  assert.ok(fixed.includes("The gate's full run on the same code gave 18 of 18 passing."));
  for (const id of ['play-send', 'play-fix', 'play-byte']) assert.equal(el(page, id).disabled, false, `${id} is usable again`);
  assert.doesNotMatch(playText(page), /running/i, 'no step is left running');
  assert.doesNotMatch(allText(el(page, 'play-status')), /running/i);
  assert.equal(el(page, 'play-result-planted').getAttribute('aria-busy'), 'false');
});

test('R13.8 a run that throws, and a full run that cannot be loaded, are still one sentence and never "running"', async () => {
  const page = await openPlay({
    runPlay: async () => {
      throw new Error('boom');
    },
    missing: ['sample-buried.json'],
  });
  await el(page, 'play-send').dispatch('click');
  await settle();
  const text = allText(el(page, 'play-result-planted'));
  assert.match(text, /The run stopped with an error\./);
  assert.match(text, /could not be loaded/i);
  assert.doesNotMatch(text, /boom/, 'no engine text reaches the page');
  assert.equal(el(page, 'play-send').disabled, false);
  assert.doesNotMatch(playText(page), /running/i);
});

test('R13.8 while a run is going the buttons are off and the live region says so; it says what happened when the run ends', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const page = await openPlay({
    runPlay: async ({ run }) => {
      await gate;
      return { ok: true, run, results: PLANTED_RESULTS, ms: 1 };
    },
  });
  const click = el(page, 'play-send').dispatch('click');
  await settle();
  for (const id of ['play-send', 'play-fix', 'play-byte']) assert.equal(el(page, id).disabled, true, `${id} is off while a run goes`);
  assert.match(allText(el(page, 'play-status')), /Running/);
  assert.equal(el(page, 'play-result-planted').getAttribute('aria-busy'), 'true');
  release();
  await click;
  await settle();
  for (const id of ['play-send', 'play-fix', 'play-byte']) assert.equal(el(page, id).disabled, false);
  assert.match(allText(el(page, 'play-status')), /Step 1/);
  assert.match(allText(el(page, 'play-status')), /refuse/i);
  assert.doesNotMatch(allText(el(page, 'play-status')), /Running/);
});

test('R13.10 focus moves to each step\'s result, and the result is announced', async () => {
  const page = await openPlay();
  await el(page, 'play-send').dispatch('click');
  await settle();
  assert.equal(page.focused.at(-1), 'play-result-planted');
  await el(page, 'play-fix').dispatch('click');
  await settle();
  await settle();
  assert.equal(page.focused.at(-1), 'play-result-fixed');
  await el(page, 'play-byte').dispatch('click');
  await settle();
  await settle();
  assert.equal(page.focused.at(-1), 'play-result-byte');
  assert.match(allText(el(page, 'play-status')), /Step 3/);
  assert.match(allText(el(page, 'play-status')), /src\/split\.js/);
});

test('R13.10 text from a run (an assertion message) reaches the page as text, never as markup', async () => {
  const hostile = '<img src=x onerror=alert(1)> and <script>alert(2)</script>';
  const page = await openPlay({
    runPlay: async ({ run }) => ({ ok: true, run, results: SEVEN.map((id) => result(id, 'fail', hostile + ' ' + 'x'.repeat(5000))), ms: 1 }),
  });
  const made = [];
  const original = page.dom.document.createElement;
  page.dom.document.createElement = (tag) => (made.push(tag), original(tag));
  await el(page, 'play-send').dispatch('click');
  await settle();
  assert.ok(allText(el(page, 'play-result-planted')).includes('<img src=x'), 'the markup is shown as text');
  assert.ok(!made.some((t) => /^(img|script|iframe)$/i.test(t)), `elements made: ${made.join(', ')}`);
  const rows = find(el(page, 'play-result-planted'), (n) => n.tagName === 'LI' && n.className.split(/\s+/).includes('contract'));
  for (const r of rows) {
    const note = find(r, (n) => n.className.split(/\s+/).includes('note'));
    assert.equal(note.length, 1);
    assert.ok(note[0].textContent.length <= 130, `the preview is cut, it has ${note[0].textContent.length} characters`);
    const details = find(r, (n) => n.tagName === 'DETAILS');
    assert.equal(details.length, 1, 'the whole message is behind a details element');
    assert.ok(details[0].textContent.length < 2100, `the full message is capped, it has ${details[0].textContent.length} characters`);
    assert.ok(details[0].textContent.includes('<img src=x'), 'the full message is text too');
  }
});

test('R13.10 the play fetches nothing but files from its own folder, and the page start-up still loads one sample and nothing else', async () => {
  const page = await openPlay();
  for (const id of ['play-send', 'play-fix', 'play-byte']) await el(page, id).dispatch('click');
  await settle();
  await settle();
  assert.ok(page.requested.length > 0);
  for (const url of page.requested) assert.ok(url.startsWith(SITE_URL), `${url} is not from the page's own folder`);
});

test('R13.4 if the page cannot load its copies the one-byte step says so in one sentence and prints no MISMATCH', async () => {
  const page = await openPlay({ missing: ['play/src/split.js'] });
  await el(page, 'play-byte').dispatch('click');
  await settle();
  await settle();
  const text = allText(el(page, 'play-result-byte'));
  assert.doesNotMatch(text, /MISMATCH/);
  assert.match(text, /could not load/i);
  assert.equal(el(page, 'play-byte').disabled, false);
});

test('the sha of the copy that the one-byte step changes is not the pin (a sanity check of the premise)', () => {
  const receipt = JSON.parse(read('site/play/risen-receipt.json'));
  const pin = receipt.sources.find((s) => s.path === 'src/split.js').sha256;
  const bytes = fs.readFileSync(fileURLToPath(new URL('site/play/src/split.js', root)));
  assert.equal(sha(bytes), pin);
  const changed = new Uint8Array(bytes);
  changed[0] ^= 1;
  assert.notEqual(sha(changed), pin);
});

const LONG_MESSAGE = ['Expected values to be strictly deep-equal:', '+ actual - expected', '', '+ { ann: 333 }', '- { ann: 334 }', 'at line 9'].join('\n');
const classes = (n) => n.className.split(/\s+/);

test('R13.2 R13.5 a result reads the verdict first, then the 7 of 18 sentence, then the full-run line, and only then the contract rows', async () => {
  const page = await openPlay();
  await el(page, 'play-send').dispatch('click');
  await settle();
  const kids = el(page, 'play-result-planted').children.map((c) => classes(c)[0]);
  assert.deepEqual(kids, ['play-verdict', 'play-scope', 'play-full', 'contracts']);
  await el(page, 'play-fix').dispatch('click');
  await settle();
  await settle();
  assert.deepEqual(el(page, 'play-result-fixed').children.map((c) => classes(c)[0]), ['play-verdict', 'play-scope', 'play-full', 'contracts', 'play-receipt']);
  const stopped = await openPlay({ runPlay: async ({ run }) => ({ ok: false, run, kind: 'start', message: 'The browser could not start the worker that runs the contracts.', full: { passed: 9, failed: 9, total: 18 } }) });
  await el(stopped, 'play-send').dispatch('click');
  await settle();
  assert.deepEqual(el(stopped, 'play-result-planted').children.map((c) => classes(c)[0]), ['play-verdict', 'play-full']);
});

test('R13.5 the full-run line names what failed from the buried sample, and says only the count when the ids cannot be read', async () => {
  const page = await openPlay();
  await el(page, 'play-send').dispatch('click');
  await settle();
  assert.ok(page.requested.some((u) => u.endsWith('sample-buried.json')), 'the buried sample is the source');
  const full = find(el(page, 'play-result-planted'), (n) => classes(n).includes('play-full'));
  assert.equal(full.length, 1);
  assert.equal(full[0].textContent, "The gate's full run on the same code gave 9 of 18 failing: R2.1, R2.2, R3.1, R4.1, R4.2, R5.1, R5.2, R5.3 and R5.4.");
  // The counts come with the run (the loader could read the receipt), but this page cannot read the ids.
  const blind = await openPlay({
    runPlay: async ({ run }) => ({ ok: false, run, kind: 'start', message: 'The browser could not start the worker that runs the contracts.', full: { passed: 9, failed: 9, total: 18 } }),
    missing: ['sample-buried.json'],
  });
  await el(blind, 'play-send').dispatch('click');
  await settle();
  assert.ok(allText(el(blind, 'play-result-planted')).includes("The gate's full run on the same code gave 9 of 18 failing."));
});

test('R13.2 a failing row shows its name and the first three lines of its message, with the whole message in a details element in that row; a passing row stays one line', async () => {
  const page = await openPlay({
    runPlay: async ({ run }) => ({ ok: true, run, results: SEVEN.map((id) => result(id, id === 'R5.5' ? 'pass' : 'fail', id === 'R5.5' ? '' : LONG_MESSAGE)), ms: 1 }),
  });
  await el(page, 'play-send').dispatch('click');
  await settle();
  const rows = find(el(page, 'play-result-planted'), (n) => n.tagName === 'LI' && classes(n).includes('contract'));
  for (const r of rows.slice(0, 6)) {
    const note = find(r, (n) => classes(n).includes('note'));
    assert.equal(note.length, 1);
    assert.equal(note[0].textContent, 'Expected values to be strictly deep-equal:\n+ actual - expected\n+ { ann: 333 }', 'three lines, blank lines not counted');
    const details = find(r, (n) => n.tagName === 'DETAILS');
    assert.equal(details.length, 1, 'one details element in the row');
    assert.ok(!details[0].open, 'closed to start with');
    assert.equal(details[0].children[0].tagName, 'SUMMARY');
    assert.equal(details[0].children[1].textContent, LONG_MESSAGE, 'the full message is inside');
    assert.match(find(r, (n) => classes(n).includes('name'))[0].textContent, /^R\d\.\d /);
  }
  assert.deepEqual(rows[6].children.filter((c) => c.tagName !== '#TEXT').map((c) => c.tagName + '.' + c.className), ['SPAN.state', 'SPAN.name'], 'a passing row is a state and a name');
});

test('R13.3 the risen receipt\'s list of pinned files starts closed and its summary line says how many match', async () => {
  const page = await openPlay();
  await el(page, 'play-fix').dispatch('click');
  await settle();
  await settle();
  const details = find(el(page, 'play-result-fixed'), (n) => n.tagName === 'DETAILS');
  assert.equal(details.length, 1);
  assert.ok(!details[0].open, 'closed to start with');
  const summary = details[0].children[0];
  assert.equal(summary.tagName, 'SUMMARY');
  assert.match(summary.textContent, /^All \d+ pinned files match their copies\.$/);
  assert.equal(find(details[0], (n) => n.tagName === 'LI' && classes(n).includes('file')).length, Number(/\d+/.exec(summary.textContent)[0]));
  // One file that differs: the summary says so with the count.
  const lost = await openPlay({ missing: ['play/src/settle.js'] });
  await el(lost, 'play-fix').dispatch('click');
  await settle();
  await settle();
  const again = find(el(lost, 'play-result-fixed'), (n) => n.tagName === 'DETAILS')[0];
  assert.ok(!again.open);
  assert.match(again.children[0].textContent, /^\d+ of \d+ pinned files match their copies\. 1 could not be loaded\.$/);
});

test('R13.10 the status line stays a polite live region and is visually hidden by the style sheet', () => {
  const tag = tagAt('play-status');
  assert.match(tag, /\brole="status"/);
  assert.match(tag, /\baria-live="polite"/);
  assert.match(tag, /\bclass="[^"]*\bsr-only\b/, 'it uses the visually hidden class');
  assert.doesNotMatch(tag, /\bhidden\b/);
  assert.match(css, /\.sr-only\s*{[^}]*position:\s*absolute[^}]*clip:\s*rect\(0,? 0,? 0,? 0\)/);
  assert.doesNotMatch(css, /\.play-status[^{]*{[^}]*display:\s*none/, 'display none would keep it from being announced');
});

test('R13.9 R13.10 the play has a small scroll margin, and Try it here is filled differently from Copy', () => {
  assert.match(css, /\n\.play\s*{[^}]*scroll-margin-top:\s*1rem/);
  const strip = /\.try #strip-play\s*{([^}]*)}/g;
  const rules = [...css.matchAll(strip)].map((m) => m[1]).join('\n');
  assert.match(rules, /background:\s*var\(--alive\)/);
  assert.match(rules, /box-shadow:/);
  assert.doesNotMatch(css, /\.try #strip-copy\s*{[^}]*(background|box-shadow|padding)/, 'Copy is left alone');
});

// ---- the page in a headless browser ----

const SCREENS = [
  { name: '1280x800', width: 1280, height: 800, mobile: false },
  { name: '390x844', width: 390, height: 844, mobile: true },
];

test('R13.9 the start control is drawn in the first screen at 1280x800 and 390x844, at least 24 by 24, and the banner stays in the first screen at 1280x800', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const screen of SCREENS) {
      const m = await browser.measure(screen, () => {
        const r = (id) => {
          const b = document.getElementById(id).getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
        };
        const control = document.getElementById('strip-play');
        return {
          w: innerWidth,
          h: innerHeight,
          sideways: document.documentElement.scrollWidth,
          control: r('strip-play'),
          copy: r('strip-copy'),
          command: r('strip-command'),
          verdict: r('verdict'),
          text: control.textContent.trim(),
          shown: getComputedStyle(control).display !== 'none' && !control.hidden,
          playShown: getComputedStyle(document.getElementById('play')).display !== 'none',
        };
      });
      const at = screen.name;
      assert.ok(m.shown, `${at}: the control is drawn`);
      assert.equal(m.text, 'Try it here');
      assert.equal(m.playShown, false, `${at}: the play is closed on a first visit`);
      assert.ok(m.control.width >= 24 && m.control.height >= 24, `${at}: target ${m.control.width} x ${m.control.height}`);
      assert.ok(m.copy.width >= 24 && m.copy.height >= 24, `${at}: the copy button keeps its size`);
      assert.ok(m.control.top >= 0 && m.control.bottom <= m.h && m.control.left >= 0 && m.control.right <= m.w, `${at}: the control is inside the first screen`);
      // Revised 9.5 (Nov 12): the banner is required in the first screen at 1280x800 only. At 390x844 the start control (checked
      // above) and the result line take its place.
      if (screen.width > 800) assert.ok(m.verdict.top >= 0 && m.verdict.bottom <= m.h, `${at}: the banner ends at ${m.verdict.bottom} of ${m.h}`);
      assert.ok(m.sideways <= m.w, `${at}: sideways scroll`);
      // Not on top of the other controls.
      const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      assert.ok(!overlap(m.control, m.copy) && !overlap(m.control, m.command), `${at}: the control overlaps its neighbours`);
    }
  });
});

test('R13.9 with scripts off the start control is not drawn and the play is not either', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const screen of SCREENS) {
      const m = await browser.measure({ ...screen, scripts: false, settle: false }, () => ({
        control: getComputedStyle(document.getElementById('strip-play')).display,
        play: getComputedStyle(document.getElementById('play')).display,
        command: document.getElementById('strip-command').getBoundingClientRect().height > 0,
      }));
      assert.deepEqual(m, { control: 'none', play: 'none', command: true }, screen.name);
    }
  });
});

// Click through the three steps with the real worker and read what the page shows.
const playThrough = () =>
  (async () => {
    const wait = async (ok) => {
      for (let i = 0; i < 200; i += 1) {
        if (ok()) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };
    document.getElementById('strip-play').click();
    const out = { opened: !document.getElementById('play').hidden };
    for (const [button, result] of [['play-send', 'play-result-planted'], ['play-fix', 'play-result-fixed'], ['play-byte', 'play-result-byte']]) {
      document.getElementById(button).click();
      out[`${result}-done`] = await wait(() => !document.getElementById(result).hidden && !document.getElementById(button).disabled);
      out[`${result}-focus`] = document.activeElement && document.activeElement.id;
      const box = document.getElementById(result);
      out[result] = box.innerText.replace(/[ \t]+/g, ' ').trim();
      out[`${result}-rows`] = [...box.querySelectorAll('li.contract')].map((li) => ({ cls: li.className, text: li.textContent.replace(/\s+/g, ' ').trim() }));
    }
    const r = (id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, height: b.height };
    };
    out.strip = r('strip');
    out.play = r('play');
    out.evidence = r('evidence');
    out.sideways = document.documentElement.scrollWidth;
    out.width = innerWidth;
    out.buttons = [...document.querySelectorAll('#play button')].map((b) => {
      const box = b.getBoundingClientRect();
      return [Math.round(box.width), Math.round(box.height)];
    });
    return out;
  })();

test('R13.2 R13.3 R13.4 R13.5 R13.10 in a browser the three steps run the real worker: refused, accepted, then MISMATCH, with no sideways scroll at 390 px', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const screen of SCREENS) {
      const m = await browser.measure({ ...screen, settle: true }, playThrough);
      const at = screen.name;
      assert.ok(m.opened, `${at}: the control opens the play`);
      for (const k of ['play-result-planted', 'play-result-fixed', 'play-result-byte']) assert.ok(m[`${k}-done`], `${at}: ${k} finished`);
      assert.equal(m['play-result-planted-focus'], 'play-result-planted');
      assert.equal(m['play-result-fixed-focus'], 'play-result-fixed');
      assert.equal(m['play-result-byte-focus'], 'play-result-byte');
      const planted = m['play-result-planted-rows'];
      assert.deepEqual(planted.map((x) => /R\d\.\d/.exec(x.text)[0]), SEVEN);
      assert.deepEqual(planted.map((x) => (/\bfail\b/.test(x.cls) ? 'fail' : 'pass')), ['fail', 'fail', 'fail', 'fail', 'fail', 'fail', 'pass']);
      assert.match(m['play-result-planted'], /Refused/);
      assert.match(m['play-result-planted'], /7 of the ledger's 18 contracts/);
      assert.match(m['play-result-planted'], /9 of 18 failing: R2\.1, R2\.2, R3\.1, R4\.1, R4\.2, R5\.1, R5\.2, R5\.3 and R5\.4/);
      assert.deepEqual(m['play-result-fixed-rows'].map((x) => (/\bpass\b/.test(x.cls) ? 'pass' : 'fail')), Array(7).fill('pass'));
      assert.match(m['play-result-fixed'], /Accepted/);
      assert.match(m['play-result-fixed'], /MATCH/);
      assert.match(m['play-result-fixed'], /18 of 18 passing/);
      assert.ok(m['play-result-byte'].includes(MISMATCH), m['play-result-byte']);
      assert.ok(m.strip.bottom <= m.play.top + 0.5 && m.play.bottom <= m.evidence.top + 0.5, `${at}: the play sits directly below the strip`);
      assert.ok(m.sideways <= m.width, `${at}: the page scrolls sideways (${m.sideways} in ${m.width})`);
      for (const [w, h] of m.buttons) assert.ok(w >= 24 && h >= 24, `${at}: a play button is ${w} x ${h}`);
    }
  });
});

test('R13.10 under prefers-reduced-motion: reduce the play results appear with no animation', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    const probe = async () => {
      document.getElementById('strip-play').click();
      document.getElementById('play-send').click();
      for (let i = 0; i < 200 && document.getElementById('play-result-planted').hidden; i += 1) await new Promise((r) => setTimeout(r, 100));
      const rows = [...document.querySelectorAll('#play li.contract')];
      return {
        rows: rows.length,
        running: document.getElementById('play').getAnimations({ subtree: true }).length,
        names: [...new Set(rows.map((li) => getComputedStyle(li).animationName))],
        opacities: [...new Set(rows.map((li) => getComputedStyle(li).opacity))],
        smooth: getComputedStyle(document.documentElement).scrollBehavior,
      };
    };
    const reduced = await browser.measure({ width: 390, height: 844, mobile: true, reducedMotion: true, settle: false }, probe);
    assert.equal(reduced.rows, 7);
    assert.equal(reduced.running, 0);
    assert.deepEqual(reduced.names, ['none']);
    assert.deepEqual(reduced.opacities, ['1']);
    assert.equal(reduced.smooth, 'auto');
  });
});
