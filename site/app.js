// DOM wiring for the receipt viewer. Everything the page shows that came from a receipt is written with textContent,
// never as HTML, so a hostile receipt cannot inject markup. The environment (document, location, fetch, navigator) is
// passed in so tests can drive the page with a small fake DOM.

import { computeReceiptHash } from './lib/canon.js';
import { parseReceipt, summarize, groupContracts, MAX_RECEIPT_BYTES } from './lib/receipt.js';
import { parseReceiptUrl, parseRepo, isCommitId, verifyCommand } from './lib/repo.js';
import { checkFiles } from './lib/files.js';

const LOAD_FAILED = 'Could not load that receipt. Check the link and try again.';
const FILE_TOO_BIG = 'This receipt is larger than 1 MB. Open a receipt file written by necro.';
const FILE_UNREADABLE = 'Could not read that file. Choose a receipt file written by necro.';
const NO_CRYPTO = 'Cannot check: this page needs https or localhost.';
// The public home of this repository, which the sample receipt's files can be checked against. A placeholder until
// the repository has one: set it to owner/name then.
export const SAMPLE_REPO = 'OWNER/NAME';
const SAMPLE_URL = './sample-receipt.json';
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

export function start({ document, location, fetch, navigator }) {
  const $ = (id) => document.getElementById(id);
  const els = {};
  for (const id of [
    'paste', 'show', 'file', 'error', 'receipt', 'spec', 'commit', 'receipt-hash', 'created', 'task', 'summary', 'groups',
    'hash-check', 'hash-badge', 'hash-detail', 'repo', 'run', 'command', 'copy', 'copy-note', 'command-note', 'file-check',
    'check', 'repo-error', 'file-notice', 'file-summary', 'files', 'sample', 'sample-row',
  ]) {
    els[id] = $(id);
  }

  // Each receipt that is shown gets a number, so the answer to a slow check for an older receipt is ignored.
  let shown = 0;
  let current = null; // the receipt on screen, or null

  function make(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function clearReceipt() {
    shown += 1;
    current = null;
    for (const id of ['receipt', 'hash-check', 'run', 'file-check']) els[id].hidden = true;
    for (const id of [
      'spec', 'commit', 'receipt-hash', 'created', 'task', 'summary', 'groups', 'hash-badge', 'hash-detail', 'command',
      'copy-note', 'command-note', 'repo-error', 'file-notice', 'file-summary', 'files',
    ]) {
      els[id].textContent = '';
    }
    els['hash-badge'].className = 'badge';
    els.check.disabled = false;
    els['sample-row'].hidden = false;
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
    const glyph = c.result === 'pass' ? '✦' : notYet ? '…' : '🪦';
    const li = make('li', `contract ${state}`);
    const g = make('span', 'glyph', glyph);
    g.setAttribute('aria-hidden', 'true');
    // Plain spaces between the spans keep the row readable as text, for screen readers too.
    li.appendChild(g);
    li.append(' ');
    li.appendChild(make('span', 'state', word));
    li.append(' ');
    li.appendChild(make('span', 'name', c.name));
    if (c.required !== null) {
      li.append(' ');
      li.appendChild(make('span', 'note', c.required ? 'required' : 'not yet required'));
    }
    return li;
  }

  function renderGroups(contracts) {
    els.groups.textContent = '';
    for (const g of groupContracts(contracts)) {
      const section = make('div', 'group');
      section.appendChild(make('h3', '', `${g.title} (${g.passed} of ${g.total} pass)`));
      const list = make('ul', 'contracts');
      for (const c of g.contracts) list.appendChild(contractRow(c));
      section.appendChild(list);
      els.groups.appendChild(section);
    }
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

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(els.command.textContent);
      els['copy-note'].textContent = 'Copied.';
    } catch {
      els['copy-note'].textContent = COPY_FAILED;
    }
  }

  // The one place a receipt is shown. Returns a promise that resolves when the hash check is done.
  function showReceipt(text) {
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
    els.task.textContent = s.task === null ? 'none recorded' : s.task;
    els.summary.textContent = `${s.passed} of ${s.total} contracts pass`;
    renderGroups(s.contracts);
    els.receipt.hidden = false;
    els['hash-check'].hidden = false;
    els.run.hidden = false;
    els['file-check'].hidden = false;
    els['sample-row'].hidden = true;
    updateCommand();
    return checkHash(receipt, id);
  }

  async function loadFromUrl(url) {
    let text;
    try {
      const response = await fetch(url, requestOptions());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } catch {
      showError(LOAD_FAILED);
      return;
    }
    await showReceipt(text);
  }

  async function loadSample() {
    let text;
    try {
      const response = await fetch(SAMPLE_URL, requestOptions());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } catch {
      showError(SAMPLE_FAILED);
      return;
    }
    els.repo.value = SAMPLE_REPO;
    await showReceipt(text);
  }

  els.show.addEventListener('click', () => showReceipt(els.paste.value));
  els.sample.addEventListener('click', loadSample);
  els.repo.addEventListener('input', updateCommand);
  els.check.addEventListener('click', runFileCheck);
  els.copy.addEventListener('click', copyCommand);

  els.file.addEventListener('change', async () => {
    const file = els.file.files && els.file.files[0];
    if (!file) return;
    if (file.size > MAX_RECEIPT_BYTES) {
      showError(FILE_TOO_BIG);
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      showError(FILE_UNREADABLE);
      return;
    }
    await showReceipt(text);
  });

  // Opening the page with ?receipt=<raw url>.
  const requested = parseReceiptUrl(location.search);
  if (requested === null) return Promise.resolve();
  if (!requested.ok) {
    showError(requested.message);
    return Promise.resolve();
  }
  els.repo.value = requested.repo;
  return loadFromUrl(requested.url);
}
