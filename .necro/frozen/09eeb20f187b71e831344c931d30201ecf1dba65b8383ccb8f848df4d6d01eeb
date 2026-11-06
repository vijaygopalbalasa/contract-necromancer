// Contracts for site/lib/canon.js: R3.1 and R3.2 of the receipt-viewer spec.
//
// The module under test is loaded with a dynamic import inside each test, so this file always loads and every
// contract name is registered even while the viewer does not exist yet. A missing module fails the test, not the file.
//
// Dynamic imports are not followed by necro's import tracing, so the module is also named below the way a static
// import would name it. Keep these lines: the receipt pins the files it finds this way.
//   import {} from '../../site/lib/canon.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson as cliCanonicalJson, sha256 as cliSha256 } from '../../src/canon.js';
import { buildReceipt, computeReceiptHash as cliReceiptHash } from '../../src/receipts.js';

const CANON_URL = new URL('../../site/lib/canon.js', import.meta.url);
const HEX64 = /^[0-9a-f]{64}$/;

function nodeSha256(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

test('R3.1 the receipt hash is recomputed with Web Crypto from canonical JSON', async () => {
  const { canonicalJson, sha256Hex, computeReceiptHash } = await import(CANON_URL.href);

  // SHA-256 known vector, for text and for bytes, lowercase hex.
  const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(await sha256Hex('abc'), abc);
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), abc);

  // Canonical JSON: keys sorted recursively, arrays keep their order, no whitespace.
  assert.equal(canonicalJson({ b: [{ z: 1, a: 2 }, 3], a: { y: null, x: true } }), '{"a":{"x":true,"y":null},"b":[{"a":2,"z":1},3]}');

  // The receipt hash is the SHA-256 of the canonical JSON of the receipt without top-level receiptHash and createdAt.
  const receipt = {
    spec: 'demo',
    receiptHash: '0'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z',
    requirements: { sha256: 'b'.repeat(64), path: '.kiro/specs/demo/requirements.md' },
    contracts: [{ result: 'pass', name: 'R1.1 a', path: 'contracts/demo/a.contract.test.js', sha256: 'c'.repeat(64) }],
  };
  const expectedCanonical =
    '{"contracts":[{"name":"R1.1 a","path":"contracts/demo/a.contract.test.js","result":"pass","sha256":"' +
    'c'.repeat(64) +
    '"}],"requirements":{"path":".kiro/specs/demo/requirements.md","sha256":"' +
    'b'.repeat(64) +
    '"},"spec":"demo"}';
  const hash = await computeReceiptHash(receipt);
  assert.match(hash, HEX64);
  assert.equal(hash, nodeSha256(expectedCanonical));

  // Changing any other field changes the hash, including a nested one. Top-level createdAt and receiptHash do not.
  const flipped = structuredClone(receipt);
  flipped.contracts[0].result = 'fail';
  assert.notEqual(await computeReceiptHash(flipped), hash);
  const renamed = structuredClone(receipt);
  renamed.spec = 'other';
  assert.notEqual(await computeReceiptHash(renamed), hash);
  assert.equal(await computeReceiptHash({ ...receipt, createdAt: 'later', receiptHash: 'f'.repeat(64) }), hash);
  const nestedCreatedAt = structuredClone(receipt);
  nestedCreatedAt.contracts[0].createdAt = 'x';
  assert.notEqual(await computeReceiptHash(nestedCreatedAt), hash);

  // The hash goes through Web Crypto (crypto.subtle.digest with SHA-256), not through a node: module.
  const subtle = globalThis.crypto.subtle;
  const algorithms = [];
  const original = subtle.digest;
  subtle.digest = function (algorithm, ...rest) {
    algorithms.push(typeof algorithm === 'string' ? algorithm : algorithm && algorithm.name);
    return original.call(this, algorithm, ...rest);
  };
  try {
    await computeReceiptHash(receipt);
  } finally {
    delete subtle.digest;
  }
  assert.ok(algorithms.length > 0, 'computeReceiptHash must call crypto.subtle.digest');
  assert.ok(algorithms.every((a) => /^sha-?256$/i.test(a)), `expected SHA-256, got ${algorithms.join(', ')}`);

  // A browser has to be able to load the file, so it imports no node: module.
  const source = fs.readFileSync(CANON_URL, 'utf8');
  assert.doesNotMatch(source, /node:/);
});

