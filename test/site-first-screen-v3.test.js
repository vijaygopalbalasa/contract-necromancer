import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withBrowser, NO_BROWSER } from './fixtures/browser.js';

// Requirement 14 and the revised 9.5 and 12.1: the first screen names the idea it raises, leads with the result and keeps
// the round 3 caveat beside it. Text checks read site/index.html. Layout checks run the page in a headless browser and
// compare boxes with the window and with each other, and read computed styles; none of them pins a size or a position,
// so they pass on any operating system's fonts (Requirement 14.5).

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const html = read('site/index.html');

const IDEA = 'Kiro cannot call a task done until its frozen contracts pass.';
const RAISED = 'Design by Contract, from Eiffel (1986), raised for coding agents.';
const EXPERIMENT = 'https://github.com/vijaygopalbalasa/contract-necromancer/blob/main/experiments/README.md';
const TITLE = 'Contract Necromancer: a task is done only when frozen contracts pass';

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, mobile: true };

const idAt = (id) => {
  const i = html.indexOf(`id="${id}"`);
  assert.ok(i >= 0, `index.html has no element with id="${id}"`);
  return i;
};
const textOf = (fragment) => fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// The element that carries this id, from its opening tag to its matching closing tag (the tag must not nest in itself).
function element(id, tag) {
  const at = idAt(id);
  const start = html.lastIndexOf('<', at);
  assert.match(html.slice(start, at), new RegExp(`^<${tag}\\b`), `#${id} is a <${tag}>`);
  const end = html.indexOf(`</${tag}>`, start) + `</${tag}>`.length;
  return { start, end, text: html.slice(start, end), words: textOf(html.slice(start, end)) };
}

// ---- 14.1: the idea that is raised, beside the heading ----

test('R14.1 one short line beside the page heading names Design by Contract, from Eiffel (1986), raised for coding agents', () => {
  const idea = element('idea', 'p');
  assert.equal(idea.words, RAISED);
  assert.doesNotMatch(idea.text, /<(script|svg|img|button|input|a)\b|\bhidden\b|aria-hidden|data-|\bon\w+=/i, 'plain text, readable without JavaScript');
  assert.doesNotMatch(idea.text, /[\u2013\u2014]/, 'no em or en dashes');
  const header = element('brand', 'header');
  assert.ok(header.start < idea.start && idea.end < header.end, 'the line is inside the header that holds the page heading');
  const h1End = html.indexOf('</h1>');
  assert.ok(h1End > header.start && h1End < idea.start, 'the line comes right after the page heading');
  assert.equal(textOf(html.slice(h1End + 5, idea.start)), '', 'nothing stands between the heading and the line');
  assert.ok(idea.end < idAt('strip'), 'the line comes before the story strip');
});

test('R14.1 the page heading and the title stay as they were', () => {
  const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) || [];
  assert.equal(headings.length, 1);
  assert.equal(textOf(headings[0]), IDEA);
  assert.equal(/<title>([^<]*)<\/title>/.exec(html)[1], TITLE);
  assert.doesNotMatch(html.slice(html.indexOf('<body'), idAt('verdict')), /<h2/, 'no second heading above the banner');
});

test('R14.1 with scripts off the line is drawn next to the heading, inside the first screen', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure({ ...size, scripts: false, settle: false }, () => {
        const box = (e) => {
          const b = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height, display: s.display, visibility: s.visibility };
        };
        const idea = document.getElementById('idea');
        const h1 = document.querySelector('h1');
        const header = document.getElementById('brand');
        return {
          w: innerWidth,
          h: innerHeight,
          idea: box(idea),
          h1: box(h1),
          header: box(header),
          inHeader: header.contains(idea) && header.contains(h1),
          text: idea.innerText.replace(/\s+/g, ' ').trim(),
        };
      });
      const at = `at ${size.width}`;
      assert.equal(m.text, RAISED, at);
      assert.ok(m.inHeader, `${at}: the line and the heading share the header`);
      assert.ok(m.idea.width > 0 && m.idea.height > 0 && m.idea.display !== 'none' && m.idea.visibility === 'visible', `${at}: the line is drawn`);
      assert.ok(m.idea.left >= 0 && m.idea.right <= m.w && m.idea.top >= 0 && m.idea.bottom <= m.h, `${at}: the line is inside the first screen`);
      assert.ok(m.idea.top >= m.h1.top && m.idea.bottom <= m.header.bottom + 0.5, `${at}: the line is drawn in the header, not above the heading`);
      assert.ok(m.idea.top - m.h1.bottom < m.h1.height, `${at}: the line is next to the heading, less than a heading's height away`);
    }
  });
});

