// DOM wiring for the receipt viewer. Everything the page shows that came from a receipt is written with textContent,
// never as HTML, so a hostile receipt cannot inject markup. The environment (document, location, fetch, navigator) is
// passed in so tests can drive the page with a small fake DOM.

import { computeReceiptHash } from './lib/canon.js';
import { parseReceipt, summarize, groupContracts, sortByCriterion, plainTaskLine, verdict, MAX_RECEIPT_BYTES } from './lib/receipt.js';
import { parseReceiptUrl, parseRepo, isCommitId, verifyCommand } from './lib/repo.js';
import { checkFiles } from './lib/files.js';
import { SAMPLES, chooseInitialView, scrollOptions } from './lib/samples.js';

const LOAD_FAILED = 'Could not load that receipt. Check the link and try again.';
const FILE_TOO_BIG = 'This receipt is larger than 1 MB. Open a receipt file written by necro.';
const FILE_UNREADABLE = 'Could not read that file. Choose a receipt file written by necro.';
const NO_CRYPTO = 'Cannot check: this page needs https or localhost.';
// The public home of this repository, which the sample receipt's files are checked against.
export const SAMPLE_REPO = 'vijaygopalbalasa/contract-necromancer';
// Where each sample is fetched from, on the same origin as the page.
const SAMPLE_URLS = { risen: './sample-receipt.json', buried: './sample-buried.json' };
const SAMPLE_FAILED = 'Could not load the sample. Reload the page and try again.';
const COPY_FAILED = 'Select the command and copy it.';
const UNCOMMITTED_NOTICE = 'Some files are not in the commit yet. Commit the work and re-run the gate for a fully public check.';
const NO_COMMIT_NOTE = 'This receipt names no commit, so the command does not check one out.';
const TIMEOUT_MS = 15000;

// The word shown for each file status. The word, not the color, carries the meaning.
const STATUS_WORDS = {
  match: 'MATCH',
  different: 'DIFFERENT',
  uncommitted: 'NOT IN THE COMMIT YET',
  unavailable: 'COULD NOT CHECK',
};

function requestOptions() {
  const options = { credentials: 'omit', referrerPolicy: 'no-referrer' };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    options.signal = AbortSignal.timeout(TIMEOUT_MS);
  }
  return options;
}

