// Contracts for site/lib/receipt.js: R1.3, R2.1 and R2.2 of the receipt-viewer spec.
//
// The module under test is loaded with a dynamic import inside each test, so this file always loads and every
// contract name is registered even while the viewer does not exist yet.
//
// Dynamic imports are not followed by necro's import tracing, so the module is also named below the way a static
// import would name it. Keep this line: the receipt pins files it finds this way.
//   import {} from '../../site/lib/receipt.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RECEIPT_URL = new URL('../../site/lib/receipt.js', import.meta.url);

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

function validReceipt() {
  return {
    spec: 'demo',
    gitCommit: COMMIT,
    requirements: { path: '.kiro/specs/demo/requirements.md', sha256: 'a'.repeat(64) },
    contracts: [
      { name: 'R1.1 first', path: 'contracts/demo/a.contract.test.js', sha256: 'b'.repeat(64), result: 'pass' },
      { name: 'R1.2 second', path: 'contracts/demo/a.contract.test.js', sha256: 'b'.repeat(64), result: 'fail' },
    ],
    sources: [{ path: 'src/util.js', sha256: 'c'.repeat(64) }],
    uncommitted: [],
    task: { id: '1', line: '1. Do it (Req 1.1)' },
    required: ['R1.1 first'],
    receiptHash: 'd'.repeat(64),
    createdAt: '2026-11-07T00:00:00.000Z',
    extraField: { kept: true },
  };
}

// A plain message is one line of ordinary words that ends with a full stop and shows no engine error text.
function assertPlainSentence(message, label) {
  assert.equal(typeof message, 'string', `${label}: message must be a string`);
  assert.ok(message.trim().length > 0, `${label}: message must not be empty`);
  assert.ok(!/[\r\n]/.test(message), `${label}: message must be one line`);
  assert.ok(message.length <= 200, `${label}: message must be short`);
  assert.ok(message.trim().endsWith('.'), `${label}: message must end with a full stop`);
  assert.doesNotMatch(message, /SyntaxError|TypeError|Unexpected token|in JSON at position|JSON\.parse|undefined|\[object|\bat \S+:\d+/, `${label}: message must not show engine error text`);
}

test('R1.3 input that is not a valid receipt gets one plain sentence', async () => {
  const { parseReceipt, MAX_RECEIPT_BYTES } = await import(RECEIPT_URL.href);

  // Valid input is accepted and the receipt comes back whole, unknown fields included.
  const good = validReceipt();
  for (const text of [JSON.stringify(good), JSON.stringify(good, null, 2)]) {
    const parsed = parseReceipt(text);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.receipt, good);
  }

  const withoutKey = (key) => {
    const r = validReceipt();
    delete r[key];
    return JSON.stringify(r);
  };
  const withChange = (change) => JSON.stringify({ ...validReceipt(), ...change });
  const oversize = JSON.stringify({ ...validReceipt(), padding: 'x'.repeat(MAX_RECEIPT_BYTES + 1) });

  // [label, input text, pattern the message must match so it says what is wrong]
  const bad = [
    ['empty text', '', /./],
    ['blank text', '   \n ', /./],
    ['not JSON', 'this is not json', /JSON/],
    ['truncated JSON', '{"spec": "demo"', /JSON/],
    ['JSON array', '[]', /receipt/i],
    ['JSON string', '"hello"', /receipt/i],
    ['JSON null', 'null', /receipt/i],
    ['JSON number', '42', /receipt/i],
    ['missing spec', withoutKey('spec'), /spec/],
    ['spec is not a string', withChange({ spec: 5 }), /spec/],
    ['missing receiptHash', withoutKey('receiptHash'), /receiptHash/],
    ['receiptHash is not 64 hex', withChange({ receiptHash: 'xyz' }), /receiptHash/],
    ['receiptHash in capitals', withChange({ receiptHash: 'D'.repeat(64) }), /receiptHash/],
    ['missing requirements', withoutKey('requirements'), /requirements/],
    ['requirements without a hash', withChange({ requirements: { path: 'r.md' } }), /requirements/],
    ['missing contracts', withoutKey('contracts'), /contracts/],
    ['contracts is not an array', withChange({ contracts: 'nope' }), /contracts/],
    ['contracts is empty', withChange({ contracts: [] }), /contracts/],
    [
      'result is neither pass nor fail',
      withChange({ contracts: [{ name: 'R1.1 a', path: 'p.js', sha256: 'b'.repeat(64), result: 'maybe' }] }),
      /result/,
    ],
    [
      'contract without a name',
      withChange({ contracts: [{ path: 'p.js', sha256: 'b'.repeat(64), result: 'pass' }] }),
      /name|contract/i,
    ],
    ['larger than the limit', oversize, /large|big|size|MB|limit/i],
  ];
  for (const [label, text, says] of bad) {
    let parsed;
    assert.doesNotThrow(() => {
      parsed = parseReceipt(text);
    }, `${label}: parseReceipt must not throw`);
    assert.equal(parsed.ok, false, `${label}: must be refused`);
    assertPlainSentence(parsed.message, label);
    assert.match(parsed.message, says, `${label}: message must say what is wrong`);
    assert.equal(parsed.receipt, undefined, `${label}: no receipt may come back`);
  }
});

