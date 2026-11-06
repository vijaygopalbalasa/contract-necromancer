import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDom, findAll } from './fixtures/fake-dom.js';
import { start } from '../site/app.js';
import { MAX_RECEIPT_BYTES } from '../site/lib/receipt.js';
import { computeReceiptHash } from '../site/lib/canon.js';

const fixtureText = fs.readFileSync(new URL('./fixtures/receipt-valid.json', import.meta.url), 'utf8');
const fixture = () => JSON.parse(fixtureText);
const RAW = 'https://raw.githubusercontent.com/o/n/main/r.json';

// A page with injected fetch, location and clipboard. `fetchMap` maps URL to a Response (or a function returning one).
function page({ search = '', fetchMap = {}, clipboard } = {}) {
  const dom = createDom();
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const hit = fetchMap[String(url)];
    if (hit === undefined) return new Response('Not Found', { status: 404 });
    if (hit instanceof Error) throw hit;
    return typeof hit === 'function' ? hit() : hit;
  };
  const navigator = { clipboard };
  const location = { search, href: `https://example.test/${search}` };
  const ready = start({ document: dom.document, location, fetch, navigator });
  return { ...dom, calls, ready, text: (id) => dom.el(id).textContent };
}

async function paste(p, text) {
  p.el('paste').value = text;
  await p.el('show').dispatch('click');
}

const rows = (p) => findAll(p.el('groups'), (e) => e.classList.contains('contract'));
const headings = (p) => findAll(p.el('groups'), (e) => e.tagName === 'H3').map((e) => e.textContent);

// ---- 1.1: paste and file pick ----

test('pasting valid receipt JSON and pressing Show renders spec, commit, receipt hash and a row per contract', async () => {
  const p = page();
  await p.ready;
  assert.equal(p.el('receipt').hidden, true);
  await paste(p, fixtureText);
  const r = fixture();
  assert.equal(p.el('receipt').hidden, false);
  assert.equal(p.text('spec'), r.spec);
  assert.equal(p.text('commit'), r.gitCommit);
  assert.equal(p.text('receipt-hash'), r.receiptHash);
  assert.equal(p.text('created'), r.createdAt);
  assert.equal(p.text('error'), '');
  const list = rows(p);
  assert.equal(list.length, r.contracts.length);
  for (const [i, c] of r.contracts.entries()) {
    assert.ok(list[i].textContent.includes(c.name), c.name);
    assert.match(list[i].textContent, c.result === 'pass' ? /\bPASS\b/ : /\bFAIL\b/);
  }
  assert.equal(p.text('summary'), `${r.contracts.length} of ${r.contracts.length} contracts pass`);
});

test('a failing contract shows FAIL and counts against the summary', async () => {
  const p = page();
  const r = fixture();
  r.task = null;
  r.contracts[1].result = 'fail';
  await paste(p, JSON.stringify(r));
  const list = rows(p);
  assert.match(list[1].textContent, /\bFAIL\b/);
  assert.ok(list[1].classList.contains('fail'));
  assert.ok(list[0].classList.contains('pass'));
  assert.equal(p.text('summary'), '2 of 3 contracts pass');
});

test('choosing a receipt file renders the same as pasting', async () => {
  const p = page();
  p.el('file').files = [{ size: fixtureText.length, text: async () => fixtureText }];
  await p.el('file').dispatch('change');
  assert.equal(p.text('spec'), fixture().spec);
  assert.equal(rows(p).length, 3);
});

test('a file over the size limit is refused before it is read', async () => {
  const p = page();
  let read = false;
  p.el('file').files = [{ size: MAX_RECEIPT_BYTES + 1, text: async () => ((read = true), fixtureText) }];
  await p.el('file').dispatch('change');
  assert.equal(read, false);
  assert.match(p.text('error'), /larger than 1 MB/);
  assert.equal(p.el('receipt').hidden, true);
});

test('a file that cannot be read shows one plain sentence', async () => {
  const p = page();
  p.el('file').files = [
    {
      size: 10,
      text: async () => {
        throw new Error('boom');
      },
    },
  ];
  await p.el('file').dispatch('change');
  assert.equal(p.text('error'), 'Could not read that file. Choose a receipt file written by necro.');
});

test('choosing no file does nothing', async () => {
  const p = page();
  p.el('file').files = [];
  await p.el('file').dispatch('change');
  assert.equal(p.text('error'), '');
});

