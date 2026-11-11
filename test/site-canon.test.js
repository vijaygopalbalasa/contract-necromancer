import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex, computeReceiptHash } from '../site/lib/canon.js';
import { canonicalJson as cliCanonicalJson, sha256 as cliSha256 } from '../src/canon.js';
import { buildReceipt, writeReceipt, computeReceiptHash as cliReceiptHash } from '../src/receipts.js';
import { runContracts } from '../src/contracts.js';
import { verify } from '../src/verify.js';

const HEX64 = /^[0-9a-f]{64}$/;
const SITE = new URL('../site/', import.meta.url);

function baseReceipt() {
  return {
    spec: 'demo',
    gitCommit: null,
    receiptHash: '0'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z',
    requirements: { path: '.kiro/specs/demo/requirements.md', sha256: 'b'.repeat(64) },
    contracts: [{ name: 'R1.1 a', path: 'contracts/demo/a.contract.test.js', sha256: 'c'.repeat(64), result: 'pass' }],
  };
}

test('canonicalJson sorts keys recursively and emits no whitespace', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1},"b":1}');
});

test('canonicalJson keeps array order and sorts objects inside arrays', () => {
  assert.equal(canonicalJson([3, 1, { z: 1, a: 2 }]), '[3,1,{"a":2,"z":1}]');
});

test('canonicalJson handles unicode and escapes like JSON.stringify', () => {
  assert.equal(canonicalJson({ 'é': 'ü😀', q: 'a"b\\c\n' }), '{"q":"a\\"b\\\\c\\n","é":"ü😀"}');
});

test('sha256Hex returns 64 lowercase hex characters and matches the known vector', async () => {
  const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(await sha256Hex('abc'), abc);
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), abc);
  assert.match(await sha256Hex(''), HEX64);
});

test('computeReceiptHash ignores top-level receiptHash and createdAt', async () => {
  const r = baseReceipt();
  const h = await computeReceiptHash(r);
  assert.match(h, HEX64);
  assert.equal(await computeReceiptHash({ ...r, receiptHash: 'f'.repeat(64), createdAt: 'later' }), h);
  const without = { ...r };
  delete without.receiptHash;
  delete without.createdAt;
  assert.equal(await computeReceiptHash(without), h);
});

test('computeReceiptHash changes when any other field changes, nested ones included', async () => {
  const r = baseReceipt();
  const h = await computeReceiptHash(r);
  const a = structuredClone(r);
  a.spec = 'other';
  assert.notEqual(await computeReceiptHash(a), h);
  const b = structuredClone(r);
  b.contracts[0].result = 'fail';
  assert.notEqual(await computeReceiptHash(b), h);
  const c = structuredClone(r);
  c.contracts[0].createdAt = 'x';
  assert.notEqual(await computeReceiptHash(c), h);
});

test('no file under site/ imports a node: module or a bare specifier', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      // site/play/ holds byte copies of the ledger example, which is Node code (node:fs and the like). The page never
      // imports them: the worker reads them as text, checks their hashes and rewrites their imports (design.md, Play).
      if (e.isDirectory()) {
        if (!(e.name === 'play' && path.resolve(dir) === path.resolve(fileURLToPath(SITE)))) walk(p);
      } else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(fileURLToPath(SITE));
  assert.ok(files.length > 0);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /node:/, `${f} mentions node:`);
    const specs = [
      ...[...src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ...[...src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ...[...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ];
    for (const s of specs) assert.match(s, /^\.{1,2}\//, `${f} imports bare specifier ${s}`);
  }
});

// ---- Task 2: hash parity with the CLI ----

const CORPUS = [
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
  { numbers: [0, -0, -1, 1.5, -2.25, 1e21, 1e-7, 123456789012, 0.1 + 0.2] },
  { bools: [true, false], nothing: null, list: [null, [null], { a: null }] },
  [{ b: 1, a: 1 }, { a: 1, b: 1 }],
  'plain string',
  42,
  null,
];

test('canonicalJson and sha256Hex equal the CLI on a corpus', async () => {
  for (const v of CORPUS) {
    const site = canonicalJson(v);
    assert.equal(site, cliCanonicalJson(v), JSON.stringify(v));
    assert.equal(await sha256Hex(site), cliSha256(site));
  }
  const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x0d, 0x0a, 0x80]);
  assert.equal(await sha256Hex(bytes), cliSha256(Buffer.from(bytes)));
});

function write(cwd, rel, content) {
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, rel), content);
}

test('the page hash equals the CLI hash for a receipt built by buildReceipt, and verify confirms it', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-site-canon-'));
  try {
    const reqRel = '.kiro/specs/demo/requirements.md';
    const contractRel = 'contracts/demo/util.contract.test.js';
    const reqText = '# Demo requirements\n';
    const contractText = "import { test } from 'node:test';\nimport { f } from '../../src/util.js';\ntest('R1.1 util', () => f());\n";
    write(cwd, reqRel, reqText);
    write(cwd, contractRel, contractText);
    write(cwd, 'src/util.js', 'export function f() {}\n');
    const contractSha = cliSha256(contractText);
    const lock = {
      specs: {
        demo: {
          frozenAt: '2026-11-06T00:00:00.000Z',
          requirements: { path: reqRel, sha256: cliSha256(reqText) },
          contracts: [{ name: 'util', path: contractRel, sha256: contractSha, names: ['R1.1 util'] }],
        },
      },
    };
    const results = runContracts(cwd, 'demo', lock);
    assert.equal(results[0].result, 'pass');
    const built = buildReceipt(cwd, 'demo', lock, results, { task: { id: '1', line: '1. Do it (Req 1.1)' }, required: ['R1.1 util'] });

    assert.equal(await computeReceiptHash(built), built.receiptHash);
    assert.equal(await computeReceiptHash(built), cliReceiptHash(built));

    // pretty and minified copies of the same receipt agree
    assert.equal(await computeReceiptHash(JSON.parse(JSON.stringify(built, null, 2))), built.receiptHash);
    assert.equal(await computeReceiptHash(JSON.parse(JSON.stringify(built))), built.receiptHash);

    // an edited receipt differs, in both implementations
    const edited = structuredClone(built);
    edited.contracts[0].result = 'fail';
    assert.notEqual(await computeReceiptHash(edited), built.receiptHash);
    assert.equal(await computeReceiptHash(edited), cliReceiptHash(edited));

    // the real verify confirms the receipt on disk
    const rel = writeReceipt(cwd, 'demo', built);
    const original = process.stdout.write.bind(process.stdout);
    let out = '';
    process.stdout.write = (chunk) => {
      out += chunk;
      return true;
    };
    let code;
    try {
      code = verify(cwd, rel);
    } finally {
      process.stdout.write = original;
    }
    assert.equal(code, 0, out);
    assert.match(out, /CONFIRMED/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('the golden receipt fixture hashes to its stored value', async () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/receipt-valid.json', import.meta.url), 'utf8'));
  assert.equal(await computeReceiptHash(fixture), fixture.receiptHash);
  assert.equal(cliReceiptHash(fixture), fixture.receiptHash);
});