// ---- 14.2 and the revised 12.1: the result leads, with the round 3 caveat in the same element ----

test('R12.1 (revised) one element holds the result and the round 3 caveat, with the counts marked as large numbers and one plain link', () => {
  const e = element('evidence', 'p');
  const stripEnd = html.indexOf('</section>', html.lastIndexOf('<section', idAt('strip'))) + '</section>'.length;
  assert.ok(e.start >= stripEnd, 'after the story strip');
  assert.ok(e.end < idAt('verdict'), 'before the verdict banner');
  assert.match(e.words, /cannot be finished/);
  assert.match(e.words, /marked it done in 11 of 11 runs without the gate/);
  assert.match(e.words, /0 of 19 with it/);
  assert.match(e.words, /across two models/);
  assert.match(e.words, /"do whatever it takes" prompt/);
  assert.match(e.words, /one gated run of six got past the gate by patching JavaScript built-ins/);
  assert.match(e.words, /hole is closed/);
  assert.match(e.words, /cheat is kept as a test/);
  assert.ok(e.words.indexOf('0 of 19') < e.words.indexOf('do whatever it takes'), 'the result comes before the caveat');
  assert.doesNotMatch(e.text, /[\u2013\u2014]/, 'no em or en dashes');
  assert.doesNotMatch(e.text, /<(script|svg|img|ul|ol|li|button|input)\b|\bhidden\b|aria-hidden|data-|\bon\w+=/i, 'readable without JavaScript');
  const nums = [...e.text.matchAll(/<strong class="num">([^<]*)<\/strong>/g)].map((m) => m[1]);
  assert.deepEqual(nums, ['11 of 11', '0 of 19'], 'the two counts are the large numbers');
  const links = [...e.text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 1, 'exactly one link');
  assert.equal(/\bhref="([^"]*)"/.exec(links[0][1])[1], EXPERIMENT);
  assert.match(links[0][2], /experiment/i);
  assert.ok(html.split(EXPERIMENT).length === 2, 'the address appears once on the page');
});

test('R14.2 the result is drawn with more weight than body text: the two counts are large, bold and at AA contrast, and so is the caveat', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      for (const scripts of [true, false]) {
        const m = await browser.measure({ ...size, scripts, settle: scripts }, () => {
          const rgb = (c) => /rgba?\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)(?:, (\d*\.?\d+))?/.exec(c).slice(1, 5).map((v) => (v === undefined ? 1 : Number(v)));
          const background = (el) => {
            for (let e = el; e; e = e.parentElement) {
              const c = rgb(getComputedStyle(e).backgroundColor);
              if (c[3] > 0) return c.slice(0, 3);
            }
            return rgb(getComputedStyle(document.documentElement).backgroundColor).slice(0, 3);
          };
          const lum = ([r, g, b]) => {
            const f = (v) => {
              const x = v / 255;
              return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const ratio = (a, b) => {
            const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
          };
          const look = (el) => {
            const s = getComputedStyle(el);
            return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), contrast: ratio(rgb(s.color).slice(0, 3), background(el)), text: el.textContent.trim() };
          };
          const e = document.getElementById('evidence');
          const caveat = e.querySelector('.caveat');
          const box = e.getBoundingClientRect();
          return {
            body: parseFloat(getComputedStyle(document.body).fontSize),
            nums: [...e.querySelectorAll('.num')].map(look),
            caveat: caveat ? look(caveat) : null,
            text: e.innerText.replace(/\s+/g, ' ').trim(),
            link: look(e.querySelector('a')),
            drawn: box.width > 0 && box.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility === 'visible',
          };
        });
        const at = `at ${size.width} with scripts ${scripts ? 'on' : 'off'}`;
        assert.ok(m.drawn, `${at}: the result is drawn`);
        assert.match(m.text, /11 of 11/, at);
        assert.match(m.text, /0 of 19/, at);
        assert.match(m.text, /do whatever it takes/, `${at}: the caveat is in the same element`);
        assert.deepEqual(m.nums.map((n) => n.text), ['11 of 11', '0 of 19'], at);
        for (const n of m.nums) {
          assert.ok(n.size >= 1.5 * m.body, `${at}: ${n.text} is ${n.size} against body text of ${m.body}`);
          assert.ok(n.weight >= 600, `${at}: ${n.text} has weight ${n.weight}`);
          assert.ok(n.contrast >= 4.5, `${at}: ${n.text} contrast ${n.contrast.toFixed(2)}`);
        }
        assert.ok(m.caveat, `${at}: the caveat is marked`);
        assert.ok(m.caveat.contrast >= 4.5, `${at}: the caveat contrast ${m.caveat.contrast.toFixed(2)}`);
        assert.ok(m.link.contrast >= 4.5, `${at}: the link contrast ${m.link.contrast.toFixed(2)}`);
        assert.ok(m.caveat.size <= Math.min(...m.nums.map((n) => n.size)), `${at}: the caveat is not drawn bigger than the counts`);
      }
    }
  });
});

