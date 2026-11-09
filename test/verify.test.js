import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashFile } from '../src/canon.js';
import { runContracts } from '../src/contracts.js';
import { buildReceipt, writeReceipt, computeReceiptHash } from '../src/receipts.js';
import { verify } from '../src/verify.js';
import { readLock, freezeSpec } from '../src/lock.js';

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

test('R6.4 verify reports MISMATCH when receipt fields were edited so receiptHash no longer matches', () => {
  const cwd = tmpCwd();
  try {
    setupWithSources(cwd);
    const lock = buildLock(cwd, 'demo', 'contracts/demo/canon.contract.test.js');
    const { file } = makeReceipt(cwd, 'demo', lock);

    // Read, modify a field, and write the receipt back with a stale receiptHash.
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8'));
    const staleHash = receipt.receiptHash;
    // Tamper with a source file entry in the receipt.
    receipt.sources[0].sha256 = 'corrupted0000000000000000000000000000000000000000000000000000000';
    fs.writeFileSync(path.join(cwd, file), JSON.stringify(receipt, null, 2) + '\n');

    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1);
    assert.match(out, /MISMATCH/);
    assert.ok(out.includes('receipt'), 'message mentions the receipt was altered');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.5 verify rejects a receipt with no requirements', () => {
  const cwd = tmpCwd();
  try {
    setupWithSources(cwd);
    const lock = buildLock(cwd, 'demo', 'contracts/demo/canon.contract.test.js');
    const { file } = makeReceipt(cwd, 'demo', lock);

    // Remove the requirements field.
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8'));
    delete receipt.requirements;
    const { receiptHash } = receipt;
    receipt.receiptHash = receiptHash; // keep old hash to test the mismatch path
    fs.writeFileSync(path.join(cwd, file), JSON.stringify(receipt, null, 2) + '\n');

    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1);
    assert.match(out, /MISMATCH/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.5 verify rejects a receipt with no contracts', () => {
  const cwd = tmpCwd();
  try {
    setupWithSources(cwd);
    const lock = buildLock(cwd, 'demo', 'contracts/demo/canon.contract.test.js');
    const { file } = makeReceipt(cwd, 'demo', lock);

    // Remove the contracts array.
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8'));
    receipt.contracts = [];
    fs.writeFileSync(path.join(cwd, file), JSON.stringify(receipt, null, 2) + '\n');

    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1);
    assert.match(out, /MISMATCH/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.6 verify reports MISMATCH when requirements hash differs from the frozen lock', () => {
  const cwd = tmpCwd();
  try {
    setupWithSources(cwd);
    // Freeze the spec to write .necro/lock.json
    freezeSpec(cwd, 'demo');
    const lock = readLock(cwd);
    assert.ok(lock.specs.demo, 'spec is frozen');
    
    const { receipt, file } = makeReceipt(cwd, 'demo', lock);

    // Create a fresh cwd with the receipt but a frozen lock in which requirements
    // has a different hash. (In practice this would be git merging the lock.)
    const cwd2 = tmpCwd();
    try {
      write(cwd2, '.necro/lock.json', JSON.stringify({
        specs: {
          demo: {
            frozenAt: '2026-11-06T00:00:00.000Z',
            requirements: {
              path: '.kiro/specs/demo/requirements.md',
              sha256: 'deadbeef' + '0'.repeat(56),
            },
            contracts: lock.specs.demo.contracts,
          },
        },
      }, null, 2));
      write(cwd2, file, fs.readFileSync(path.join(cwd, file), 'utf8'));
      // Also need the actual files for hashing.
      write(cwd2, '.kiro/specs/demo/requirements.md', REQ);
      write(cwd2, 'contracts/demo/canon.contract.test.js', CANON_CONTRACT);
      write(cwd2, 'src/util.js', UTIL);
      write(cwd2, 'src/more.js', MORE);

      const { code, out } = captureStdout(() => verify(cwd2, file));
      assert.equal(code, 1);
      assert.match(out, /MISMATCH/);
      assert.ok(out.includes('.kiro/specs/demo/requirements.md'), 'output shows the mismatched file');
    } finally {
      fs.rmSync(cwd2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.6 verify reports MISMATCH when contract hash differs from the frozen lock', () => {
  const cwd = tmpCwd();
  try {
    setupWithSources(cwd);
    // Freeze the spec to write .necro/lock.json
    freezeSpec(cwd, 'demo');
    const lock = readLock(cwd);
    const { receipt, file } = makeReceipt(cwd, 'demo', lock);

    // Create a second cwd with a frozen lock in which the contract hash differs.
    const cwd2 = tmpCwd();
    try {
      write(cwd2, '.necro/lock.json', JSON.stringify({
        specs: {
          demo: {
            frozenAt: '2026-11-06T00:00:00.000Z',
            requirements: lock.specs.demo.requirements,
            contracts: [{
              name: 'canon',
              path: 'contracts/demo/canon.contract.test.js',
              sha256: 'deadbeef' + '0'.repeat(56),
            }],
          },
        },
      }, null, 2));
      write(cwd2, file, fs.readFileSync(path.join(cwd, file), 'utf8'));
      write(cwd2, '.kiro/specs/demo/requirements.md', REQ);
      write(cwd2, 'contracts/demo/canon.contract.test.js', CANON_CONTRACT);
      write(cwd2, 'src/util.js', UTIL);
      write(cwd2, 'src/more.js', MORE);

      const { code, out } = captureStdout(() => verify(cwd2, file));
      assert.equal(code, 1);
      assert.match(out, /MISMATCH/);
      assert.ok(out.includes('contracts/demo/canon.contract.test.js'), 'output shows the mismatched file');
    } finally {
      fs.rmSync(cwd2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 8d: strict verify against the lock (Req 6.7)
// ---------------------------------------------------------------------------

const TWO_TESTS = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R6.7 first contract', () => assert.ok(true));
test('R6.7 second contract', () => assert.ok(true));
`;

const OTHER_FILE = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R6.7 other file contract', () => assert.ok(true));
`;

// Contract that passes now and fails once data.json changes (data.json is not pinned).
const DATA_FILE = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('R6.7 data contract', () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data.json'), 'utf8')).value, 1);
});
`;

// A frozen spec with two contract files, and a genuine receipt for it.
function frozenWithReceipt(cwd, extra = {}) {
  write(cwd, '.kiro/specs/demo/requirements.md', REQ);
  write(cwd, 'contracts/demo/a.contract.test.js', TWO_TESTS);
  write(cwd, 'contracts/demo/b.contract.test.js', extra.dataFile ? DATA_FILE : OTHER_FILE);
  if (extra.dataFile) write(cwd, 'data.json', '{"value": 1}\n');
  freezeSpec(cwd, 'demo');
  const lock = readLock(cwd);
  const { receipt, file } = makeReceipt(cwd, 'demo', lock);
  return { lock, receipt, file };
}

// Rewrite a receipt with `edit` applied and a receiptHash that matches the new
// content, so only the lock comparison can catch the change.
function forge(cwd, file, edit) {
  const receipt = JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8'));
  edit(receipt);
  const { receiptHash, createdAt, ...rest } = receipt;
  receipt.receiptHash = computeReceiptHash(rest);
  const forged = path.join(cwd, 'forged.json');
  fs.writeFileSync(forged, JSON.stringify(receipt, null, 2) + '\n');
  return forged;
}

function verifyForged(cwd, file, edit) {
  return captureStdout(() => verify(cwd, forge(cwd, file, edit)));
}

test('R6.7 a genuine receipt for a frozen spec is CONFIRMED', () => {
  const cwd = tmpCwd();
  try {
    const { receipt, file } = frozenWithReceipt(cwd);
    assert.equal(receipt.contracts.length, 3);
    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 0, out);
    assert.match(out, /CONFIRMED/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.7 a receipt that leaves out one of the lock\'s contract files is a MISMATCH', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd);
    const { code, out } = verifyForged(cwd, file, (r) => {
      r.contracts = r.contracts.filter((c) => c.path !== 'contracts/demo/b.contract.test.js');
    });
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.ok(out.includes('contracts/demo/b.contract.test.js'), out);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.7 a receipt that leaves out one contract of a file is a MISMATCH naming it', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd);
    const { code, out } = verifyForged(cwd, file, (r) => {
      r.contracts = r.contracts.filter((c) => c.name !== 'R6.7 second contract');
    });
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.ok(out.includes('R6.7 second contract'), out);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.7 a receipt that adds a contract the lock lacks is a MISMATCH, even when it records a failure', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd);
    const { code, out } = verifyForged(cwd, file, (r) => {
      const first = r.contracts.find((c) => c.path === 'contracts/demo/a.contract.test.js');
      r.contracts.push({ ...first, name: 'R6.7 invented contract', result: 'fail' });
    });
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.ok(out.includes('R6.7 invented contract'), out);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.7 a receipt that adds a contract file the lock lacks is a MISMATCH', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd);
    write(cwd, 'contracts/demo/extra.contract.test.js', OTHER_FILE);
    const { code, out } = verifyForged(cwd, file, (r) => {
      r.contracts.push({
        name: 'R6.7 other file contract',
        path: 'contracts/demo/extra.contract.test.js',
        sha256: hashFile(path.join(cwd, 'contracts/demo/extra.contract.test.js')),
        result: 'pass',
      });
    });
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.ok(out.includes('contracts/demo/extra.contract.test.js'), out);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.7 a receipt that changes a recorded contract name is a MISMATCH', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd);
    const { code, out } = verifyForged(cwd, file, (r) => {
      r.contracts.find((c) => c.name === 'R6.7 first contract').name = 'R6.7 first contract (renamed)';
    });
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.ok(out.includes('R6.7 first contract'), out);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.7 a receipt for a spec that is not in the lock is a MISMATCH', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd);
    const { code, out } = verifyForged(cwd, file, (r) => {
      r.spec = 'other';
    });
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.ok(out.includes("'other'"), out);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.7 an empty lock still means the receipt\'s spec is missing from it', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd);
    fs.writeFileSync(path.join(cwd, '.necro/lock.json'), JSON.stringify({ specs: {} }));
    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.7 verify runs the lock\'s contracts, so a receipt that hides a now-failing file is a MISMATCH', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd, { dataFile: true });
    fs.writeFileSync(path.join(cwd, 'data.json'), '{"value": 2}\n');
    const { code, out } = verifyForged(cwd, file, (r) => {
      r.contracts = r.contracts.filter((c) => c.path !== 'contracts/demo/b.contract.test.js');
    });
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.ok(out.includes('contracts/demo/b.contract.test.js'), out);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.7 an honest receipt is a MISMATCH when a lock contract fails now', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd, { dataFile: true });
    fs.writeFileSync(path.join(cwd, 'data.json'), '{"value": 2}\n');
    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1, out);
    assert.ok(out.includes('R6.7 data contract'), out);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Req 6.8: a receipt of an earlier freeze is SUPERSEDED, not a MISMATCH
// ---------------------------------------------------------------------------

const REQ_PATH = '.kiro/specs/demo/requirements.md';
const A_PATH = 'contracts/demo/a.contract.test.js';
const B_PATH = 'contracts/demo/b.contract.test.js';

// A frozen spec with a genuine receipt, then the spec is edited and frozen again.
function refrozen(cwd, edit) {
  const { file, receipt } = frozenWithReceipt(cwd);
  edit(cwd);
  freezeSpec(cwd, 'demo');
  return { file, receipt };
}

test('R6.8 a receipt written before the spec was frozen again prints SUPERSEDED with the spec and the changed paths', () => {
  const cwd = tmpCwd();
  try {
    const { file } = refrozen(cwd, () => {
      fs.appendFileSync(path.join(cwd, REQ_PATH), 'A new line.\n');
      fs.appendFileSync(path.join(cwd, B_PATH), '// changed\n');
    });
    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1, out);
    assert.match(out, /SUPERSEDED/);
    assert.doesNotMatch(out, /MISMATCH|CONFIRMED/);
    assert.ok(out.includes('demo'), `names the spec: ${out}`);
    assert.ok(out.includes(REQ_PATH), `names the changed requirements: ${out}`);
    assert.ok(out.includes(B_PATH), `names the changed contract file: ${out}`);
    assert.ok(!out.includes(A_PATH), `does not name the unchanged contract file: ${out}`);
    assert.match(out, /earlier freeze/);
    assert.match(out, /not today's code/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.8 a change to the requirements alone, and to one contract file alone, is each SUPERSEDED', () => {
  for (const [label, edit, named, unnamed] of [
    ['requirements', (cwd) => fs.appendFileSync(path.join(cwd, REQ_PATH), 'More.\n'), REQ_PATH, B_PATH],
    ['contract', (cwd) => fs.appendFileSync(path.join(cwd, A_PATH), '// changed\n'), A_PATH, REQ_PATH],
  ]) {
    const cwd = tmpCwd();
    try {
      const { file } = refrozen(cwd, edit);
      const { code, out } = captureStdout(() => verify(cwd, file));
      assert.equal(code, 1, `${label}: ${out}`);
      assert.match(out, /SUPERSEDED/, label);
      assert.ok(out.includes(named), `${label}: ${out}`);
      assert.ok(!out.includes(unnamed), `${label}: ${out}`);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('R6.8 a receipt of the current freeze is still CONFIRMED after a second freeze of unchanged files', () => {
  const cwd = tmpCwd();
  try {
    const { file } = refrozen(cwd, () => {});
    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 0, out);
    assert.match(out, /CONFIRMED/);
    assert.doesNotMatch(out, /SUPERSEDED/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.8 a lock edited so the files on disk no longer match it is a MISMATCH, not SUPERSEDED', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd);
    const lockFile = path.join(cwd, '.necro', 'lock.json');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock.specs.demo.requirements.sha256 = 'd'.repeat(64);
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.doesNotMatch(out, /SUPERSEDED/);
    assert.ok(out.includes(REQ_PATH), out);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.8 one lock hash edited while the other files match the lock is still a MISMATCH', () => {
  const cwd = tmpCwd();
  try {
    const { file } = refrozen(cwd, (dir) => fs.appendFileSync(path.join(dir, A_PATH), '// changed\n'));
    // The lock now holds a hash for b that the file on disk does not have.
    const lockFile = path.join(cwd, '.necro', 'lock.json');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock.specs.demo.contracts.find((c) => c.path === B_PATH).sha256 = 'e'.repeat(64);
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));
    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.doesNotMatch(out, /SUPERSEDED/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.8 after the spec was frozen again, a file edited on disk since is a MISMATCH', () => {
  const cwd = tmpCwd();
  try {
    const { file } = refrozen(cwd, (dir) => fs.appendFileSync(path.join(dir, REQ_PATH), 'New.\n'));
    fs.appendFileSync(path.join(cwd, A_PATH), '// edited after the second freeze\n');
    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.doesNotMatch(out, /SUPERSEDED/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.8 a forged receipt that only drops a file stays a MISMATCH (R6.7), not SUPERSEDED', () => {
  const cwd = tmpCwd();
  try {
    const { file } = frozenWithReceipt(cwd);
    const { code, out } = verifyForged(cwd, file, (r) => {
      r.contracts = r.contracts.filter((c) => c.path !== B_PATH);
    });
    assert.equal(code, 1, out);
    assert.match(out, /MISMATCH/);
    assert.doesNotMatch(out, /SUPERSEDED/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R6.8 an altered receipt is still caught first, even for a re-frozen spec', () => {
  const cwd = tmpCwd();
  try {
    const { file } = refrozen(cwd, (dir) => fs.appendFileSync(path.join(dir, REQ_PATH), 'New.\n'));
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8'));
    receipt.spec = 'demo';
    receipt.contracts[0].result = receipt.contracts[0].result === 'pass' ? 'fail' : 'pass';
    const edited = path.join(cwd, 'edited.json');
    fs.writeFileSync(edited, JSON.stringify(receipt));
    const { code, out } = captureStdout(() => verify(cwd, edited));
    assert.equal(code, 1, out);
    assert.match(out, /altered/);
    assert.doesNotMatch(out, /SUPERSEDED/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Req 6.9: the project root is found from the receipt, so verify gives the same
// result from any working directory
// ---------------------------------------------------------------------------

// A repository root that has its own lock (spec 'outer'), with an example project
// under examples/demo that has a lock of its own (spec 'demo') and a genuine
// receipt, the layout of this repository and its examples. Returns the folders and
// the receipt's absolute path.
function repoWithExample() {
  const root = tmpCwd();
  write(root, '.kiro/specs/outer/requirements.md', '# Outer\n');
  write(root, 'contracts/outer/o.contract.test.js', OTHER_FILE);
  freezeSpec(root, 'outer');
  const example = path.join(root, 'examples', 'demo');
  const { file } = frozenWithReceipt(example);
  return { root, example, receipt: path.join(example, file) };
}

// Req 6.10 adds a leading "Project: <path>" line when the root is not the current
// folder. R6.9 compares the verdict, so that line is taken off before comparing.
function withoutProject(out) {
  return out.replace(/^Project: .*\n/, '');
}

// verify() from `cwd`, naming the receipt by a path relative to `cwd`.
function verifyFrom(cwd, receiptAbs) {
  return captureStdout(() => verify(cwd, path.relative(cwd, receiptAbs)));
}

test('R6.9 verifying an example\'s receipt from the repository root, the example folder and an unrelated folder gives the same output and exit code', () => {
  const { root, example, receipt } = repoWithExample();
  const elsewhere = tmpCwd();
  try {
    const here = verifyFrom(example, receipt);
    assert.equal(here.code, 0, here.out);
    assert.match(here.out, /CONFIRMED/);

    for (const [label, cwd] of [['repository root', root], ['unrelated folder', elsewhere]]) {
      const got = verifyFrom(cwd, receipt);
      assert.equal(got.code, here.code, `${label}: ${got.out}`);
      assert.equal(withoutProject(got.out), here.out, label);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('R6.9 a mismatch reads the same from every folder too', () => {
  const { root, example, receipt } = repoWithExample();
  const elsewhere = tmpCwd();
  try {
    fs.appendFileSync(path.join(example, 'contracts/demo/a.contract.test.js'), '// changed\n');
    const here = verifyFrom(example, receipt);
    assert.equal(here.code, 1, here.out);
    assert.match(here.out, /MISMATCH/);
    assert.ok(here.out.includes('contracts/demo/a.contract.test.js'), here.out);

    for (const [label, cwd] of [['repository root', root], ['unrelated folder', elsewhere]]) {
      const got = verifyFrom(cwd, receipt);
      assert.equal(got.code, here.code, `${label}: ${got.out}`);
      assert.equal(withoutProject(got.out), here.out, label);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('R6.9 the nearest folder above the receipt that holds .necro/lock.json is the project root', () => {
  const { root, example, receipt } = repoWithExample();
  try {
    // A receipt kept in a deeper folder of the example is still the example's.
    const deeper = path.join(example, 'saved', 'receipts', 'copy.json');
    write(example, 'saved/receipts/copy.json', fs.readFileSync(receipt, 'utf8'));
    const got = verifyFrom(root, deeper);
    assert.equal(got.code, 0, got.out);
    assert.match(got.out, /CONFIRMED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R6.9 a receipt outside any project with a lock is verified in the current folder, as before', () => {
  const { example, receipt } = repoWithExample();
  const orphans = tmpCwd();
  const bare = tmpCwd();
  try {
    const orphan = path.join(orphans, 'receipt.json');
    fs.copyFileSync(receipt, orphan);

    // Run in the project itself: its lock and files are used.
    const inProject = verifyFrom(example, orphan);
    assert.equal(inProject.code, 0, inProject.out);
    assert.match(inProject.out, /CONFIRMED/);

    // Run in a folder whose lock lacks the spec: the lock of that folder decides.
    write(bare, '.necro/lock.json', JSON.stringify({ specs: {} }));
    const noSpec = verifyFrom(bare, orphan);
    assert.equal(noSpec.code, 1, noSpec.out);
    assert.match(noSpec.out, /MISMATCH/);
    assert.ok(noSpec.out.includes("'demo'"), noSpec.out);
  } finally {
    fs.rmSync(example, { recursive: true, force: true });
    fs.rmSync(orphans, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('R6.9 the real pumpkin-ledger receipt is CONFIRMED from the repository root and from an unrelated folder', () => {
  const repo = path.resolve(import.meta.dirname, '..');
  const dir = path.join(repo, 'examples', 'pumpkin-ledger', '.necro', 'receipts', 'ledger');
  // The newest receipt, as CI picks it: older ones are SUPERSEDED once the example is frozen again.
  const newest = fs
    .readdirSync(dir)
    .map((f) => ({ f, createdAt: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).createdAt }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0].f;
  const receipt = path.join(dir, newest);
  const elsewhere = tmpCwd();
  try {
    const inExample = verifyFrom(path.join(repo, 'examples', 'pumpkin-ledger'), receipt);
    assert.equal(inExample.code, 0, inExample.out);
    for (const cwd of [repo, elsewhere]) {
      const got = verifyFrom(cwd, receipt);
      assert.equal(got.code, 0, `${cwd}: ${got.out}`);
      assert.equal(withoutProject(got.out), inExample.out, cwd);
    }
  } finally {
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Req 6.10: when verify uses a project root other than the current folder, it
// first says whose contracts run
// ---------------------------------------------------------------------------

test('R6.10 verifying from another folder prints Project: <absolute path> before the result', () => {
  const { root, example, receipt } = repoWithExample();
  const elsewhere = tmpCwd();
  try {
    for (const [label, cwd] of [['repository root', root], ['unrelated folder', elsewhere]]) {
      const got = verifyFrom(cwd, receipt);
      assert.equal(got.code, 0, `${label}: ${got.out}`);
      const lines = got.out.split('\n');
      assert.equal(lines[0], `Project: ${example}`, label);
      assert.match(lines[1], /^CONFIRMED [0-9a-f]{64}/, label);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('R6.10 the Project: line comes before a MISMATCH too', () => {
  const { root, example, receipt } = repoWithExample();
  try {
    fs.appendFileSync(path.join(example, 'contracts/demo/a.contract.test.js'), '// changed\n');
    const got = verifyFrom(root, receipt);
    assert.equal(got.code, 1, got.out);
    const lines = got.out.split('\n');
    assert.equal(lines[0], `Project: ${example}`);
    assert.match(lines[1], /^MISMATCH/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R6.10 verifying from the project root prints no Project: line', () => {
  const { root, example, receipt } = repoWithExample();
  try {
    const here = verifyFrom(example, receipt);
    assert.equal(here.code, 0, here.out);
    assert.doesNotMatch(here.out, /Project:/);
    assert.match(here.out, /^CONFIRMED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R6.10 a project root reached through a different spelling of the current folder prints no Project: line', () => {
  const { root, example, receipt } = repoWithExample();
  try {
    const link = path.join(os.tmpdir(), `necro-verify-link-${process.pid}-${Date.now()}`);
    fs.symlinkSync(fs.realpathSync(example), link);
    try {
      const got = captureStdout(() => verify(link, receipt));
      assert.equal(got.code, 0, got.out);
      assert.doesNotMatch(got.out, /Project:/);
    } finally {
      fs.rmSync(link, { force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('R6.10 a receipt outside any project is checked in the current folder and prints no Project: line', () => {
  const { example, receipt } = repoWithExample();
  const orphans = tmpCwd();
  try {
    const orphan = path.join(orphans, 'receipt.json');
    fs.copyFileSync(receipt, orphan);
    const got = verifyFrom(example, orphan);
    assert.equal(got.code, 0, got.out);
    assert.doesNotMatch(got.out, /Project:/);
  } finally {
    fs.rmSync(example, { recursive: true, force: true });
    fs.rmSync(orphans, { recursive: true, force: true });
  }
});