// ---- 1.3: invalid input ----

test('invalid input puts one sentence in the alert element and clears a previous receipt', async () => {
  const p = page();
  await paste(p, fixtureText);
  assert.equal(rows(p).length, 3);
  await paste(p, 'not json');
  assert.equal(p.text('error'), 'This is not valid JSON. Paste the contents of a file from .necro/receipts/.');
  assert.equal(p.el('error').getAttribute('role'), 'alert');
  assert.equal(p.el('receipt').hidden, true);
  assert.equal(p.el('hash-check').hidden, true);
  assert.equal(rows(p).length, 0);
  assert.equal(p.text('spec'), '');
  // a good receipt afterwards clears the message
  await paste(p, fixtureText);
  assert.equal(p.text('error'), '');
  assert.equal(rows(p).length, 3);
});

// ---- 1.2: ?receipt= ----

test('?receipt= fetches exactly that URL without credentials, renders it, and prefills the repository box', async () => {
  const p = page({ search: `?receipt=${encodeURIComponent(RAW)}`, fetchMap: { [RAW]: new Response(fixtureText) } });
  await p.ready;
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].url, RAW);
  assert.equal(p.calls[0].options.credentials, 'omit');
  assert.equal(p.calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(p.text('spec'), fixture().spec);
  assert.equal(p.el('repo').value, 'o/n');
});

test('a bad ?receipt= shows the message and fetches nothing', async () => {
  const p = page({ search: `?receipt=${encodeURIComponent('https://evil.example/r.json')}` });
  await p.ready;
  assert.equal(p.calls.length, 0);
  assert.match(p.text('error'), /raw\.githubusercontent\.com/);
  assert.equal(p.el('receipt').hidden, true);
});

test('a failed ?receipt= fetch shows one plain sentence', async () => {
  for (const hit of [new TypeError('offline'), new Response('nope', { status: 404 })]) {
    const p = page({ search: `?receipt=${encodeURIComponent(RAW)}`, fetchMap: { [RAW]: hit } });
    await p.ready;
    assert.equal(p.text('error'), 'Could not load that receipt. Check the link and try again.');
    assert.equal(p.el('receipt').hidden, true);
  }
});

test('a ?receipt= body that is not a receipt shows the receipt message', async () => {
  const p = page({ search: `?receipt=${encodeURIComponent(RAW)}`, fetchMap: { [RAW]: new Response('{"a":1}') } });
  await p.ready;
  assert.match(p.text('error'), /not a receipt/);
});

test('nothing is fetched when the page opens without ?receipt=', async () => {
  const p = page();
  await p.ready;
  assert.equal(p.calls.length, 0);
});

// ---- 2.1, 2.2, 2.3 ----

test('a receipt with no commit shows "none" for the commit', async () => {
  const p = page();
  const r = fixture();
  r.gitCommit = null;
  await paste(p, JSON.stringify(r));
  assert.equal(p.text('commit'), 'none');
});

test('names starting with R<n>.<m> render under a requirement heading', async () => {
  const p = page();
  await paste(p, fixtureText);
  assert.deepEqual(headings(p), ['Requirement 1 (2 of 2 pass)', 'Requirement 2 (1 of 1 pass)']);
});

test('names without a requirement number render in one flat group', async () => {
  const p = page();
  const r = fixture();
  r.contracts = r.contracts.map((c, i) => ({ ...c, name: `plain ${i}` }));
  await paste(p, JSON.stringify(r));
  assert.deepEqual(headings(p), ['Contracts (3 of 3 pass)']);
});

test('a receipt with task and required shows the task line and marks each contract required or not yet required', async () => {
  const p = page();
  const r = fixture();
  r.task = { id: '1', line: '1. Do the first thing (Req 1.1)' };
  r.required = ['R1.1 util works'];
  r.contracts[2].result = 'fail';
  await paste(p, JSON.stringify(r));
  assert.equal(p.text('task'), '1. Do the first thing (Req 1.1)');
  const list = rows(p);
  assert.match(list[0].textContent, /\brequired\b/);
  assert.doesNotMatch(list[0].textContent, /not yet required/);
  assert.match(list[1].textContent, /not yet required/);
  // a failing contract that was not required is not built yet, not a broken promise
  assert.match(list[2].textContent, /not built yet/i);
  assert.ok(list[2].classList.contains('notyet'));
  assert.ok(!list[2].classList.contains('fail'));
  assert.doesNotMatch(list[2].textContent, /\bFAIL\b/);
});

