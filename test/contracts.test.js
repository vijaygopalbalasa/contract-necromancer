import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashFile } from '../src/canon.js';
import { runContracts } from '../src/contracts.js';

// Contract contents are inlined (not stored as .js fixtures) so they are test
// data, not unit tests that the outer `node --test` runner would discover.
const PASSING = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R1.1 passing contract', () => {
  assert.ok(true);
});

test('R1.2 another passing contract', () => {
  assert.equal(2 + 2, 4);
});
`;

const FAILING = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R2.1 failing contract', () => {
  assert.equal(1, 2);
});
`;

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'necro-contracts-'));
}

function writeReq(cwd, spec, content) {
  const dir = path.join(cwd, '.kiro', 'specs', spec);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'requirements.md'), content);
}

function writeContract(cwd, spec, name, content) {
  const dir = path.join(cwd, 'contracts', spec);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

function setupSpec(cwd, spec) {
  writeReq(cwd, spec, '# Demo requirements\n');
  writeContract(cwd, spec, 'passing.contract.test.js', PASSING);
  writeContract(cwd, spec, 'failing.contract.test.js', FAILING);
}

function buildLock(cwd, spec, contracts) {
  return {
    specs: {
      [spec]: {
        frozenAt: '2026-11-06T00:00:00.000Z',
        requirements: {
          path: `.kiro/specs/${spec}/requirements.md`,
          sha256: hashFile(path.join(cwd, '.kiro', 'specs', spec, 'requirements.md')),
        },
        contracts,
      },
    },
  };
}

function contractEntry(cwd, relPath) {
  return {
    name: path.basename(relPath).replace(/\.contract\.test\.js$/, ''),
    path: relPath,
    sha256: hashFile(path.join(cwd, relPath)),
  };
}

test('R4.4 runContracts returns name, path, sha256, result for each contract', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd, 'demo');
    const lock = buildLock(cwd, 'demo', [
      contractEntry(cwd, 'contracts/demo/passing.contract.test.js'),
      contractEntry(cwd, 'contracts/demo/failing.contract.test.js'),
    ]);
    const results = runContracts(cwd, 'demo', lock);

    assert.ok(Array.isArray(results));
    // two tests in passing + one in failing
    assert.equal(results.length, 3);

    for (const r of results) {
      assert.ok(typeof r.name === 'string' && r.name.length > 0, 'has a name');
      assert.ok('path' in r, 'has path');
      assert.ok('sha256' in r, 'has sha256');
      assert.ok(r.result === 'pass' || r.result === 'fail', 'result is pass or fail');
    }

    const passingResults = results.filter((r) => r.path === 'contracts/demo/passing.contract.test.js');
    assert.equal(passingResults.length, 2);
    assert.ok(passingResults.every((r) => r.result === 'pass'), 'both passing tests pass');
    assert.equal(
      passingResults[0].sha256,
      hashFile(path.join(cwd, 'contracts/demo/passing.contract.test.js')),
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.5 a failing contract name appears in the results', () => {
  const cwd = tmpCwd();
  try {
    setupSpec(cwd, 'demo');
    const lock = buildLock(cwd, 'demo', [
      contractEntry(cwd, 'contracts/demo/passing.contract.test.js'),
      contractEntry(cwd, 'contracts/demo/failing.contract.test.js'),
    ]);
    const results = runContracts(cwd, 'demo', lock);
    const names = results.map((r) => r.name);

    assert.ok(names.includes('R2.1 failing contract'), `failing name in: ${names.join(', ')}`);
    const failing = results.find((r) => r.name === 'R2.1 failing contract');
    assert.equal(failing.result, 'fail');
    assert.equal(failing.path, 'contracts/demo/failing.contract.test.js');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('a contract file that fails to load is one failing contract named after the file', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    writeContract(cwd, 'demo', 'broken.contract.test.js', 'this is not valid javascript;\n');
    const lock = buildLock(cwd, 'demo', [
      contractEntry(cwd, 'contracts/demo/broken.contract.test.js'),
    ]);
    const results = runContracts(cwd, 'demo', lock);

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'broken');
    assert.equal(results[0].result, 'fail');
    assert.equal(results[0].path, 'contracts/demo/broken.contract.test.js');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('runContracts skips describe suites and reports only named tests', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    const nested = `import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
describe('suite A', () => {
  test('R9.1 nested pass', () => { assert.ok(true); });
});
test('R9.2 top level', () => { assert.ok(true); });
`;
    writeContract(cwd, 'demo', 'nested.contract.test.js', nested);
    const lock = buildLock(cwd, 'demo', [
      contractEntry(cwd, 'contracts/demo/nested.contract.test.js'),
    ]);
    const results = runContracts(cwd, 'demo', lock);
    const names = results.map((r) => r.name);
    assert.deepEqual(names.sort(), ['R9.1 nested pass', 'R9.2 top level']);
    assert.ok(results.every((r) => r.result === 'pass'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('runContracts returns [] for a spec not in the lock', () => {
  const cwd = tmpCwd();
  try {
    assert.deepEqual(runContracts(cwd, 'missing', { specs: {} }), []);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