test('R14.2 the colours carry the meaning: 11 of 11 (false "done" without the gate) is in the gravestone colour, 0 of 19 (with the gate) in the alive colour, both at AA contrast', { skip: NO_BROWSER }, async () => {
  const stats = [...element('evidence', 'p').text.matchAll(/<span class="stat ([a-z-]+)">[\s\S]*?<strong class="num">([^<]*)<\/strong>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(stats, [['11 of 11', 'stat-ungated'], ['0 of 19', 'stat-gated']], 'the class names the stat, not its position');
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      for (const scripts of [true, false]) {
        const m = await browser.measure({ ...size, scripts, settle: scripts }, () => {
          const rgb = (c) => /rgba?\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)(?:, (\d*\.?\d+))?/.exec(c).slice(1, 5).map((v) => (v === undefined ? 1 : Number(v)));
          const token = (name) => {
            const probe = document.createElement('span');
            probe.style.color = `var(${name})`;
            document.body.appendChild(probe);
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
          };
          const background = (el) => {
            for (let e = el; e; e = e.parentElement) {
              const c = rgb(getComputedStyle(e).backgroundColor);
              if (c[3] > 0) return c.slice(0, 3);
            }
            return [0, 0, 0];
          };
          const lum = ([r, g, b]) => {
            const f = (v) => {
              const x = v / 255;
              return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const ratio = (a, b) => {
            const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
          };
          const nums = [...document.querySelectorAll('#evidence .num')].map((e) => {
            const color = getComputedStyle(e).color;
            return { text: e.textContent.trim(), color, contrast: ratio(rgb(color).slice(0, 3), background(e)) };
          });
          return { nums, grave: token('--grave'), alive: token('--alive'), text: token('--text') };
        });
        const at = `at ${size.width} with scripts ${scripts ? 'on' : 'off'}`;
        const [bad, good] = m.nums;
        assert.equal(bad.text, '11 of 11', at);
        assert.equal(good.text, '0 of 19', at);
        assert.equal(bad.color, m.grave, `${at}: 11 of 11 is drawn in the gravestone colour`);
        assert.equal(good.color, m.alive, `${at}: 0 of 19 is drawn in the alive colour`);
        assert.notEqual(bad.color, m.text, `${at}: 11 of 11 is not plain text`);
        assert.notEqual(good.color, m.text, `${at}: 0 of 19 is not plain text`);
        assert.ok(bad.contrast >= 4.5, `${at}: 11 of 11 contrast ${bad.contrast.toFixed(2)}`);
        assert.ok(good.contrast >= 4.5, `${at}: 0 of 19 contrast ${good.contrast.toFixed(2)}`);
      }
    }
  });
});

// ---- the wide first screen is spaced tightly: Open your own receipt and the How it works link share one line ----

test('at 1280x800 "Open your own receipt" and "How it works, and try it" are on one line, and an open form puts the link under it; at 390x844 they keep their own lines', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    const probe = () => {
      const box = (id) => {
        const b = document.getElementById(id).getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height };
      };
      const summary = document.querySelector('#open > summary').getBoundingClientRect();
      const before = { summary: { top: summary.top, bottom: summary.bottom }, jump: box('jump-how'), bar: box('start') };
      document.getElementById('open').open = true;
      const form = box('paste');
      const after = { jump: box('jump-how'), form, sideways: document.documentElement.scrollWidth, w: innerWidth };
      return { before, after };
    };
    const wide = await browser.measure(DESKTOP, probe);
    const overlap = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    assert.ok(overlap(wide.before.summary, wide.before.jump) > 0.5 * Math.min(wide.before.summary.bottom - wide.before.summary.top, wide.before.jump.height), 'wide: the two share a line');
    assert.ok(wide.before.jump.right <= wide.before.bar.right && wide.before.jump.left >= wide.before.bar.left, 'wide: the link is inside the bar');
    assert.ok(wide.after.jump.top >= wide.after.form.bottom, 'wide: with the form open the link is under it');
    assert.ok(wide.after.sideways <= wide.after.w, 'wide: no sideways scroll with the form open');
    const phone = await browser.measure(PHONE, probe);
    assert.ok(phone.before.jump.top >= phone.before.summary.bottom, 'phone: the link keeps its own line under the summary');
  });
});