test('a failing contract that was required is still shown as FAIL', async () => {
  const p = page();
  const r = fixture();
  r.required = ['R1.1 util works'];
  r.contracts[0].result = 'fail';
  await paste(p, JSON.stringify(r));
  const first = rows(p)[0];
  assert.ok(first.classList.contains('fail'));
  assert.match(first.textContent, /\bFAIL\b/);
  assert.doesNotMatch(first.textContent, /not built yet/i);
});

test('a receipt without task and required has no required marks', async () => {
  const p = page();
  const r = fixture();
  delete r.task;
  delete r.required;
  await paste(p, JSON.stringify(r));
  assert.equal(p.text('task'), 'none recorded');
  for (const row of rows(p)) assert.doesNotMatch(row.textContent, /required/);
});

// ---- 3.1 ----

test('the hash badge shows MATCH for an intact receipt', async () => {
  const p = page();
  await paste(p, fixtureText);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.el('hash-check').hidden, false);
  assert.equal(p.text('hash-badge'), 'MATCH');
  assert.ok(p.el('hash-badge').classList.contains('hash-match'));
});

test('the hash badge shows ALTERED, with both hashes, after one result is flipped in the pasted text', async () => {
  const p = page();
  const r = fixture();
  r.contracts[0].result = 'fail';
  await paste(p, JSON.stringify(r, null, 2));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(p.text('hash-badge'), 'ALTERED');
  assert.ok(p.el('hash-badge').classList.contains('hash-altered'));
  const detail = p.text('hash-detail');
  assert.ok(detail.includes(r.receiptHash));
  assert.ok(detail.includes(await computeReceiptHash(r)));
});

test('the hash check ignores whitespace and key order in the pasted text', async () => {
  const p = page();
  const r = fixture();
  const reordered = Object.fromEntries(Object.entries(r).reverse());
  await paste(p, JSON.stringify(reordered, null, 4));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(p.text('hash-badge'), 'MATCH');
});

test('a stale hash check does not overwrite the result for a newer receipt', async () => {
  const p = page();
  const altered = fixture();
  altered.spec = 'tampered';
  await paste(p, JSON.stringify(altered));
  await paste(p, fixtureText);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(p.text('hash-badge'), 'MATCH');
});

test('without Web Crypto the page says it cannot check instead of giving a verdict', async () => {
  const subtle = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
  const p = page();
  try {
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    await paste(p, fixtureText);
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    if (subtle) Object.defineProperty(globalThis.crypto, 'subtle', subtle);
    else delete globalThis.crypto.subtle;
  }
  assert.equal(p.text('hash-badge'), '');
  assert.equal(p.text('hash-detail'), 'Cannot check: this page needs https or localhost.');
});

// ---- Security: hostile data is text ----

test('a hostile contract name, spec and path appear as text and create no elements', async () => {
  const p = page();
  const evil = '<img src=x onerror=alert(1)>';
  const r = fixture();
  r.spec = evil;
  r.contracts[0].name = evil;
  r.task = { id: '1', line: evil };
  r.required = [evil];
  await paste(p, JSON.stringify(r));
  const row = rows(p).find((e) => e.textContent.includes(evil));
  assert.ok(row, 'the name is shown as text');
  assert.equal(p.text('spec'), evil);
  assert.equal(p.text('task'), evil);
  const all = [p.el('groups'), p.el('receipt')].flatMap((root) => findAll(root, () => true));
  assert.ok(all.every((e) => e.tagName !== 'IMG'), 'no img element');
  assert.ok(all.every((e) => !e.attributes.has('onerror')));
});

test('site/app.js and site/lib/*.js contain no HTML sinks or dynamic code', () => {
  const dir = fileURLToPath(new URL('../site/', import.meta.url));
  const files = [path.join(dir, 'app.js'), ...fs.readdirSync(path.join(dir, 'lib')).map((f) => path.join(dir, 'lib', f))];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', "setAttribute('style'", 'setAttribute("style"']) {
      assert.ok(!src.includes(sink), `${path.basename(f)} contains ${sink}`);
    }
  }
});

// ---- Task 10: run command (5.1) ----

