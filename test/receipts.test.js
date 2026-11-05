import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256, canonicalJson, hashFile } from '../src/canon.js';
import { runContracts } from '../src/contracts.js';
import { traceImports, buildReceipt, computeReceiptHash, writeReceipt } from '../src/receipts.js';

// Fixture source files live under src/ in the temp project; the contract
// imports them so import tracing has something to follow.
const REQ = '# Demo requirements\n';

const CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doubleThenTriple } from '../../src/util.js';

test('R5.1 util contract', () => {
  assert.equal(doubleThenTriple(2), 12);
});
`;

const UTIL = `import { triple } from './more.js';

export function doubleThenTriple(x) {
  return triple(x * 2);
}
`;

const MORE = `export function triple(x) {
  return x * 3;
}
`;

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'necro-receipts-'));
}

function write(cwd, rel, content) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function setupSpec(cwd) {
  write(cwd, '.kiro/specs/demo/requirements.md', REQ);
  write(cwd, 'contracts/demo/util.contract.test.js', CONTRACT);
  write(cwd, 'src/util.js', UTIL);
  write(cwd, 'src/more.js', MORE);
}

function buildLock(cwd) {
  return {
    specs: {
      demo: {
        frozenAt: '2026-11-06T00:00:00.000Z',
        requirements: {
          path: '.kiro/specs/demo/requirements.md',
          sha256: hashFile(path.join(cwd, '.kiro/specs/demo/requirements.md')),
        },
        contracts: [
          {
            name: 'util',
            path: 'contracts/demo/util.contract.test.js',
            sha256: hashFile(path.join(cwd, 'contracts/demo/util.contract.test.js')),
          },
        ],
      },
    },
  };
}

test('traceImports returns transitively imported source files, excluding the start file and node builtins', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    const sources = traceImports(cwd, 'contracts/demo/util.contract.test.js');
    assert.deepEqual(sources, ['src/more.js', 'src/util.js']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('traceImports resolves a specifier without an extension by appending .js', () => {
  const cwd = tmpCwd();
  try {
    // No need to be runnable ESM; traceImports only reads and parses source.
    write(cwd, 'main.js', `import { a } from './sub';\nrequire('./cjsmod');\n`);
    write(cwd, 'sub.js', `export const a = 1;\n`);
    write(cwd, 'cjsmod.js', `module.exports = {};\n`);
    const sources = traceImports(cwd, 'main.js');
    assert.deepEqual(sources.sort(), ['cjsmod.js', 'sub.js']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('traceImports ignores node builtins and bare specifiers', () => {
  const cwd = tmpCwd();
  try {
    write(cwd, 'bare.js', `import { x } from 'node:fs';\nimport lodash from 'lodash';\nimport { local } from './local.js';\n`);
    write(cwd, 'local.js', `export const local = 1;\n`);
    const sources = traceImports(cwd, 'bare.js');
    assert.deepEqual(sources, ['local.js']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R5.1 buildReceipt includes spec, gitCommit, requirements, contracts, imported sources, and results by name', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    const lock = buildLock(cwd);
    const results = runContracts(cwd, 'demo', lock);
    const receipt = buildReceipt(cwd, 'demo', lock, results);

    assert.equal(receipt.spec, 'demo');
    // tmp dir is not a git repo, so the commit is null
    assert.equal(receipt.gitCommit, null);

    assert.equal(receipt.requirements.path, '.kiro/specs/demo/requirements.md');
    assert.equal(receipt.requirements.sha256, sha256(REQ));

    // contracts: one entry per named test, with name/path/sha256/result
    assert.ok(Array.isArray(receipt.contracts));
    assert.equal(results.length, 1);
    assert.equal(receipt.contracts.length, results.length);
    const c = receipt.contracts[0];
    assert.equal(c.name, 'R5.1 util contract');
    assert.equal(c.path, 'contracts/demo/util.contract.test.js');
    assert.equal(c.sha256, hashFile(path.join(cwd, 'contracts/demo/util.contract.test.js')));
    assert.equal(c.result, 'pass');

    // sources: imported source files with their hashes, excluding the contract
    // file itself and node: builtins
    const srcMap = Object.fromEntries(receipt.sources.map((s) => [s.path, s.sha256]));
    assert.equal(srcMap['src/util.js'], hashFile(path.join(cwd, 'src/util.js')));
    assert.equal(srcMap['src/more.js'], hashFile(path.join(cwd, 'src/more.js')));
    assert.ok(!('contracts/demo/util.contract.test.js' in srcMap), 'contract file excluded from sources');
    assert.ok(!('node:test' in srcMap) && !('node:assert/strict' in srcMap), 'node builtins excluded');
    // sources are sorted by path
    const paths = receipt.sources.map((s) => s.path);
    assert.deepEqual(paths, [...paths].sort());
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R5.2 receiptHash equals sha256(canonicalJson(receipt without receiptHash and createdAt))', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    const lock = buildLock(cwd);
    const results = runContracts(cwd, 'demo', lock);
    const receipt = buildReceipt(cwd, 'demo', lock, results);

    const { receiptHash: _rh, createdAt: _ca, ...base } = receipt;
    assert.equal(receipt.receiptHash, sha256(canonicalJson(base)));
    assert.equal(computeReceiptHash(receipt), receipt.receiptHash);
    assert.equal(typeof receipt.createdAt, 'string');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R5.3 two receipts from identical inputs produce the same receiptHash', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    const lock = buildLock(cwd);
    const results = runContracts(cwd, 'demo', lock);
    const r1 = buildReceipt(cwd, 'demo', lock, results);
    const r2 = buildReceipt(cwd, 'demo', lock, results);
    assert.equal(r1.receiptHash, r2.receiptHash);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeReceipt writes .necro/receipts/<spec>/<receiptHash>.json and reads back equal', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    const lock = buildLock(cwd);
    const results = runContracts(cwd, 'demo', lock);
    const receipt = buildReceipt(cwd, 'demo', lock, results);
    const rel = writeReceipt(cwd, 'demo', receipt);

    assert.equal(rel, `.necro/receipts/demo/${receipt.receiptHash}.json`);
    const written = JSON.parse(fs.readFileSync(path.join(cwd, rel), 'utf8'));
    assert.equal(written.spec, 'demo');
    assert.equal(written.receiptHash, receipt.receiptHash);
    assert.deepEqual(written.contracts, receipt.contracts);
    assert.deepEqual(written.sources, receipt.sources);
    assert.deepEqual(written.requirements, receipt.requirements);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
