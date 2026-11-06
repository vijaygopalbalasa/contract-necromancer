import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseReceipt, MAX_RECEIPT_BYTES } from '../site/lib/receipt.js';

const fixtureText = fs.readFileSync(new URL('./fixtures/receipt-valid.json', import.meta.url), 'utf8');
const fixture = () => JSON.parse(fixtureText);

function assertSentence(message, label) {
  assert.equal(typeof message, 'string', label);
  assert.ok(message.length > 0 && message.length <= 200, `${label}: length`);
  assert.ok(!/[\r\n]/.test(message), `${label}: one line`);
  assert.ok(message.endsWith('.'), `${label}: ends with a full stop`);
  // One sentence that says what to do next: the first full stop is followed by an instruction, never by a second
  // sentence about internals. A message may name a path such as ".necro/receipts/" or "1 MB".
  assert.doesNotMatch(message, /SyntaxError|TypeError|Unexpected token|at position|undefined|\[object/, label);
  assert.match(message, /\b(Paste|Open|Choose|Use|Check|Pick|Try)\b/, `${label}: says what to do next`);
}

// ---- Task 3: parseReceipt ----

test('parseReceipt accepts the valid fixture and returns it whole', () => {
  const parsed = parseReceipt(fixtureText);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.receipt, fixture());
});

test('parseReceipt accepts null gitCommit, no sources, no uncommitted, and unknown extra fields', () => {
  const r = fixture();
  r.gitCommit = null;
  delete r.sources;
  delete r.uncommitted;
  delete r.createdAt;
  r.somethingNew = { nested: [1, 2, 3] };
  const parsed = parseReceipt(JSON.stringify(r));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.receipt, r);
});

test('parseReceipt accepts a receipt without task and required (older receipts)', () => {
  const r = fixture();
  delete r.task;
  delete r.required;
  assert.equal(parseReceipt(JSON.stringify(r)).ok, true);
  r.task = null;
  assert.equal(parseReceipt(JSON.stringify(r)).ok, true);
});

test('parseReceipt still accepts a receipt whose hash does not match (validation is structural)', () => {
  const r = fixture();
  r.contracts[0].result = r.contracts[0].result === 'pass' ? 'fail' : 'pass';
  assert.equal(parseReceipt(JSON.stringify(r)).ok, true);
});

test('parseReceipt refuses bad input with one plain sentence and never throws', () => {
  const without = (k) => {
    const r = fixture();
    delete r[k];
    return JSON.stringify(r);
  };
  const change = (c) => JSON.stringify({ ...fixture(), ...c });
  const c0 = (patch) => {
    const r = fixture();
    r.contracts[0] = { ...r.contracts[0], ...patch };
    return JSON.stringify(r);
  };
  const cases = [
    ['empty', ''],
    ['blank', '  \n '],
    ['not JSON', 'hello there'],
    ['truncated', '{"spec": "x"'],
    ['array', '[]'],
    ['string', '"receipt"'],
    ['null', 'null'],
    ['number', '12'],
    ['no spec', without('spec')],
    ['spec number', change({ spec: 3 })],
    ['no receiptHash', without('receiptHash')],
    ['short receiptHash', change({ receiptHash: 'abc' })],
    ['uppercase receiptHash', change({ receiptHash: 'A'.repeat(64) })],
    ['no requirements', without('requirements')],
    ['requirements without sha256', change({ requirements: { path: 'r.md' } })],
    ['requirements without path', change({ requirements: { sha256: 'a'.repeat(64) } })],
    ['no contracts', without('contracts')],
    ['contracts string', change({ contracts: 'x' })],
    ['contracts empty', change({ contracts: [] })],
    ['contract not an object', change({ contracts: ['x'] })],
    ['contract result maybe', c0({ result: 'maybe' })],
    ['contract no name', c0({ name: undefined })],
    ['contract no path', c0({ path: undefined })],
    ['contract bad sha256', c0({ sha256: 'nope' })],
    ['gitCommit number', change({ gitCommit: 5 })],
    ['sources not array', change({ sources: 'x' })],
    ['source without path', change({ sources: [{ sha256: 'a'.repeat(64) }] })],
    ['uncommitted not strings', change({ uncommitted: [1] })],
    ['createdAt number', change({ createdAt: 1 })],
    ['task not an object', change({ task: 'x' })],
    ['required not strings', change({ required: [1] })],
    ['over the size limit', JSON.stringify({ ...fixture(), padding: 'x'.repeat(MAX_RECEIPT_BYTES + 1) })],
    ['not a string', undefined],
  ];
  for (const [label, text] of cases) {
    let parsed;
    assert.doesNotThrow(() => {
      parsed = parseReceipt(text);
    }, label);
    assert.equal(parsed.ok, false, label);
    assertSentence(parsed.message, label);
    assert.equal(parsed.receipt, undefined, label);
  }
});

