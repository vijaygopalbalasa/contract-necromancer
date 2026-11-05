import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashFile } from '../src/canon.js';
import { runContracts } from '../src/contracts.js';
import { buildReceipt, writeReceipt } from '../src/receipts.js';
import { verify } from '../src/verify.js';

const REQ = '# Demo requirements\n';

// Contract that imports project source files (pinned via the receipt's sources).
const CANON_CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doubleThenTriple } from '../../src/util.js';

test('R6.1 canon contract', () => {
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

// Contract that depends on an UNPINNED data file (read at runtime, not imported),
// so its result can change without any pinned file changing.
const DATA_CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('R6.1 data contract', () => {
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data.json'), 'utf8'));
  assert.equal(data.value, 42);
});
`;

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'necro-verify-'));
}

function write(cwd, rel, content) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function setupWithSources(cwd) {
  write(cwd, '.kiro/specs/demo/requirements.md', REQ);
  write(cwd, 'contracts/demo/canon.contract.test.js', CANON_CONTRACT);
  write(cwd, 'src/util.js', UTIL);
  write(cwd, 'src/more.js', MORE);
}

function setupWithData(cwd) {
  write(cwd, '.kiro/specs/demo/requirements.md', REQ);
  write(cwd, 'contracts/demo/data.contract.test.js', DATA_CONTRACT);
  write(cwd, 'data.json', '{"value": 42}\n');
}

function buildLock(cwd, spec, contractRelPath) {
  return {
    specs: {
      [spec]: {
        frozenAt: '2026-11-06T00:00:00.000Z',
        requirements: {
          path: `.kiro/specs/${spec}/requirements.md`,
          sha256: hashFile(path.join(cwd, '.kiro/specs', spec, 'requirements.md')),
        },
        contracts: [
          {
            name: path.basename(contractRelPath).replace(/\.contract\.test\.js$/, ''),
            path: contractRelPath,
            sha256: hashFile(path.join(cwd, contractRelPath)),
          },
        ],
      },
    },
  };
}

function makeReceipt(cwd, spec, lock) {
  const results = runContracts(cwd, spec, lock);
  const receipt = buildReceipt(cwd, spec, lock, results);
  const file = writeReceipt(cwd, spec, receipt);
  return { receipt, file };
}

// Run fn while capturing process.stdout, return { code, out }.
function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    const code = fn();
    return { code, out: captured };
  } finally {
    process.stdout.write = original;
  }
}

test('R6.1 verify prints CONFIRMED and the receipt hash and exits 0 when all files match and contracts pass', () => {
  const cwd = tmpCwd();
  try {
    setupWithSources(cwd);
    const lock = buildLock(cwd, 'demo', 'contracts/demo/canon.contract.test.js');
    const { receipt, file } = makeReceipt(cwd, 'demo', lock);

    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 0);
    assert.match(out, /CONFIRMED/);
    assert.ok(out.includes(receipt.receiptHash), 'output includes the receipt hash');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.2 verify prints MISMATCH with the differing file path and exits 1 when a hashed file differs', () => {
  const cwd = tmpCwd();
  try {
    setupWithSources(cwd);
    const lock = buildLock(cwd, 'demo', 'contracts/demo/canon.contract.test.js');
    const { file } = makeReceipt(cwd, 'demo', lock);

    // Change an imported source file so its pinned hash no longer matches.
    fs.writeFileSync(path.join(cwd, 'src/util.js'), UTIL + '\n// changed\n');

    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1);
    assert.match(out, /MISMATCH/);
    assert.ok(out.includes('src/util.js'), 'output includes the changed file path');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.3 verify prints MISMATCH with the differing contract name and exits 1 when a contract result differs', () => {
  const cwd = tmpCwd();
  try {
    setupWithData(cwd);
    const lock = buildLock(cwd, 'demo', 'contracts/demo/data.contract.test.js');
    const { receipt, file } = makeReceipt(cwd, 'demo', lock);
    assert.equal(receipt.contracts[0].result, 'pass');

    // Change the unpinned data file so the contract now fails, without touching
    // any pinned file (requirements, contract file, imported sources).
    fs.writeFileSync(path.join(cwd, 'data.json'), '{"value": 99}\n');

    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1);
    assert.match(out, /MISMATCH/);
    assert.ok(out.includes('R6.1 data contract'), 'output includes the changed contract name');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
