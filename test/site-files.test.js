import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkFiles } from '../site/lib/files.js';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const REPO = 'octo/spec-repo';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const url = (p) => `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${p}`;

const BINARY = Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a, 0x80, 0x7f]); // CRLF and not valid UTF-8
const CRLF = Buffer.from('line one\r\nline two\r\n', 'utf8');
const SERVED = new Map([
  ['req.md', CRLF],
  ['contracts/a.contract.test.js', Buffer.from('test\n', 'utf8')],
  ['src/bin.js', BINARY],
  ['src/changed.js', Buffer.from('new\n', 'utf8')],
]);

function receipt(over = {}) {
  return {
    spec: 'demo',
    gitCommit: COMMIT,
    requirements: { path: 'req.md', sha256: sha(CRLF) },
    contracts: [
      { name: 'R1.1 a', path: 'contracts/a.contract.test.js', sha256: sha(SERVED.get('contracts/a.contract.test.js')), result: 'pass' },
      { name: 'R1.2 b', path: 'contracts/a.contract.test.js', sha256: sha(SERVED.get('contracts/a.contract.test.js')), result: 'pass' },
    ],
    sources: [
      { path: 'src/bin.js', sha256: sha(BINARY) },
      { path: 'src/changed.js', sha256: sha(Buffer.from('old\n', 'utf8')) },
    ],
    uncommitted: [],
    receiptHash: 'd'.repeat(64),
    ...over,
  };
}

function stub(served = SERVED) {
  const calls = [];
  const options = [];
  const fetchFn = async (u, opts) => {
    calls.push(String(u));
    options.push(opts);
    for (const [p, bytes] of served) if (String(u) === url(p)) return new Response(bytes, { status: 200 });
    return new Response('Not Found', { status: 404 });
  };
  return { fetchFn, calls, options };
}

const row = (result, p) => result.files.filter((f) => f.path === p);

// ---- 4.1 ----

test('checkFiles requests each pinned file once at the commit and marks match or different', async () => {
  const { fetchFn, calls } = stub();
  const result = await checkFiles({ receipt: receipt(), repo: REPO, fetchFn });
  assert.equal(result.ok, true);
  assert.deepEqual([...calls].sort(), ['req.md', 'contracts/a.contract.test.js', 'src/bin.js', 'src/changed.js'].map(url).sort());
  assert.equal(result.files.length, 4);
  assert.equal(row(result, 'req.md')[0].status, 'match');
  assert.equal(row(result, 'req.md')[0].kind, 'requirements');
  assert.equal(row(result, 'contracts/a.contract.test.js')[0].status, 'match');
  assert.equal(row(result, 'contracts/a.contract.test.js')[0].kind, 'contract');
  assert.equal(row(result, 'src/bin.js')[0].status, 'match', 'raw bytes, not text');
  const changed = row(result, 'src/changed.js')[0];
  assert.equal(changed.kind, 'source');
  assert.equal(changed.status, 'different');
  assert.equal(changed.expected, sha(Buffer.from('old\n', 'utf8')));
  assert.equal(changed.actual, sha(Buffer.from('new\n', 'utf8')));
  assert.equal(result.anyUncommitted, false);
});

test('checkFiles sends requests without credentials or referrer and with a timeout signal', async () => {
  const { fetchFn, options } = stub();
  await checkFiles({ receipt: receipt(), repo: REPO, fetchFn });
  assert.ok(options.length > 0);
  for (const o of options) {
    assert.equal(o.credentials, 'omit');
    assert.equal(o.referrerPolicy, 'no-referrer');
    assert.ok(o.signal instanceof AbortSignal);
  }
});

test('checkFiles marks a 404 and a thrown fetch as unavailable, never different', async () => {
  const missing = await checkFiles({ receipt: receipt({ sources: [{ path: 'src/gone.js', sha256: 'e'.repeat(64) }] }), repo: REPO, fetchFn: stub().fetchFn });
  const gone = row(missing, 'src/gone.js')[0];
  assert.equal(gone.status, 'unavailable');
  assert.match(gone.detail, /404/);
  assert.match(gone.detail, /public/);

  const offline = await checkFiles({
    receipt: receipt(),
    repo: REPO,
    fetchFn: async () => {
      throw new TypeError('network down');
    },
  });
  assert.equal(offline.ok, true);
  assert.equal(offline.files.length, 4);
  for (const f of offline.files) {
    assert.equal(f.status, 'unavailable');
    assert.equal(f.actual, undefined);
    assert.match(f.detail, /Could not reach raw\.githubusercontent\.com\./);
  }
});

test('checkFiles runs at most `concurrency` requests at once', async () => {
  const sources = Array.from({ length: 20 }, (_, i) => ({ path: `src/f${i}.js`, sha256: 'a'.repeat(64) }));
  let active = 0;
  let peak = 0;
  const fetchFn = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return new Response('x', { status: 200 });
  };
  const result = await checkFiles({ receipt: receipt({ sources }), repo: REPO, fetchFn, concurrency: 3 });
  assert.equal(result.files.length, 22);
  assert.ok(peak <= 3, `peak ${peak}`);
  assert.ok(peak > 1, 'requests do run in parallel');
  const def = await checkFiles({ receipt: receipt({ sources }), repo: REPO, fetchFn });
  assert.equal(def.files.length, 22);
  assert.ok(peak <= 6);
});

