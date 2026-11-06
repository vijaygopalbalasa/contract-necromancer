import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

// ---- Req 5.4: receipts list pinned files that differ from the recorded commit ----

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function initRepo(cwd) {
  git(cwd, 'init', '-q');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'initial');
}

function receiptFor(cwd) {
  const lock = buildLock(cwd);
  return buildReceipt(cwd, 'demo', lock, runContracts(cwd, 'demo', lock));
}

test('R5.4 a pinned source edited after the commit is listed in uncommitted', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    initRepo(cwd);
    write(cwd, 'src/more.js', MORE.replace('x * 3', 'x * 3 /* edited */'));
    const receipt = receiptFor(cwd);
    assert.match(receipt.gitCommit, /^[0-9a-f]{40}$/);
    assert.deepEqual(receipt.uncommitted, ['src/more.js']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R5.4 after committing, a new receipt has an empty uncommitted list', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    initRepo(cwd);
    write(cwd, 'src/more.js', MORE.replace('x * 3', 'x * 3 /* edited */'));
    assert.deepEqual(receiptFor(cwd).uncommitted, ['src/more.js']);
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'edit more');
    const after = receiptFor(cwd);
    assert.deepEqual(after.uncommitted, []);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R5.4 a pinned file the commit lacks is listed', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    // Commit everything except src/more.js, which stays untracked.
    git(cwd, 'init', '-q');
    git(cwd, 'add', '-A');
    git(cwd, 'rm', '-q', '--cached', 'src/more.js');
    git(cwd, 'commit', '-q', '-m', 'initial without more.js');
    const receipt = receiptFor(cwd);
    assert.deepEqual(receipt.uncommitted, ['src/more.js']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R5.4 uncommitted covers requirements, contracts and sources, sorted', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    initRepo(cwd);
    write(cwd, 'src/util.js', UTIL + '// edited\n');
    write(cwd, 'src/more.js', MORE + '// edited\n');
    write(cwd, '.kiro/specs/demo/requirements.md', REQ + 'edited\n');
    write(cwd, 'contracts/demo/util.contract.test.js', CONTRACT + '// edited\n');
    const lock = buildLock(cwd);
    const receipt = buildReceipt(cwd, 'demo', lock, runContracts(cwd, 'demo', lock));
    assert.deepEqual(receipt.uncommitted, [
      '.kiro/specs/demo/requirements.md',
      'contracts/demo/util.contract.test.js',
      'src/more.js',
      'src/util.js',
    ]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R5.4 works when the project root is a subdirectory of the repository', () => {
  const repo = tmpCwd();
  try {
    const cwd = path.join(repo, 'proj');
    fs.mkdirSync(cwd);
    setupSpec(cwd);
    initRepo(repo);
    assert.deepEqual(receiptFor(cwd).uncommitted, []);
    write(cwd, 'src/more.js', MORE + '// edited\n');
    assert.deepEqual(receiptFor(cwd).uncommitted, ['src/more.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('R5.4 uncommitted is part of the receiptHash and the hash stays deterministic', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    initRepo(cwd);
    const clean = receiptFor(cwd);
    assert.deepEqual(clean.uncommitted, []);
    const clean2 = receiptFor(cwd);
    assert.equal(clean.receiptHash, clean2.receiptHash);
    assert.equal(computeReceiptHash(clean), clean.receiptHash);

    const tampered = { ...clean, uncommitted: ['src/more.js'] };
    assert.notEqual(computeReceiptHash(tampered), clean.receiptHash);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R5.4 outside a git repository the receipt records no uncommitted list', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd);
    const receipt = receiptFor(cwd);
    assert.equal(receipt.gitCommit, null);
    assert.ok(!('uncommitted' in receipt));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