test('parseReceipt messages name the problem', () => {
  const r = fixture();
  delete r.contracts;
  assert.match(parseReceipt(JSON.stringify(r)).message, /"contracts"/);
  assert.match(parseReceipt('nope').message, /not valid JSON/);
  assert.match(parseReceipt('x'.repeat(MAX_RECEIPT_BYTES + 1)).message, /1 MB/);
  assert.equal(MAX_RECEIPT_BYTES, 1_000_000);
});

test('parseReceipt measures the size limit in bytes, not characters', () => {
  const text = JSON.stringify({ ...fixture(), padding: '😀'.repeat(MAX_RECEIPT_BYTES / 4 + 1) });
  assert.ok(text.length < MAX_RECEIPT_BYTES);
  assert.equal(parseReceipt(text).ok, false);
});

// ---- Task 4: summarize, groupContracts, pinnedFiles ----

const H = (c) => c.repeat(64);
const contract = (name, result = 'pass', file = 'a') => ({
  name,
  path: `contracts/demo/${file}.contract.test.js`,
  sha256: H(file === 'a' ? 'a' : 'b'),
  result,
});

test('summarize returns spec, commit, hash, totals and every contract in receipt order', async () => {
  const { summarize } = await import('../site/lib/receipt.js');
  const r = fixture();
  r.contracts = [contract('R1.1 x'), contract('R1.2 y', 'fail'), contract('plain'), contract('R1.1 x', 'fail', 'b')];
  const before = JSON.stringify(r);
  const s = summarize(r);
  assert.equal(JSON.stringify(r), before, 'receipt not changed');
  assert.equal(s.spec, r.spec);
  assert.equal(s.gitCommit, r.gitCommit);
  assert.equal(s.receiptHash, r.receiptHash);
  assert.equal(s.total, 4);
  assert.equal(s.passed, 2);
  assert.equal(s.failed, 2);
  assert.deepEqual(
    s.contracts.map((c) => [c.name, c.result]),
    [['R1.1 x', 'pass'], ['R1.2 y', 'fail'], ['plain', 'pass'], ['R1.1 x', 'fail']],
  );
});

test('summarize keeps a null or missing gitCommit as null', async () => {
  const { summarize } = await import('../site/lib/receipt.js');
  const r = fixture();
  r.gitCommit = null;
  assert.equal(summarize(r).gitCommit, null);
  delete r.gitCommit;
  assert.equal(summarize(r).gitCommit, null);
});

test('summarize marks contracts required or not yet required only when the receipt has task and required', async () => {
  const { summarize } = await import('../site/lib/receipt.js');
  const r = fixture();
  r.task = { id: '1', line: '1. Do it (Req 1.1)' };
  r.contracts = [contract('R1.1 a'), contract('R2.1 b', 'fail')];
  r.required = ['R1.1 a'];
  const s = summarize(r);
  assert.equal(s.task, '1. Do it (Req 1.1)');
  assert.deepEqual(s.contracts.map((c) => c.required), [true, false]);

  const noTask = { ...r, task: null };
  const s2 = summarize(noTask);
  assert.equal(s2.task, null);
  assert.deepEqual(s2.contracts.map((c) => c.required), [null, null]);

  const noRequired = { ...r };
  delete noRequired.required;
  assert.deepEqual(summarize(noRequired).contracts.map((c) => c.required), [null, null]);
});