test('checkFiles keeps pinned order in the result', async () => {
  const result = await checkFiles({ receipt: receipt(), repo: REPO, fetchFn: stub().fetchFn });
  assert.deepEqual(result.files.map((f) => f.path), ['req.md', 'contracts/a.contract.test.js', 'src/bin.js', 'src/changed.js']);
});

test('checkFiles does not request an unsafe path and marks it unavailable', async () => {
  const { fetchFn, calls } = stub();
  const result = await checkFiles({
    receipt: receipt({ sources: [{ path: '../secret', sha256: 'a'.repeat(64) }, { path: '/etc/passwd', sha256: 'a'.repeat(64) }, { path: 'a/../b', sha256: 'a'.repeat(64) }] }),
    repo: REPO,
    fetchFn,
  });
  for (const p of ['../secret', '/etc/passwd', 'a/../b']) {
    assert.equal(row(result, p)[0].status, 'unavailable', p);
    assert.match(row(result, p)[0].detail, /not safe/);
  }
  assert.equal(calls.length, 2, 'only req.md and the contract were requested');
  assert.ok(calls.every((c) => c.startsWith(`https://raw.githubusercontent.com/${REPO}/${COMMIT}/`)));
});

test('checkFiles refuses an invalid repository before any request', async () => {
  for (const repo of ['', 'octo', 'a/b/c', 'o/n; ls']) {
    const { fetchFn, calls } = stub();
    const result = await checkFiles({ receipt: receipt(), repo, fetchFn });
    assert.equal(result.ok, false);
    assert.match(result.message, /owner\/name/);
    assert.equal(calls.length, 0);
  }
});

// ---- 4.2 ----

test('checkFiles says the file check needs a commit and never fetches when there is none', async () => {
  const noKey = receipt();
  delete noKey.gitCommit;
  for (const r of [receipt({ gitCommit: null }), noKey, receipt({ gitCommit: 'main' }), receipt({ gitCommit: COMMIT.toUpperCase() }), receipt({ gitCommit: 7 })]) {
    const { fetchFn, calls } = stub();
    const result = await checkFiles({ receipt: r, repo: REPO, fetchFn });
    assert.equal(result.ok, false);
    assert.match(result.message, /file check needs a git commit/);
    assert.ok(result.message.endsWith('.'));
    assert.ok(!/[\r\n]/.test(result.message));
    assert.equal(calls.length, 0);
  }
  const none = await checkFiles({ receipt: receipt({ gitCommit: null }), repo: REPO, fetchFn: stub().fetchFn });
  assert.match(none.message, /Run the gate inside a git repository/);
  const bad = await checkFiles({ receipt: receipt({ gitCommit: 'main' }), repo: REPO, fetchFn: stub().fetchFn });
  assert.match(bad.message, /not a valid commit id/);
});

// ---- 4.3 ----

test('checkFiles marks a file in uncommitted as uncommitted, never fetches it, and never calls it different', async () => {
  const { fetchFn, calls } = stub();
  const result = await checkFiles({ receipt: receipt({ uncommitted: ['src/changed.js'] }), repo: REPO, fetchFn });
  assert.equal(result.ok, true);
  assert.equal(row(result, 'src/changed.js')[0].status, 'uncommitted');
  assert.ok(!calls.includes(url('src/changed.js')));
  assert.equal(result.anyUncommitted, true);
  assert.equal(row(result, 'req.md')[0].status, 'match');
  assert.equal(calls.length, 3);
  assert.ok(result.files.every((f) => f.status !== 'different'));
});

test('checkFiles makes no request when every file is uncommitted', async () => {
  const { fetchFn, calls } = stub();
  const all = ['req.md', 'contracts/a.contract.test.js', 'src/bin.js', 'src/changed.js'];
  const result = await checkFiles({ receipt: receipt({ uncommitted: all }), repo: REPO, fetchFn });
  assert.equal(calls.length, 0);
  assert.equal(result.files.length, 4);
  assert.ok(result.files.every((f) => f.status === 'uncommitted'));
  assert.equal(result.anyUncommitted, true);
});

test('checkFiles treats an uncommitted file before an unsafe-path check, and ignores a missing uncommitted list', async () => {
  const r = receipt({ sources: [{ path: '../x', sha256: 'a'.repeat(64) }], uncommitted: ['../x'] });
  const result = await checkFiles({ receipt: r, repo: REPO, fetchFn: stub().fetchFn });
  assert.equal(row(result, '../x')[0].status, 'uncommitted');
  const r2 = receipt();
  delete r2.uncommitted;
  const ok = await checkFiles({ receipt: r2, repo: REPO, fetchFn: stub().fetchFn });
  assert.equal(ok.ok, true);
  assert.equal(ok.anyUncommitted, false);
});