export function start({ document, location, fetch, navigator, matchMedia }) {
  const $ = (id) => document.getElementById(id);
  const els = {};
  for (const id of [
    'paste', 'show', 'file', 'error', 'receipt', 'spec', 'commit', 'receipt-hash', 'created', 'task', 'summary', 'groups',
    'hash-check', 'hash-badge', 'hash-detail', 'repo', 'run', 'command', 'copy', 'copy-note', 'command-note', 'file-check',
    'check', 'repo-error', 'file-notice', 'file-summary', 'files', 'sample', 'sample-buried', 'sample-note', 'verdict',
    'demo-command', 'demo-copy', 'demo-copy-note', 'strip-command', 'strip-copy', 'strip-copy-note',
  ]) {
    els[id] = $(id);
  }

  // Each receipt that is shown gets a number, so the answer to a slow check for an older receipt is ignored.
  let shown = 0;
  let current = null; // the receipt on screen, or null
  // Each request to open something gets a number too. A slow load that is no longer the latest request is dropped, so
  // a sample that arrives late never replaces a receipt the visitor pasted meanwhile.
  let latest = 0;

  function make(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function clearReceipt() {
    shown += 1;
    current = null;
    for (const id of ['verdict', 'receipt', 'hash-check', 'run', 'file-check']) els[id].hidden = true;
    for (const id of [
      'verdict', 'sample-note', 'spec', 'commit', 'receipt-hash', 'created', 'task', 'summary', 'groups', 'hash-badge', 'hash-detail',
      'command', 'copy-note', 'command-note', 'repo-error', 'file-notice', 'file-summary', 'files',
    ]) {
      els[id].textContent = '';
    }
    els.verdict.className = 'verdict';
    els['hash-badge'].className = 'badge';
    els.check.disabled = false;
  }

  function showError(message) {
    clearReceipt();
    els.error.textContent = message;
  }

  function contractRow(c) {
    // A failing contract that this task did not require is not built yet, not a broken promise.
    const notYet = c.result === 'fail' && c.required === false;
    const state = notYet ? 'notyet' : c.result;
    const word = notYet ? 'NOT BUILT YET' : c.result === 'pass' ? 'PASS' : 'FAIL';
    // The shape of the row (alive or gravestone) is drawn by style.css. The row itself is plain words, with plain
    // spaces between the spans, so it reads the same to a screen reader.
    const li = make('li', `contract ${state}`);
    li.appendChild(make('span', 'state', word));
    li.append(' ');
    li.appendChild(make('span', 'name', c.name));
    // A not-built-yet row already says so in its state word, so only required and passing rows get a note.
    if (c.required !== null && !notYet) {
      li.append(' ');
      li.appendChild(make('span', 'note', c.required ? 'required for this task' : 'not required for this task'));
    }
    return li;
  }

  function renderGroups(contracts) {
    els.groups.textContent = '';
    for (const g of groupContracts(sortByCriterion(contracts))) {
      const section = make('div', 'group');
      section.appendChild(make('h3', '', `${g.title} (${g.passed} of ${g.total} pass)`));
      const list = make('ul', 'contracts');
      for (const c of g.contracts) list.appendChild(contractRow(c));
      section.appendChild(list);
      els.groups.appendChild(section);
    }
  }

  // The verdict leads the receipt. It gives one number and names no contract, so the rows below stay the record.
  function renderVerdict(contracts) {
    const v = verdict(contracts);
    const banner = els.verdict;
    banner.className = `verdict ${v.risen ? 'risen' : 'buried'}`;
    banner.textContent = '';
    const mark = make('span', 'verdict-mark');
    mark.setAttribute('aria-hidden', 'true');
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const count = v.risen
      ? `${plural(v.living, 'contract', 'contracts')} alive.`
      : `${plural(v.buried, 'required contract fails', 'required contracts fail')}.`;
    const note = v.risen ? 'Every required contract passes.' : 'The task is not done until every required contract passes.';
    banner.appendChild(mark);
    banner.appendChild(make('h2', 'verdict-word', v.risen ? 'Risen' : 'Still buried'));
    banner.append(' ');
    banner.appendChild(make('p', 'verdict-count', count));
    banner.append(' ');
    banner.appendChild(make('p', 'verdict-note', note));
    banner.hidden = false;
  }

  async function checkHash(receipt, id) {
    const badge = els['hash-badge'];
    const detail = els['hash-detail'];
    badge.className = 'badge hash-checking';
    badge.textContent = 'checking';
    detail.textContent = '';
    let computed = null;
    try {
      if (!globalThis.crypto || !globalThis.crypto.subtle) throw new Error('no Web Crypto');
      computed = await computeReceiptHash(receipt);
    } catch {
      computed = null;
    }
    if (id !== shown) return;
    if (computed === null) {
      badge.className = 'badge';
      badge.textContent = '';
      detail.textContent = NO_CRYPTO;
    } else if (computed === receipt.receiptHash) {
      badge.className = 'badge hash-match';
      badge.textContent = 'MATCH';
      detail.textContent = 'The receipt hash matches the receipt contents.';
    } else {
      badge.className = 'badge hash-altered';
      badge.textContent = 'ALTERED';
      detail.textContent = `The receipt says ${receipt.receiptHash}, but its contents hash to ${computed}.`;
    }
  }

  // The run command follows the repository box, so a reviewer sees the real command as soon as they type.
  function updateCommand() {
    if (current === null) return;
    els.command.textContent = verifyCommand({ repo: els.repo.value, receipt: current });
    els['command-note'].textContent = isCommitId(current.gitCommit) ? '' : NO_COMMIT_NOTE;
  }

  function fileRow(f) {
    const li = make('li', `file status-${f.status}`);
    li.appendChild(make('span', 'state', STATUS_WORDS[f.status]));
    li.append(' ');
    li.appendChild(make('span', 'kind', f.kind));
    li.append(' ');
    li.appendChild(make('span', 'path', f.path));
    if (f.detail) li.appendChild(make('span', 'detail', f.detail));
    return li;
  }

  function countLine(files) {
    const n = (status) => files.filter((f) => f.status === status).length;
    return `${n('match')} match, ${n('different')} different, ${n('uncommitted')} not in the commit yet, ${n('unavailable')} could not be checked`;
  }

  async function runFileCheck() {
    if (current === null) return;
    const receipt = current;
    const id = shown;
    els['repo-error'].textContent = '';
    const repo = parseRepo(els.repo.value);
    if (!repo.ok) {
      els['repo-error'].textContent = repo.message;
      return;
    }
    for (const key of ['file-notice', 'file-summary', 'files']) els[key].textContent = '';
    els['file-summary'].textContent = 'Checking…';
    els.check.disabled = true;
    const result = await checkFiles({ receipt, repo: repo.repo, fetchFn: (url, options) => fetch(url, options) });
    if (id !== shown) return; // another receipt is on screen now
    els.check.disabled = false;
    els['file-summary'].textContent = '';
    if (!result.ok) {
      els['repo-error'].textContent = result.message;
      return;
    }
    if (result.anyUncommitted) els['file-notice'].textContent = UNCOMMITTED_NOTICE;
    els['file-summary'].textContent = countLine(result.files);
    for (const f of result.files) els.files.appendChild(fileRow(f));
  }

  async function copyText(source, note) {
    try {
      await navigator.clipboard.writeText(source.textContent);
      note.textContent = 'Copied.';
    } catch {
      note.textContent = COPY_FAILED;
    }
  }

  // True when the visitor has asked the browser for less motion, and when we cannot tell.
  function reducedMotion() {
    try {
      return typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return true;
    }
  }

  // The verdict is the first thing a reviewer needs, and the open form above it can push it below the fold.
  // scrollOptions turns the animation off under prefers-reduced-motion: reduce.
  function bringBannerIntoView() {
    if (typeof els.verdict.scrollIntoView !== 'function') return;
    els.verdict.scrollIntoView(scrollOptions({ reducedMotion: reducedMotion() }));
  }

  // The one place a receipt is shown. `sample` is the entry of SAMPLES being shown, if any. `scroll` is true after
  // something the visitor did, so the banner is brought into view. Returns a promise that resolves when the hash check
  // is done.
  function showReceipt(text, { sample = null, scroll = false } = {}) {
    const parsed = parseReceipt(text);
    if (!parsed.ok) {
      showError(parsed.message);
      return Promise.resolve();
    }
    clearReceipt();
    els.error.textContent = '';
    const id = shown;
    const receipt = parsed.receipt;
    current = receipt;
    const s = summarize(receipt);
    els.spec.textContent = s.spec;
    els.commit.textContent = s.gitCommit === null ? 'none' : s.gitCommit;
    els['receipt-hash'].textContent = s.receiptHash;
    els.created.textContent = s.createdAt === null ? 'not recorded' : s.createdAt;
    els.task.textContent = s.task === null ? 'none recorded' : plainTaskLine(s.task);
    els.summary.textContent = `${s.passed} of ${s.total} contracts pass`;
    renderVerdict(s.contracts);
    renderGroups(s.contracts);
    els.receipt.hidden = false;
    els['hash-check'].hidden = false;
    els.run.hidden = false;
    els['file-check'].hidden = false;
    updateCommand();
    if (sample) els['sample-note'].textContent = sample.note;
    if (scroll) bringBannerIntoView();
    return checkHash(receipt, id);
  }

  async function fetchText(url) {
    const response = await fetch(url, requestOptions());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  async function loadFromUrl(url) {
    const request = ++latest;
    let text;
    try {
      text = await fetchText(url);
    } catch {
      if (request === latest) showError(LOAD_FAILED);
      return;
    }
    if (request !== latest) return;
    await showReceipt(text, { scroll: true });
  }

  // `byVisitor` is false for the sample a first visit shows by itself: that one does not scroll the page away from
  // the intro.
  async function loadSample(sample, byVisitor) {
    const request = ++latest;
    let text;
    try {
      text = await fetchText(SAMPLE_URLS[sample.id]);
    } catch {
      if (request === latest) showError(SAMPLE_FAILED);
      return;
    }
    if (request !== latest) return;
    els.repo.value = SAMPLE_REPO;
    await showReceipt(text, { sample, scroll: byVisitor });
  }

  els.show.addEventListener('click', () => {
    latest += 1;
    return showReceipt(els.paste.value, { scroll: true });
  });
  els.sample.addEventListener('click', () => loadSample(SAMPLES[0], true));
  els['sample-buried'].addEventListener('click', () => loadSample(SAMPLES[1], true));
  els.repo.addEventListener('input', updateCommand);
  els.check.addEventListener('click', runFileCheck);
  els.copy.addEventListener('click', () => copyText(els.command, els['copy-note']));
  els['demo-copy'].addEventListener('click', () => copyText(els['demo-command'], els['demo-copy-note']));
  els['strip-copy'].addEventListener('click', () => copyText(els['strip-command'], els['strip-copy-note']));

  els.file.addEventListener('change', async () => {
    const file = els.file.files && els.file.files[0];
    if (!file) return;
    const request = ++latest;
    if (file.size > MAX_RECEIPT_BYTES) {
      showError(FILE_TOO_BIG);
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      if (request === latest) showError(FILE_UNREADABLE);
      return;
    }
    if (request !== latest) return;
    await showReceipt(text, { scroll: true });
  });

  // Opening the page: the receipt the link names, else (on a first visit) the risen sample.
  const view = chooseInitialView({ requested: parseReceiptUrl(location.search), pasted: els.paste.value });
  if (view.action === 'error') showError(view.message);
  if (view.action === 'sample') return loadSample(SAMPLES.find((x) => x.id === view.sample), false);
  if (view.action === 'url') {
    els.repo.value = view.repo;
    return loadFromUrl(view.url);
  }
  return Promise.resolve();
}
