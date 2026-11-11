// DOM wiring for the receipt viewer. Everything the page shows that came from a receipt is written with textContent,
// never as HTML, so a hostile receipt cannot inject markup. The environment (document, location, fetch, navigator) is
// passed in so tests can drive the page with a small fake DOM.

import { computeReceiptHash } from './lib/canon.js';
import { parseReceipt, summarize, groupContracts, sortByCriterion, plainTaskLine, verdict, MAX_RECEIPT_BYTES } from './lib/receipt.js';
import { parseReceiptUrl, parseRepo, isCommitId, verifyCommand } from './lib/repo.js';
import { checkFiles } from './lib/files.js';
import { SAMPLES, chooseInitialView, scrollOptions } from './lib/samples.js';
import { runPlay, fullRunFor } from './lib/play-loader.js';
import { PLAY_DIR, RISEN_RECEIPT, checkPlayFiles, changeOneByte, mismatchLine } from './lib/play.js';

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
const NO_TASK_LINE = 'No task. This receipt was written by necro check, not by a tick.';
const NO_COMMIT_NOTE = 'This receipt names no commit, so the command does not check one out.';
const TIMEOUT_MS = 15000;

// The play (Req 13). The folder it reads its copies from is the site folder, as an absolute address, so the same code works
// from any path the page is served under.
const PLAY_BASE = new URL('./', import.meta.url).href;
const PLAY_STEPS = { planted: 1, fixed: 2, byte: 3 };
const PLAY_ERROR = 'The run stopped with an error.';
const RISEN_FAILED = "The page could not load the risen receipt, so it could not check it.";
const FULL_RUN_FAILED = "The receipt that holds the gate's full run could not be loaded.";
const MAX_MESSAGE = 300;
// A failing row shows the first lines of its assertion message, and the whole message (up to this many characters) behind a
// details element.
const PREVIEW_LINES = 3;
const PREVIEW_CHARS = 120;
const MAX_FULL_MESSAGE = 2000;
const FULL_RUN_WAIT_MS = 3000;

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