import crypto from 'node:crypto';
import { verifyCommand } from '../site/lib/repo.js';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('the run command is visible as soon as a receipt is shown, with OWNER/NAME before a repository is typed', async () => {
  const p = page();
  assert.equal(p.el('run').hidden, true);
  await paste(p, fixtureText);
  assert.equal(p.el('run').hidden, false);
  const r = fixture();
  assert.equal(p.text('command'), verifyCommand({ repo: '', receipt: r }));
  assert.ok(p.text('command').includes('git clone https://github.com/OWNER/NAME.git'));
  assert.ok(p.text('command').includes(`git checkout ${r.gitCommit}`));
  assert.ok(p.text('command').includes(`necro verify .necro/receipts/${r.spec}/${r.receiptHash}.json`));
});

test('the run command changes to the real repository as the box changes, and falls back when it is invalid', async () => {
  const p = page();
  await paste(p, fixtureText);
  p.el('repo').value = 'octo/spec-repo';
  await p.el('repo').dispatch('input');
  assert.ok(p.text('command').includes('git clone https://github.com/octo/spec-repo.git'));
  p.el('repo').value = 'not a repo';
  await p.el('repo').dispatch('input');
  assert.ok(p.text('command').includes('OWNER/NAME'));
});

test('typing a repository before any receipt is shown does not break the page', async () => {
  const p = page();
  p.el('repo').value = 'octo/spec-repo';
  await p.el('repo').dispatch('input');
  assert.equal(p.el('run').hidden, true);
  await paste(p, fixtureText);
  assert.ok(p.text('command').includes('octo/spec-repo'));
});

test('a repository from ?receipt= appears in the run command', async () => {
  const p = page({ search: `?receipt=${encodeURIComponent(RAW)}`, fetchMap: { [RAW]: new Response(fixtureText) } });
  await p.ready;
  assert.ok(p.text('command').includes('git clone https://github.com/o/n.git'));
});

test('the command note says so when the receipt names no commit, and the command has no checkout', async () => {
  const p = page();
  const r = fixture();
  r.gitCommit = null;
  await paste(p, JSON.stringify(r));
  assert.doesNotMatch(p.text('command'), /git checkout/);
  assert.match(p.text('command-note'), /names no commit/);
  await paste(p, fixtureText);
  assert.equal(p.text('command-note'), '');
});

test('the copy button writes the command to the clipboard', async () => {
  const written = [];
  const p = page({ clipboard: { writeText: async (t) => void written.push(t) } });
  await paste(p, fixtureText);
  await p.el('copy').dispatch('click');
  assert.deepEqual(written, [p.text('command')]);
  assert.equal(p.text('copy-note'), 'Copied.');
});

test('when the clipboard rejects or is missing the page says to select the command', async () => {
  const rejecting = page({
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
  });
  await paste(rejecting, fixtureText);
  await rejecting.el('copy').dispatch('click');
  assert.equal(rejecting.text('copy-note'), 'Select the command and copy it.');
  const missing = page();
  await paste(missing, fixtureText);
  await missing.el('copy').dispatch('click');
  assert.equal(missing.text('copy-note'), 'Select the command and copy it.');
});

// ---- Task 10: file check (4.1, 4.2, 4.3) ----

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const rawFile = (p) => `https://raw.githubusercontent.com/octo/spec-repo/${COMMIT}/${p}`;

// A receipt (with correct hash not required) pinning three files, served from a fake repository.
function fileReceipt(over = {}) {
  const r = fixture();
  r.gitCommit = COMMIT;
  r.requirements = { path: '.kiro/specs/demo/requirements.md', sha256: sha('req\n') };
  r.contracts = r.contracts.map((c) => ({ ...c, path: 'contracts/demo/util.contract.test.js', sha256: sha('contract\n') }));
  r.sources = [{ path: 'src/util.js', sha256: sha('old\n') }];
  r.uncommitted = [];
  return { ...r, ...over };
}
const served = {
  [rawFile('.kiro/specs/demo/requirements.md')]: () => new Response('req\n'),
  [rawFile('contracts/demo/util.contract.test.js')]: () => new Response('contract\n'),
  [rawFile('src/util.js')]: () => new Response('new\n'),
};

const fileRows = (p) => findAll(p.el('files'), (e) => e.classList.contains('file'));

test('nothing is fetched until Check files is pressed', async () => {
  const p = page({ fetchMap: served });
  await paste(p, JSON.stringify(fileReceipt()));
  p.el('repo').value = 'octo/spec-repo';
  await p.el('repo').dispatch('input');
  assert.equal(p.calls.length, 0);
  assert.equal(p.el('file-check').hidden, false);
});