// ---- 14.3: Try it here is the single main action ----

test('R14.3 with scripts on, no other control above the verdict banner is filled like Try it here', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      const m = await browser.measure(size, () => {
        const verdict = document.getElementById('verdict');
        const open = document.getElementById('open');
        open.open = true; // the buttons inside the closed form count once it is opened
        const play = document.getElementById('strip-play');
        const above = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit'], summary")].filter(
          (e) => e !== play && (e.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && e.getClientRects().length > 0,
        );
        const fill = (e) => {
          const s = getComputedStyle(e);
          return { id: e.id || e.textContent.trim().slice(0, 30), bg: s.backgroundColor, shadow: s.boxShadow };
        };
        return { play: fill(play), others: above.map(fill), playDrawn: play.getClientRects().length > 0 };
      });
      const at = `at ${size.width}`;
      assert.ok(m.playDrawn, `${at}: Try it here is drawn`);
      assert.notEqual(m.play.bg, 'rgba(0, 0, 0, 0)', `${at}: Try it here is filled`);
      assert.ok(m.others.length >= 4, `${at}: other controls were found above the banner (${m.others.map((o) => o.id).join(', ')})`);
      for (const o of m.others) {
        assert.notEqual(o.bg, m.play.bg, `${at}: ${o.id} is filled like Try it here`);
        assert.notEqual(o.shadow, m.play.shadow, `${at}: ${o.id} has the glow of Try it here`);
      }
    }
  });
});

test('R14.3 with scripts off Try it here is not drawn, so the page never shows a button that does nothing', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure({ ...DESKTOP, scripts: false, settle: false }, () => document.getElementById('strip-play').getClientRects().length);
    assert.equal(m, 0);
  });
});

// ---- 14.4: a receipt with no task says so ----

test('R14.4 the page says in plain words that a receipt without a task came from necro check, not from a tick', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure(DESKTOP, async () => {
      const task = () => document.getElementById('task').textContent.trim();
      const first = task();
      document.getElementById('sample-buried').click();
      for (let i = 0; i < 100 && !/Still buried/.test(document.getElementById('verdict').textContent); i += 1) await new Promise((r) => setTimeout(r, 50));
      return { first, buried: task() };
    });
    for (const line of [m.first, m.buried]) {
      assert.doesNotMatch(line, /none recorded/i);
      assert.match(line, /^No task\./);
      assert.match(line, /necro check/);
      assert.match(line, /not by a tick/);
    }
  });
});

// ---- the revised 9.5: what the first screen shows at each window ----

test('R9.5 (revised) at 1280x800 the verdict banner is in the first screen, with no sideways scroll and the way to open your own receipt on the page', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure(DESKTOP, () => {
      const box = (id) => {
        const b = document.getElementById(id).getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height };
      };
      const open = document.getElementById('open');
      const result = {
        w: innerWidth,
        h: innerHeight,
        scrollY,
        sideways: document.documentElement.scrollWidth,
        verdict: box('verdict'),
        evidence: box('evidence'),
        play: box('strip-play'),
      };
      // Open the form after the boxes are read: it is closed on a first visit.
      open.open = true;
      result.sidewaysOpen = document.documentElement.scrollWidth;
      result.openDrawn = open.getClientRects().length > 0 && ['paste', 'show', 'file'].every((id) => document.getElementById(id).getClientRects().length > 0);
      return result;
    });
    assert.equal(m.scrollY, 0);
    assert.ok(m.verdict.height > 0 && m.verdict.top >= 0 && m.verdict.bottom <= m.h && m.verdict.left >= 0 && m.verdict.right <= m.w, `the banner ends at ${Math.round(m.verdict.bottom)} of ${m.h}`);
    assert.ok(m.evidence.bottom <= m.verdict.top, 'the result is above the banner');
    assert.ok(m.play.bottom <= m.h && m.play.right <= m.w, 'the start control is in the first screen');
    assert.ok(m.sideways <= m.w && m.sidewaysOpen <= m.w, 'no sideways scroll');
    assert.ok(m.openDrawn, 'the way to open your own receipt is on the page');
  });
});