// `play` may replace the pieces that run and check the play (tests do this); a page never passes it.
export function start({ document, location, fetch, navigator, matchMedia, play = {} }) {
  const $ = (id) => document.getElementById(id);
  const els = {};
  for (const id of [
    'paste', 'show', 'file', 'error', 'receipt', 'spec', 'commit', 'receipt-hash', 'created', 'task', 'summary', 'groups',
    'hash-check', 'hash-badge', 'hash-detail', 'repo', 'run', 'command', 'copy', 'copy-note', 'command-note', 'file-check',
    'check', 'repo-error', 'file-notice', 'file-summary', 'files', 'sample', 'sample-buried', 'sample-note', 'verdict',
    'demo-command', 'demo-copy', 'demo-copy-note', 'strip-command', 'strip-copy', 'strip-copy-note',
    'strip-play', 'play', 'play-title', 'play-send', 'play-fix', 'play-byte', 'play-status',
    'play-result-planted', 'play-result-fixed', 'play-result-byte',
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
    els.task.textContent = s.task === null ? NO_TASK_LINE : plainTaskLine(s.task);
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

  // ---- The play (Req 13): three steps, each with one button and one place for its result. ----

  const runner = typeof play.runPlay === 'function' ? play.runPlay : runPlay;
  const fullRun = typeof play.fullRunFor === 'function' ? play.fullRunFor : fullRunFor;
  const checkCopies = typeof play.checkPlayFiles === 'function' ? play.checkPlayFiles : checkPlayFiles;
  const playFetch = (url, options) => fetch(url, options);
  let playBusy = false;

  // A message from a run, as text that is safe to show: no control characters, at most `max` characters. Line breaks stay.
  function cleanText(text, max) {
    const clean = String(text)
      .replace(/\r/g, '')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return clean.length > max ? `${clean.slice(0, max).trimEnd()}...` : clean;
  }

  // One clean block, not too long: the form a sentence from a run takes.
  function clipMessage(text) {
    return cleanText(text, MAX_MESSAGE);
  }

  // An assertion message as { preview, full }. The preview is its first three lines (blank lines do not count, each line is
  // cut at 120 characters), and `full` is the whole message when the preview leaves something out, else null.
  function messageParts(text) {
    const full = cleanText(text, MAX_FULL_MESSAGE);
    const lines = full.split('\n').filter((l) => l.trim() !== '');
    const shown = lines.slice(0, PREVIEW_LINES).map((l) => (l.length > PREVIEW_CHARS ? `${l.slice(0, PREVIEW_CHARS).trimEnd()}...` : l));
    const cut = lines.length > PREVIEW_LINES || shown.some((l, i) => l !== lines[i]);
    return { preview: shown.join('\n'), full: cut ? full : null };
  }

  function takeFocus(node) {
    if (node && typeof node.focus === 'function') node.focus();
  }

  function setPlayButtons(off) {
    for (const id of ['play-send', 'play-fix', 'play-byte']) els[id].disabled = off;
  }

  // One line that opens a result: a bold word, then what it means. The word is Refused, Accepted or Stopped.
  function verdictLine(kind, word, rest) {
    const p = make('p', `play-verdict ${kind}`);
    p.appendChild(make('strong', '', word));
    p.append(` ${rest}`);
    return p;
  }

  // A contract row for the browser's result, drawn with the same classes as a receipt row. A passing row is one line. A
  // failing row adds the first lines of the assertion message that failed, and the whole message behind a details element
  // when those lines leave something out.
  function playRow(r) {
    const li = contractRow({ name: r.name, result: r.result, required: null });
    const parts = r.result === 'fail' ? messageParts(r.message) : { preview: '', full: null };
    if (parts.preview) {
      li.append(' ');
      li.appendChild(make('span', 'note', parts.preview));
    }
    if (parts.full !== null) {
      const more = make('details', 'play-more');
      more.appendChild(make('summary', '', 'Full message'));
      more.appendChild(make('p', 'play-message', parts.full));
      li.appendChild(more);
    }
    return li;
  }

  // "R2.1, R2.2 and R3.1": ids in a list, with "and" before the last.
  function idList(ids) {
    return ids.length < 2 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
  }

  // The criterion ids of the contracts that failed in a receipt, in criterion order, or null when the receipt cannot be read.
  // The planted change stands on the buried sample and the fix on the risen receipt, the same receipts the run is checked
  // against.
  async function failingIds(kind) {
    try {
      const url = kind === 'planted' ? `${PLAY_BASE}sample-buried.json` : `${PLAY_BASE}${PLAY_DIR}/${RISEN_RECEIPT}`;
      const options = { credentials: 'omit', referrerPolicy: 'no-referrer' };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') options.signal = AbortSignal.timeout(FULL_RUN_WAIT_MS);
      const response = await fetch(url, options);
      if (!response.ok) return null;
      const parsed = parseReceipt(await response.text());
      if (!parsed.ok) return null;
      const failed = sortByCriterion(parsed.receipt.contracts.filter((c) => c.result === 'fail'));
      return failed.map((c) => (/^R\d+(?:\.\d+)?/.exec(c.name) || [clipMessage(c.name)])[0]);
    } catch {
      return null;
    }
  }

  // The gate's full run on the same code, from the receipts, next to every browser run (Req 13.5). It names what failed:
  // "9 of 18 failing: R2.1, R2.2 and R3.1", or "18 of 18 passing" when nothing failed. When the ids cannot be read the line
  // keeps its numbers and drops the list.
  async function fullRunLine(kind, full) {
    if (!full) return make('p', 'play-full', FULL_RUN_FAILED);
    const lead = "The gate's full run on the same code gave";
    if (full.failed === 0) return make('p', 'play-full', `${lead} ${full.passed} of ${full.total} passing.`);
    const ids = Array.isArray(full.failing) ? full.failing : await failingIds(kind);
    const named = ids && ids.length > 0 ? `: ${idList(ids)}` : '';
    return make('p', 'play-full', `${lead} ${full.failed} of ${full.total} failing${named}.`);
  }

  function scopeLine(ran, full) {
    const text = full
      ? `The browser ran ${ran} of the ledger's ${full.total} contracts. The other ${full.total - ran} start the ledger's command line, which a browser cannot do.`
      : `The browser ran ${ran} of the ledger's contracts. The rest start the ledger's command line, which a browser cannot do.`;
    return make('p', 'play-scope', text);
  }

  function playFileRow(f) {
    const li = make('li', `file status-${f.status}`);
    li.appendChild(make('span', 'state', STATUS_WORDS[f.status]));
    li.append(' ');
    li.appendChild(make('span', 'path', f.path));
    if (f.detail) li.appendChild(make('span', 'detail', f.detail));
    return li;
  }

  function pinCount(files) {
    const matched = files.filter((f) => f.status === 'match').length;
    const lost = files.filter((f) => f.status === 'unavailable').length;
    const head = matched === files.length ? `All ${files.length} pinned files match their copies.` : `${matched} of ${files.length} pinned files match their copies.`;
    return lost > 0 ? `${head} ${lost} could not be loaded.` : head;
  }

  // The risen receipt, read from the page's own folder. It comes with the result of recomputing its hash.
  async function loadRisen() {
    const response = await fetch(`${PLAY_BASE}${PLAY_DIR}/${RISEN_RECEIPT}`, requestOptions());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = parseReceipt(await response.text());
    if (!parsed.ok) throw new Error('not a receipt');
    return { receipt: parsed.receipt, matches: (await computeReceiptHash(parsed.receipt)) === parsed.receipt.receiptHash };
  }

  // Under the accepted run: the receipt the gate wrote for task 4, its hash recomputed here, its pinned files hashed again
  // from the copies (Req 13.3). Paths in it are the example's, which is why this lives in the play and not in the receipt card.
  async function appendRisenReceipt(box) {
    const wrap = make('div', 'play-receipt');
    wrap.appendChild(make('p', '', 'The receipt the gate wrote when it accepted task 4, checked here:'));
    try {
      const { receipt, matches } = await loadRisen();
      const badge = make('p', matches ? 'badge hash-match' : 'badge hash-altered', matches ? 'MATCH' : 'ALTERED');
      wrap.appendChild(badge);
      wrap.append(matches ? 'Its receipt hash, recomputed in your browser, matches.' : 'Its receipt hash, recomputed in your browser, does not match.');
      const checked = await checkCopies({ receipt, fetchFn: playFetch, base: PLAY_BASE });
      // The list starts closed. Its summary line says how many files match.
      const details = make('details', 'play-pins');
      details.appendChild(make('summary', '', pinCount(checked.files)));
      const list = make('ul', 'files');
      for (const f of checked.files) list.appendChild(playFileRow(f));
      details.appendChild(list);
      wrap.appendChild(details);
    } catch {
      wrap.appendChild(make('p', '', RISEN_FAILED));
    }
    box.appendChild(wrap);
  }

  // Steps 1 and 2: send the tick to the contracts, with the planted change or without it. Fills `box`, returns the words for
  // the live region.
  async function contractStep(kind, box) {
    const n = PLAY_STEPS[kind];
    let out;
    try {
      out = await runner({ run: kind, base: PLAY_BASE, fetchFn: playFetch });
    } catch {
      out = { ok: false, kind: 'run', message: PLAY_ERROR };
    }
    if (!out || typeof out !== 'object') out = { ok: false, kind: 'run', message: PLAY_ERROR };
    let full = out.ok ? undefined : out.full;
    if (full === undefined) {
      try {
        full = await fullRun(kind, PLAY_BASE, playFetch);
      } catch {
        full = null;
      }
    }
    // The verdict comes first, then the browser's share of the ledger and the gate's full run on the same code, and only
    // then the contract rows.
    const fullLine = await fullRunLine(kind, full);
    let words;
    box.textContent = '';
    if (out.ok) {
      const failed = out.results.filter((r) => r.result === 'fail').length;
      const total = out.results.length;
      if (failed > 0) {
        box.appendChild(verdictLine('refused', 'Refused.', `${failed} of the ${total} contracts the browser ran ${failed === 1 ? 'fails' : 'fail'}, so the tick is refused.`));
        words = `Step ${n} done: the gate refuses the tick. ${failed} of ${total} contracts fail.`;
      } else {
        box.appendChild(verdictLine('accepted', 'Accepted.', `All ${total} contracts the browser ran pass, so the tick is accepted.`));
        words = `Step ${n} done: the gate accepts the tick. All ${total} contracts pass.`;
      }
      box.appendChild(scopeLine(total, full));
      box.appendChild(fullLine);
      const list = make('ul', 'contracts');
      for (const r of out.results) list.appendChild(playRow(r));
      box.appendChild(list);
    } else {
      const message = clipMessage(out.message || PLAY_ERROR);
      box.appendChild(verdictLine('stopped', 'Stopped.', message));
      words = `Step ${n} stopped. ${message}`;
      box.appendChild(fullLine);
    }
    if (kind === 'fixed') await appendRisenReceipt(box);
    return words;
  }

  // Step 3: change one byte of the copy of src/split.js in memory and hash the pinned files again (Req 13.4). The browser
  // worker is not needed: this is a hash check.
  async function byteStep(box) {
    box.textContent = '';
    let receipt;
    try {
      ({ receipt } = await loadRisen());
    } catch {
      box.appendChild(verdictLine('stopped', 'Stopped.', RISEN_FAILED));
      return `Step 3 stopped. ${RISEN_FAILED}`;
    }
    const checked = await checkCopies({ receipt, fetchFn: playFetch, base: PLAY_BASE, change: { 'src/split.js': changeOneByte } });
    const line = mismatchLine(checked);
    const lost = checked.files.filter((f) => f.status === 'unavailable');
    if (line === null) {
      const message =
        lost.length > 0
          ? `The page could not load its copy of ${lost[0].path}${lost.length > 1 ? ` and ${lost.length - 1} more` : ''}, so it could not check.`
          : 'No pinned file changed.';
      box.appendChild(verdictLine('stopped', 'Stopped.', message));
      return `Step 3 stopped. ${message}`;
    }
    box.appendChild(make('p', 'play-verdict refused', line));
    box.appendChild(
      make(
        'p',
        '',
        'That is the line necro verify prints when a file a receipt pins has changed. The page changed one byte of its copy of src/split.js in memory, hashed it again and compared it with the pin. Nothing was stored.',
      ),
    );
    box.appendChild(make('p', 'summary', pinCount(checked.files)));
    const list = make('ul', 'files');
    for (const f of checked.files) if (f.status !== 'match') list.appendChild(playFileRow(f));
    box.appendChild(list);
    return `Step 3 done: ${line}`;
  }

  async function runStep(kind) {
    if (playBusy) return;
    playBusy = true;
    setPlayButtons(true);
    const box = els[`play-result-${kind}`];
    box.hidden = true;
    box.textContent = '';
    box.setAttribute('aria-busy', 'true');
    els['play-status'].textContent = `Running step ${PLAY_STEPS[kind]}...`;
    let words;
    try {
      words = await (kind === 'byte' ? byteStep(box) : contractStep(kind, box));
    } catch {
      box.textContent = '';
      box.appendChild(verdictLine('stopped', 'Stopped.', PLAY_ERROR));
      words = `Step ${PLAY_STEPS[kind]} stopped. ${PLAY_ERROR}`;
    } finally {
      playBusy = false;
      setPlayButtons(false);
    }
    box.setAttribute('aria-busy', 'false');
    box.hidden = false;
    els['play-status'].textContent = words;
    takeFocus(box);
  }

  // The start control is drawn only when scripts run. Using it opens the play below the story strip and moves focus to its
  // heading. It does not call the code that brings the verdict banner into view.
  function setUpPlay() {
    if (!els['strip-play'] || !els.play) return;
    els['strip-play'].className = els['strip-play'].className.split(/\s+/).filter((c) => c && c !== 'needs-script').join(' ');
    els['strip-play'].addEventListener('click', () => {
      els.play.hidden = false;
      els['strip-play'].setAttribute('aria-expanded', 'true');
      if (typeof els.play.scrollIntoView === 'function') els.play.scrollIntoView(scrollOptions({ reducedMotion: reducedMotion() }));
      takeFocus(els['play-title']);
    });
    els['play-send'].addEventListener('click', () => runStep('planted'));
    els['play-fix'].addEventListener('click', () => runStep('fixed'));
    els['play-byte'].addEventListener('click', () => runStep('byte'));
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
  setUpPlay();

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