test('Check files with a bad repository shows the parseRepo message and fetches nothing', async () => {
  const p = page({ fetchMap: served });
  await paste(p, JSON.stringify(fileReceipt()));
  p.el('repo').value = 'nope';
  await p.el('check').dispatch('click');
  assert.equal(p.text('repo-error'), 'Type the repository as owner/name, for example octo/spec-repo.');
  assert.equal(p.calls.length, 0);
  assert.equal(fileRows(p).length, 0);
});

test('a successful check renders each file with its status word and a counts line', async () => {
  const p = page({ fetchMap: served });
  await paste(p, JSON.stringify(fileReceipt()));
  p.el('repo').value = 'octo/spec-repo';
  await p.el('check').dispatch('click');
  assert.equal(p.text('repo-error'), '');
  assert.equal(p.calls.length, 3);
  for (const c of p.calls) {
    assert.equal(c.options.credentials, 'omit');
    assert.equal(c.options.referrerPolicy, 'no-referrer');
  }
  const list = fileRows(p);
  assert.equal(list.length, 3);
  const byPath = (path) => list.find((e) => e.textContent.includes(path));
  assert.match(byPath('requirements.md').textContent, /\bMATCH\b/);
  assert.ok(byPath('requirements.md').classList.contains('status-match'));
  assert.match(byPath('util.contract.test.js').textContent, /\bMATCH\b/);
  assert.match(byPath('src/util.js').textContent, /\bDIFFERENT\b/);
  assert.ok(byPath('src/util.js').classList.contains('status-different'));
  assert.equal(p.text('file-summary'), '2 match, 1 different, 0 not in the commit yet, 0 could not be checked');
  assert.equal(p.text('file-notice'), '');
  assert.equal(p.el('check').disabled, false);
});

test('uncommitted files get the notice, are not fetched and are not called different', async () => {
  const p = page({ fetchMap: served });
  await paste(p, JSON.stringify(fileReceipt({ uncommitted: ['src/util.js'] })));
  p.el('repo').value = 'octo/spec-repo';
  await p.el('check').dispatch('click');
  assert.equal(p.calls.length, 2);
  assert.ok(!p.calls.some((c) => c.url.endsWith('src/util.js')));
  const row = fileRows(p).find((e) => e.textContent.includes('src/util.js'));
  assert.match(row.textContent, /NOT IN THE COMMIT YET/);
  assert.ok(row.classList.contains('status-uncommitted'));
  assert.doesNotMatch(row.textContent, /DIFFERENT/);
  assert.equal(p.text('file-notice'), 'Some files are not in the commit yet. Commit the work and re-run the gate for a fully public check.');
  assert.equal(p.text('file-summary'), '2 match, 0 different, 1 not in the commit yet, 0 could not be checked');
});

test('a file that could not be fetched reads as could not be checked, with a reason', async () => {
  const p = page({ fetchMap: { ...served, [rawFile('src/util.js')]: new Response('gone', { status: 404 }) } });
  await paste(p, JSON.stringify(fileReceipt()));
  p.el('repo').value = 'octo/spec-repo';
  await p.el('check').dispatch('click');
  const row = fileRows(p).find((e) => e.textContent.includes('src/util.js'));
  assert.match(row.textContent, /COULD NOT CHECK/);
  assert.match(row.textContent, /404/);
  assert.ok(row.classList.contains('status-unavailable'));
  assert.equal(p.text('file-summary'), '2 match, 0 different, 0 not in the commit yet, 1 could not be checked');
});

test('a receipt with no commit shows the missing-commit message and fetches nothing', async () => {
  const p = page({ fetchMap: served });
  await paste(p, JSON.stringify(fileReceipt({ gitCommit: null })));
  p.el('repo').value = 'octo/spec-repo';
  await p.el('check').dispatch('click');
  assert.match(p.text('repo-error'), /file check needs a git commit/);
  assert.equal(p.calls.length, 0);
  assert.equal(fileRows(p).length, 0);
});

test('file check results are cleared when another receipt is shown', async () => {
  const p = page({ fetchMap: served });
  await paste(p, JSON.stringify(fileReceipt({ uncommitted: ['src/util.js'] })));
  p.el('repo').value = 'octo/spec-repo';
  await p.el('check').dispatch('click');
  assert.ok(fileRows(p).length > 0);
  await paste(p, fixtureText);
  assert.equal(fileRows(p).length, 0);
  assert.equal(p.text('file-summary'), '');
  assert.equal(p.text('file-notice'), '');
  await paste(p, 'broken');
  assert.equal(p.el('run').hidden, true);
  assert.equal(p.el('file-check').hidden, true);
});