test('groupContracts groups by requirement number, numerically, with Other last', async () => {
  const { groupContracts } = await import('../site/lib/receipt.js');
  const groups = groupContracts([
    contract('R10.1 ten'),
    contract('R2.1 two', 'fail'),
    contract('R1.2 b'),
    contract('plain'),
    contract('R1.10 c', 'fail'),
    contract('handles R1.2 in the middle'),
    contract('R1.1 a'),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.requirement, g.title, g.contracts.map((c) => c.name), g.passed, g.total]),
    [
      [1, 'Requirement 1', ['R1.2 b', 'R1.10 c', 'R1.1 a'], 2, 3],
      [2, 'Requirement 2', ['R2.1 two'], 0, 1],
      [10, 'Requirement 10', ['R10.1 ten'], 1, 1],
      [null, 'Other', ['plain', 'handles R1.2 in the middle'], 2, 2],
    ],
  );
});

test('groupContracts has no Other group when every name has a number', async () => {
  const { groupContracts } = await import('../site/lib/receipt.js');
  assert.deepEqual(groupContracts([contract('R2.1 b'), contract('R1.1 a')]).map((g) => g.requirement), [1, 2]);
});

test('groupContracts returns one flat group when no name has a number', async () => {
  const { groupContracts } = await import('../site/lib/receipt.js');
  const groups = groupContracts([contract('alpha'), contract('beta', 'fail')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'Contracts');
  assert.equal(groups[0].requirement, null);
  assert.deepEqual(groups[0].contracts.map((c) => c.name), ['alpha', 'beta']);
  assert.equal(groups[0].passed, 1);
  assert.equal(groups[0].total, 2);
});

test('groupContracts does not group a name that only contains R1.2 in the middle', async () => {
  const { groupContracts } = await import('../site/lib/receipt.js');
  const groups = groupContracts([contract('handles R1.2 in the middle')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'Contracts');
});

test('pinnedFiles lists requirements, contract files and sources once per (path, sha256)', async () => {
  const { pinnedFiles } = await import('../site/lib/receipt.js');
  const r = {
    requirements: { path: 'req.md', sha256: H('1') },
    contracts: [
      { name: 'R1.1 a', path: 'c/a.js', sha256: H('2'), result: 'pass' },
      { name: 'R1.2 b', path: 'c/a.js', sha256: H('2'), result: 'pass' },
      { name: 'R2.1 c', path: 'c/b.js', sha256: H('3'), result: 'pass' },
    ],
    sources: [
      { path: 'src/x.js', sha256: H('4') },
      { path: 'src/x.js', sha256: H('4') },
    ],
  };
  assert.deepEqual(pinnedFiles(r), [
    { kind: 'requirements', path: 'req.md', sha256: H('1') },
    { kind: 'contract', path: 'c/a.js', sha256: H('2') },
    { kind: 'contract', path: 'c/b.js', sha256: H('3') },
    { kind: 'source', path: 'src/x.js', sha256: H('4') },
  ]);
});

test('pinnedFiles keeps two rows for one path with two hashes, and copes with no sources', async () => {
  const { pinnedFiles } = await import('../site/lib/receipt.js');
  const r = {
    requirements: { path: 'req.md', sha256: H('1') },
    contracts: [
      { name: 'R1.1 a', path: 'c/a.js', sha256: H('2'), result: 'pass' },
      { name: 'R1.2 b', path: 'c/a.js', sha256: H('3'), result: 'pass' },
    ],
  };
  const files = pinnedFiles(r);
  assert.deepEqual(files.filter((f) => f.path === 'c/a.js').map((f) => f.sha256), [H('2'), H('3')]);
  assert.equal(files.length, 3);
});