test('R2.1 every contract is listed by name with pass or fail, with spec, commit and receipt hash', async () => {
  const { summarize } = await import(RECEIPT_URL.href);

  const receipt = validReceipt();
  receipt.contracts = [
    { name: 'R1.1 first', path: 'contracts/demo/a.contract.test.js', sha256: 'b'.repeat(64), result: 'pass' },
    { name: 'R1.2 second', path: 'contracts/demo/a.contract.test.js', sha256: 'b'.repeat(64), result: 'fail' },
    { name: 'plain name', path: 'contracts/demo/b.contract.test.js', sha256: 'e'.repeat(64), result: 'pass' },
    // The same name in another file is a different contract and must stay in the list.
    { name: 'R1.1 first', path: 'contracts/demo/b.contract.test.js', sha256: 'e'.repeat(64), result: 'fail' },
  ];
  const before = JSON.stringify(receipt);
  const summary = summarize(receipt);
  assert.equal(JSON.stringify(receipt), before, 'summarize must not change the receipt');

  assert.equal(summary.spec, 'demo');
  assert.equal(summary.gitCommit, COMMIT);
  assert.equal(summary.receiptHash, receipt.receiptHash);
  assert.equal(summary.total, 4);
  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 2);

  // The list of contracts is the array in the summary whose items carry a name and a result.
  const lists = Object.values(summary).filter(
    (v) => Array.isArray(v) && v.length > 0 && v.every((c) => c && typeof c === 'object' && 'name' in c && 'result' in c),
  );
  assert.equal(lists.length, 1, 'the summary must hold exactly one list of contracts with name and result');
  assert.deepEqual(
    lists[0].map((c) => [c.name, c.result]),
    [
      ['R1.1 first', 'pass'],
      ['R1.2 second', 'fail'],
      ['plain name', 'pass'],
      ['R1.1 first', 'fail'],
    ],
    'every contract is listed once, in receipt order, with its result',
  );

  // A receipt without a commit keeps null, so the page can say there is none.
  assert.equal(summarize({ ...receipt, gitCommit: null }).gitCommit, null);
});

test('R2.2 contracts named R<n>.<m> are grouped by requirement', async () => {
  const { groupContracts } = await import(RECEIPT_URL.href);

  const c = (name, result = 'pass') => ({ name, path: 'contracts/demo/a.contract.test.js', sha256: 'b'.repeat(64), result });
  const contracts = [
    c('R10.1 ten'),
    c('R2.1 two', 'fail'),
    c('R1.2 one b'),
    c('plain name'),
    c('R1.10 one c', 'fail'),
    c('handles R1.2 in the middle'),
    c('R1.1 one a'),
  ];
  const groups = groupContracts(contracts);
  const summary = groups.map((g) => [g.requirement, g.title, g.contracts.map((x) => x.name), g.passed, g.total]);
  assert.deepEqual(summary, [
    [1, 'Requirement 1', ['R1.2 one b', 'R1.10 one c', 'R1.1 one a'], 2, 3],
    [2, 'Requirement 2', ['R2.1 two'], 0, 1],
    [10, 'Requirement 10', ['R10.1 ten'], 1, 1],
    [null, 'Other', ['plain name', 'handles R1.2 in the middle'], 2, 2],
  ]);

  // Groups are ordered by requirement number, not as text, and "Other" appears only when it is needed.
  const noOther = groupContracts([c('R2.1 b'), c('R1.1 a')]);
  assert.deepEqual(noOther.map((g) => g.requirement), [1, 2]);

  // When no name carries a requirement number, there is one flat group and no lone "Other".
  const flat = groupContracts([c('alpha'), c('beta', 'fail')]);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].title, 'Contracts');
  assert.deepEqual(flat[0].contracts.map((x) => x.name), ['alpha', 'beta']);
  assert.equal(flat[0].passed, 1);
  assert.equal(flat[0].total, 2);
});