test('file check results for an older receipt do not appear after a newer one is shown', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const slow = { ...served, [rawFile('src/util.js')]: async () => (await gate, new Response('new\n')) };
  const p = page({ fetchMap: slow });
  await paste(p, JSON.stringify(fileReceipt()));
  p.el('repo').value = 'octo/spec-repo';
  const pending = p.el('check').dispatch('click');
  await paste(p, fixtureText);
  release();
  await pending;
  assert.equal(fileRows(p).length, 0);
});

test('file check text from a hostile path is written as text', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const p = page({ fetchMap: served });
  const r = fileReceipt({ uncommitted: [] });
  r.sources = [{ path: evil, sha256: sha('x') }];
  await paste(p, JSON.stringify(r));
  p.el('repo').value = 'octo/spec-repo';
  await p.el('check').dispatch('click');
  const row = fileRows(p).find((e) => e.textContent.includes(evil));
  assert.ok(row, 'shown as text');
  assert.match(row.textContent, /COULD NOT CHECK/);
  assert.ok(findAll(p.el('files'), () => true).every((e) => e.tagName !== 'IMG'));
});

// ---- Task 11: sample receipt button (6.2) ----

import { SAMPLE_REPO } from '../site/app.js';

test('with no receipt the page offers a Load the sample button', async () => {
  const p = page();
  await p.ready;
  assert.equal(p.el('sample-row').hidden, false);
  const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button[^>]*id="sample"[^>]*>Load the sample<\/button>/);
});

test('pressing Load the sample fetches ./sample-receipt.json from the same origin, renders it and sets the repository box', async () => {
  const p = page({ fetchMap: { './sample-receipt.json': new Response(fixtureText) } });
  await p.ready;
  assert.equal(p.calls.length, 0, 'nothing is fetched until the button is pressed');
  await p.el('sample').dispatch('click');
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].url, './sample-receipt.json');
  assert.equal(p.text('spec'), fixture().spec);
  assert.equal(rows(p).length, 3);
  assert.equal(p.el('repo').value, SAMPLE_REPO);
  assert.ok(p.text('command').includes(`https://github.com/${SAMPLE_REPO}.git`));
  assert.equal(p.text('error'), '');
});

test('SAMPLE_REPO is owner/name text, a placeholder until the repository has a public home', () => {
  assert.match(SAMPLE_REPO, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
});

test('the sample button hides while a receipt is shown and comes back when the receipt is cleared', async () => {
  const p = page();
  await paste(p, fixtureText);
  assert.equal(p.el('sample-row').hidden, true);
  await paste(p, 'broken');
  assert.equal(p.el('sample-row').hidden, false);
});

test('paste and file pick still work after the sample was loaded', async () => {
  const p = page({ fetchMap: { './sample-receipt.json': new Response(fixtureText) } });
  await p.el('sample').dispatch('click');
  const other = fixture();
  other.spec = 'pasted-spec';
  await paste(p, JSON.stringify(other));
  assert.equal(p.text('spec'), 'pasted-spec');
  const again = fixture();
  again.spec = 'file-spec';
  const text = JSON.stringify(again);
  p.el('file').files = [{ size: text.length, text: async () => text }];
  await p.el('file').dispatch('change');
  assert.equal(p.text('spec'), 'file-spec');
});

test('a sample fetch failure shows one plain sentence', async () => {
  for (const hit of [undefined, new TypeError('offline')]) {
    const p = page({ fetchMap: hit ? { './sample-receipt.json': hit } : {} });
    await p.el('sample').dispatch('click');
    assert.equal(p.text('error'), 'Could not load the sample. Reload the page and try again.');
    assert.equal(p.el('receipt').hidden, true);
  }
});

test('pressing Load the sample sets the repository box to SAMPLE_REPO even after the visitor typed another', async () => {
  const p = page({ fetchMap: { './sample-receipt.json': new Response(fixtureText) } });
  p.el('repo').value = 'mine/typed';
  await p.el('sample').dispatch('click');
  assert.equal(p.el('repo').value, SAMPLE_REPO);
});