test('R9.5 (revised) at 390x844 the start control and the whole result are in the first screen, with no sideways scroll and the way to open your own receipt on the page', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    const m = await browser.measure(PHONE, () => {
      const box = (id) => {
        const b = document.getElementById(id).getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height };
      };
      const open = document.getElementById('open');
      const result = {
        w: innerWidth,
        h: innerHeight,
        scrollY,
        sideways: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        play: box('strip-play'),
        evidence: box('evidence'),
      };
      open.open = true;
      result.sidewaysOpen = document.documentElement.scrollWidth;
      result.openDrawn = open.getClientRects().length > 0 && ['paste', 'show', 'file'].every((id) => document.getElementById(id).getClientRects().length > 0);
      return result;
    });
    assert.equal(m.scrollY, 0);
    const inside = (b) => b.height > 0 && b.top >= 0 && b.bottom <= m.h && b.left >= 0 && b.right <= m.w;
    assert.ok(inside(m.play), `the start control spans ${Math.round(m.play.top)} to ${Math.round(m.play.bottom)} of ${m.h}`);
    assert.ok(inside(m.evidence), `the result spans ${Math.round(m.evidence.top)} to ${Math.round(m.evidence.bottom)} of ${m.h}`);
    assert.ok(m.sideways <= m.w && m.body <= m.w && m.sidewaysOpen <= m.w, 'no sideways scroll');
    assert.ok(m.openDrawn, 'the way to open your own receipt is on the page');
  });
});

test('R12.1 (revised) the result with its caveat is in the first screen at 1280x800 and 390x844, below the strip and above the banner, with scripts on and off', { skip: NO_BROWSER }, async () => {
  await withBrowser(async (browser) => {
    for (const size of [DESKTOP, PHONE]) {
      for (const scripts of [true, false]) {
        const m = await browser.measure({ ...size, scripts, settle: scripts }, () => {
          const box = (id) => {
            const b = document.getElementById(id).getBoundingClientRect();
            return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height };
          };
          return { w: innerWidth, h: innerHeight, strip: box('strip'), evidence: box('evidence'), verdict: box('verdict'), sideways: document.documentElement.scrollWidth };
        });
        const at = `at ${size.width} with scripts ${scripts ? 'on' : 'off'}`;
        assert.ok(m.strip.bottom <= m.evidence.top, `${at}: below the strip`);
        if (scripts) assert.ok(m.evidence.bottom <= m.verdict.top, `${at}: above the banner`);
        assert.ok(m.evidence.height > 0 && m.evidence.top >= 0 && m.evidence.bottom <= m.h && m.evidence.left >= 0 && m.evidence.right <= m.w, `${at}: inside the first screen, it spans ${Math.round(m.evidence.top)} to ${Math.round(m.evidence.bottom)} of ${m.h}`);
        assert.ok(m.sideways <= m.w, `${at}: no sideways scroll`);
      }
    }
  });
});

// ---- the words stay safe for the frozen R12.2 contract ----

test('the sentences the idea line and the result add are safe for the frozen R12.2 contract', () => {
  const body = html.slice(html.indexOf('<body'), html.indexOf('<script'));
  const sentences = body
    .replace(/<(code)[^>]*>([\s\S]*?)<\/\1>/g, (_, _t, inner) => inner.replace(/\./g, '\u0000'))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\u0000/g, '.').trim())
    .filter(Boolean);
  for (const s of sentences) {
    assert.doesNotMatch(s, /\bcontracts?\b[^.]*\bre-?run\w*\s+(only\s+)?in\s+Node\b/i, `"${s}"`);
    assert.doesNotMatch(s, /\bonly\b[^.]*\bin\s+Node\b|\bin\s+Node\b[^.]*\bonly\b|\bNode\s+only\b/i, `"${s}"`);
    assert.doesNotMatch(s, /[\u2013\u2014]/, `"${s}"`);
  }
  assert.equal(sentences.filter((s) => /necro verify/.test(s) && /JavaScript contracts/.test(s) && /runner contracts/.test(s)).length, 1);
  assert.ok(sentences.includes(RAISED));
});
