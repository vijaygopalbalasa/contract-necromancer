// Contracts for site/lib/files.js: R4.1, R4.2 and R4.3 of the receipt-viewer spec.
//
// fetch is replaced by a stub that answers from a table and records every URL it is asked for, so nothing here
// touches the network. The module under test is loaded with a dynamic import inside each test, so this file always
// loads and every contract name is registered even while the viewer does not exist yet.
//
// Dynamic imports are not followed by necro's import tracing, so the modules are also named below the way a static
// import would name them. Keep these lines: the receipt pins files it finds this way.
//   import {} from '../../site/lib/files.js';
//   import {} from '../../site/lib/receipt.js';
//   import {} from '../../site/lib/repo.js';
//   import {} from '../../site/lib/canon.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const FILES_URL = new URL('../../site/lib/files.js', import.meta.url);

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const REPO = 'octo/spec-repo';

const REQ_PATH = '.kiro/specs/demo/requirements.md';
const CONTRACT_PATH = 'contracts/demo/a.contract.test.js';
const BINARY_PATH = 'src/binary.js';
const CHANGED_PATH = 'src/changed.js';

// What each pinned file really contains in the public repository at COMMIT.
const BINARY_BYTES = Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a, 0x80, 0x7f]); // not valid UTF-8, has CRLF
const FILES = new Map([
  [REQ_PATH, Buffer.from('# Demo requirements\r\n', 'utf8')],
  [CONTRACT_PATH, Buffer.from("import { test } from 'node:test';\n", 'utf8')],
  [BINARY_PATH, BINARY_BYTES],
  [CHANGED_PATH, Buffer.from('export const v = 2;\n', 'utf8')], // what the repository serves
]);

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const rawUrl = (p) => `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${p}`;

function receipt(overrides = {}) {
  return {
    spec: 'demo',
    gitCommit: COMMIT,
    requirements: { path: REQ_PATH, sha256: sha(FILES.get(REQ_PATH)) },
    contracts: [
      // Two contracts in one file: the file is one pinned file and is checked once.
      { name: 'R1.1 a', path: CONTRACT_PATH, sha256: sha(FILES.get(CONTRACT_PATH)), result: 'pass' },
      { name: 'R1.2 b', path: CONTRACT_PATH, sha256: sha(FILES.get(CONTRACT_PATH)), result: 'pass' },
    ],
    sources: [
      { path: BINARY_PATH, sha256: sha(BINARY_BYTES) },
      // The receipt pins the old content; the repository serves different content.
      { path: CHANGED_PATH, sha256: sha(Buffer.from('export const v = 1;\n', 'utf8')) },
    ],
    uncommitted: [],
    receiptHash: 'd'.repeat(64),
    ...overrides,
  };
}

// A fetch stub: answers from FILES by URL, 404 for anything else, and records the URLs it was asked for.
function stubFetch() {
  const calls = [];
  const fetchFn = async (url) => {
    const u = String(url);
    calls.push(u);
    for (const [p, bytes] of FILES) {
      if (u === rawUrl(p)) return new Response(bytes, { status: 200 });
    }
    return new Response('Not Found', { status: 404 });
  };
  return { fetchFn, calls };
}

const byPath = (result, p) => result.files.filter((f) => f.path === p);