test('R3.2 the page and necro compute the same receipt hash', async () => {
  const { canonicalJson, sha256Hex, computeReceiptHash } = await import(CANON_URL.href);

  // Same canonical JSON and same SHA-256 as src/canon.js on a corpus that stresses key order and escaping.
  const corpus = [
    {},
    [],
    { b: 1, a: 2 },
    { B: 1, a: 2, A: 3, b: 4 },
    { 10: 'x', 9: 'y', a: 'z', '': 'empty' },
    { nested: { z: [{ d: 1, c: 2 }, [], {}], a: { y: { x: null } } } },
    { unicode: 'héllo wörld', 'ключ': 'значение', '日本語': ['テスト'] },
    { astral: '😀 𝒳', '😀': 1, '\u{10000}': 2, '\uffff': 3 },
    { escapes: 'quote " backslash \\ newline \n tab \t nul \u0000 bell \u0007 del \u007f line sep \u2028' },
    { lone: '\ud800', mixed: ['\udc00', 'ok'] },
    { numbers: [0, -0, -1, 1.5, -2.25, 1e21, 1e-7, 123456789012, 0.1 + 0.2], big: Number.MAX_SAFE_INTEGER },
    { bools: [true, false], nothing: null, list: [null, [null], { a: null }] },
    [{ b: 1, a: 1 }, { a: 1, b: 1 }],
    'plain string',
    42,
    null,
  ];
  for (const value of corpus) {
    const site = canonicalJson(value);
    assert.equal(site, cliCanonicalJson(value), `canonicalJson differs for ${JSON.stringify(value)}`);
    assert.equal(await sha256Hex(site), cliSha256(site), `sha256 differs for ${site}`);
  }

  // Bytes hash the same as in the CLI, including bytes that are not valid UTF-8.
  const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x0d, 0x0a, 0x80]);
  assert.equal(await sha256Hex(bytes), cliSha256(Buffer.from(bytes)));

  // A receipt written by the real buildReceipt: the page recomputes the hash necro stored in it.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-viewer-canon-'));
  try {
    const write = (rel, content) => {
      fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
      fs.writeFileSync(path.join(cwd, rel), content);
    };
    const reqRel = '.kiro/specs/demo/requirements.md';
    const contractRel = 'contracts/demo/util.contract.test.js';
    const reqText = '# Demo requirements\n';
    const contractText = "import { test } from 'node:test';\nimport { f } from '../../src/util.js';\ntest('R1.1 util', () => f());\n";
    write(reqRel, reqText);
    write(contractRel, contractText);
    write('src/util.js', 'export function f() {}\n');
    const reqSha = cliSha256(reqText);
    const contractSha = cliSha256(contractText);
    const lock = {
      specs: {
        demo: {
          requirements: { path: reqRel, sha256: reqSha },
          contracts: [{ name: 'util', path: contractRel, sha256: contractSha, names: ['R1.1 util'] }],
        },
      },
    };
    const results = [{ name: 'R1.1 util', path: contractRel, sha256: contractSha, result: 'pass' }];
    const built = buildReceipt(cwd, 'demo', lock, results, {
      task: { id: '1', line: '1. Do it (Req 1.1)' },
      required: ['R1.1 util'],
    });
    assert.match(built.receiptHash, HEX64);
    assert.equal(await computeReceiptHash(built), built.receiptHash);
    assert.equal(await computeReceiptHash(built), cliReceiptHash(built));

    // Same result for a receipt with a commit, uncommitted files and unicode in a name, as necro would write it.
    const rich = {
      ...built,
      gitCommit: '0123456789abcdef0123456789abcdef01234567',
      uncommitted: ['src/util.js'],
      contracts: [{ ...built.contracts[0], name: 'R1.1 überprüfung 😀' }],
      required: ['R1.1 überprüfung 😀'],
    };
    rich.receiptHash = cliReceiptHash(rich);
    assert.equal(await computeReceiptHash(rich), rich.receiptHash);

    // Page and CLI hash the parsed object, so a pretty-printed copy and a minified copy agree.
    const pretty = JSON.parse(JSON.stringify(rich, null, 2));
    const minified = JSON.parse(JSON.stringify(rich));
    assert.equal(await computeReceiptHash(pretty), rich.receiptHash);
    assert.equal(await computeReceiptHash(minified), rich.receiptHash);

    // An edited receipt gives a different hash in both.
    const edited = structuredClone(rich);
    edited.contracts[0].result = 'fail';
    assert.notEqual(await computeReceiptHash(edited), rich.receiptHash);
    assert.equal(await computeReceiptHash(edited), cliReceiptHash(edited));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
