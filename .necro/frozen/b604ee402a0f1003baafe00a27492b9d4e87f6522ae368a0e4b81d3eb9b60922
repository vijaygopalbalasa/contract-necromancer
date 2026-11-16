// Contracts for the demo video link of Requirement 10.3 (revised Nov 16): the page's video link is the same URL as the first
// youtu.be link in README.md, so the page and the README never point at different cuts. The video is replaced before Dec 1.
//
// Both tests pass now and keep passing after the final cut is uploaded and the page and both README links are changed.
// The first checks the page's link against the first youtu.be link in README.md. The second checks that every youtu.be link
// in README.md (there are two, in the "Try it in one command" paragraph and in the links list) is the page's link. Neither
// names a cut, and no contract here fails on purpose: CI runs every contract file. A person ticks the task "Point the page's
// demo video link at the final cut (Req 10.3)" only after the final video is uploaded and the page link and both README
// links are changed.
//
// Plain file reads, no browser. The page file is named below the way a static import would name it, because the receipt
// pins files it finds that way. Keep this line.
//   import {} from '../../site/app.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const html = read('site/index.html');
const readme = read('README.md');

const YOUTU = /https:\/\/youtu\.be\/[\w-]+/g;

// The page's video link: the anchor in the How it works section whose words say video.
function pageVideoLink() {
  const how = html.slice(html.lastIndexOf('<section', html.indexOf('id="how"')), html.indexOf('</section>', html.indexOf('id="how"')));
  const anchors = [...how.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].filter((m) => /video/i.test(m[2].replace(/<[^>]*>/g, '')));
  assert.equal(anchors.length, 1, 'How it works has exactly one link that says video');
  return anchors[0][1];
}

test('R10.3 the page\'s demo video link is the same URL as the first youtu.be link in README.md, and the page has no other youtu.be link', () => {
  const first = readme.match(YOUTU)?.[0];
  assert.ok(first, 'README.md has a youtu.be link');
  assert.equal(pageVideoLink(), first);
  assert.deepEqual(html.match(YOUTU), [first], 'the page has one youtu.be link and it is that one');
});

test('R10.3 every youtu.be link in README.md is the page\'s video link, before and after the final cut replaces the earlier one', () => {
  const links = readme.match(YOUTU) || [];
  assert.ok(links.length >= 2, `README.md has its two youtu.be links (found ${links.length})`);
  const page = pageVideoLink();
  assert.deepEqual([...new Set(links)], [page], 'every README link is the page\'s link: when the video is replaced, change the page and both README links together');
});