test('R4.1 each pinned file is fetched at the commit, hashed, and marked matching or different', async () => {
  const { checkFiles } = await import(FILES_URL.href);
  const { fetchFn, calls } = stubFetch();

  const result = await checkFiles({ receipt: receipt(), repo: REPO, fetchFn });
  assert.equal(result.ok, true);

  // Every pinned file is requested once, from raw.githubusercontent.com at the receipt's commit.
  assert.deepEqual([...calls].sort(), [REQ_PATH, CONTRACT_PATH, BINARY_PATH, CHANGED_PATH].map(rawUrl).sort());

  // One row per pinned file.
  assert.equal(result.files.length, 4);
  for (const p of [REQ_PATH, CONTRACT_PATH, BINARY_PATH, CHANGED_PATH]) {
    assert.equal(byPath(result, p).length, 1, `${p} must have exactly one row`);
  }

  // The hash is taken over the raw bytes: CRLF and bytes that are not UTF-8 still match.
  assert.equal(byPath(result, REQ_PATH)[0].status, 'match');
  assert.equal(byPath(result, CONTRACT_PATH)[0].status, 'match');
  assert.equal(byPath(result, BINARY_PATH)[0].status, 'match');

  // Different content is marked different and carries the hash that was found.
  const changed = byPath(result, CHANGED_PATH)[0];
  assert.equal(changed.status, 'different');
  assert.equal(changed.expected, sha(Buffer.from('export const v = 1;\n', 'utf8')));
  assert.equal(changed.actual, sha(FILES.get(CHANGED_PATH)));

  // A file the repository does not have is "could not check", not "different": the page did not see the content.
  const missing = receipt({ sources: [{ path: 'src/not-in-repo.js', sha256: 'e'.repeat(64) }] });
  const second = stubFetch();
  const missingResult = await checkFiles({ receipt: missing, repo: REPO, fetchFn: second.fetchFn });
  assert.equal(missingResult.ok, true);
  const gone = byPath(missingResult, 'src/not-in-repo.js')[0];
  assert.equal(gone.status, 'unavailable');
  assert.notEqual(gone.status, 'different');

  // A network failure is also "could not check".
  const offline = await checkFiles({
    receipt: receipt(),
    repo: REPO,
    fetchFn: async () => {
      throw new TypeError('network down');
    },
  });
  assert.equal(offline.ok, true);
  assert.ok(offline.files.length > 0);
  assert.ok(offline.files.every((f) => f.status === 'unavailable'));
});

test('R4.2 a receipt with no commit gets a message that the file check needs a commit', async () => {
  const { checkFiles } = await import(FILES_URL.href);

  const noKey = receipt();
  delete noKey.gitCommit;
  for (const [label, r] of [
    ['gitCommit is null', receipt({ gitCommit: null })],
    ['gitCommit is missing', noKey],
  ]) {
    const { fetchFn, calls } = stubFetch();
    const result = await checkFiles({ receipt: r, repo: REPO, fetchFn });
    assert.equal(result.ok, false, `${label}: the check must not run`);
    assert.equal(typeof result.message, 'string');
    assert.match(result.message, /file check needs a (git )?commit/i, `${label}: the message must say the check needs a commit`);
    assert.ok(!/[\r\n]/.test(result.message), `${label}: the message must be one line`);
    assert.equal(calls.length, 0, `${label}: nothing may be fetched`);
  }
});

test('R4.3 a file in uncommitted is marked not in the commit yet, not different', async () => {
  const { checkFiles } = await import(FILES_URL.href);

  // CHANGED_PATH is listed in uncommitted. The repository serves other content for it, so a fetch would say
  // "different"; the page must not ask and must not accuse.
  const { fetchFn, calls } = stubFetch();
  const result = await checkFiles({
    receipt: receipt({ uncommitted: [CHANGED_PATH] }),
    repo: REPO,
    fetchFn,
  });
  assert.equal(result.ok, true);
  const row = byPath(result, CHANGED_PATH)[0];
  assert.equal(row.status, 'uncommitted');
  assert.notEqual(row.status, 'different');
  assert.ok(!calls.includes(rawUrl(CHANGED_PATH)), 'a file that is not in the commit must not be fetched');
  assert.equal(result.anyUncommitted, true);

  // The other files are still checked.
  assert.equal(byPath(result, REQ_PATH)[0].status, 'match');
  assert.equal(byPath(result, BINARY_PATH)[0].status, 'match');
  assert.deepEqual([...calls].sort(), [REQ_PATH, CONTRACT_PATH, BINARY_PATH].map(rawUrl).sort());

  // Nothing uncommitted: the flag is false.
  const clean = await checkFiles({ receipt: receipt(), repo: REPO, fetchFn: stubFetch().fetchFn });
  assert.equal(clean.anyUncommitted, false);

  // Every file uncommitted: no request at all, every row says so.
  const all = stubFetch();
  const allResult = await checkFiles({
    receipt: receipt({ uncommitted: [REQ_PATH, CONTRACT_PATH, BINARY_PATH, CHANGED_PATH] }),
    repo: REPO,
    fetchFn: all.fetchFn,
  });
  assert.equal(allResult.ok, true);
  assert.equal(all.calls.length, 0);
  assert.equal(allResult.files.length, 4);
  assert.ok(allResult.files.every((f) => f.status === 'uncommitted'));
  assert.equal(allResult.anyUncommitted, true);
});
