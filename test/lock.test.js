import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../src/canon.js';
import {
  readLock, writeLock, freezeSpec, isSpecFrozen, isFrozenPath,
  frozenFiles, getExpectedHash,
} from '../src/lock.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const REQ = fs.readFileSync(path.join(FIXTURES, 'requirements.md'), 'utf8');
const CONTRACT = fs.readFileSync(path.join(FIXTURES, 'hello.contract.test.js'), 'utf8');

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'necro-lock-'));
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

test('R2.1 freezeSpec records sha256 of requirements and each contract in lock.json', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'hello.contract.test.js', CONTRACT);
    freezeSpec(cwd, 'demo');

    const lock = readLock(cwd);
    assert.ok(lock.specs.demo, 'spec entry present');
    assert.equal(lock.specs.demo.requirements.path, '.kiro/specs/demo/requirements.md');
    assert.equal(lock.specs.demo.requirements.sha256, sha256(REQ));

    const contractPath = 'contracts/demo/hello.contract.test.js';
    const c = lock.specs.demo.contracts.find((x) => x.path === contractPath);
    assert.ok(c, 'contract entry present');
    assert.equal(c.sha256, sha256(CONTRACT));
    assert.equal(c.name, 'hello');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.2 freezeSpec stores a copy of each frozen file at .necro/frozen/<sha256>', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'hello.contract.test.js', CONTRACT);
    freezeSpec(cwd, 'demo');

    const lock = readLock(cwd);
    const frozenDir = path.join(cwd, '.necro', 'frozen');

    assert.equal(
      fs.readFileSync(path.join(frozenDir, lock.specs.demo.requirements.sha256), 'utf8'),
      REQ,
    );
    for (const c of lock.specs.demo.contracts) {
      assert.equal(fs.readFileSync(path.join(frozenDir, c.sha256), 'utf8'), CONTRACT);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.3 freezeSpec refuses with a plain message when there are no contract files', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    // no contract files written
    assert.throws(
      () => freezeSpec(cwd, 'demo'),
      /No contracts found for spec 'demo'. Add at least one file in contracts\/demo\//,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R2.4 re-freezing replaces the spec entry and keeps other specs', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'alpha', '# Alpha v1\n');
    writeContract(cwd, 'alpha', 'a.contract.test.js', CONTRACT);
    writeReq(cwd, 'beta', '# Beta v1\n');
    writeContract(cwd, 'beta', 'b.contract.test.js', CONTRACT);

    freezeSpec(cwd, 'alpha');
    freezeSpec(cwd, 'beta');

    // re-freeze alpha after changing its requirements
    writeReq(cwd, 'alpha', '# Alpha v2\n');
    freezeSpec(cwd, 'alpha');

    const lock = readLock(cwd);
    assert.equal(lock.specs.alpha.requirements.sha256, sha256('# Alpha v2\n'));
    assert.equal(lock.specs.alpha.requirements.path, '.kiro/specs/alpha/requirements.md');
    // beta untouched
    assert.equal(lock.specs.beta.requirements.sha256, sha256('# Beta v1\n'));
    assert.equal(lock.specs.beta.contracts[0].path, 'contracts/beta/b.contract.test.js');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('query helpers: isSpecFrozen, isFrozenPath, frozenFiles, getExpectedHash', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'hello.contract.test.js', CONTRACT);

    assert.equal(isSpecFrozen(cwd, 'demo'), false);
    freezeSpec(cwd, 'demo');
    assert.equal(isSpecFrozen(cwd, 'demo'), true);
    assert.equal(isSpecFrozen(cwd, 'other'), false);

    assert.equal(isFrozenPath(cwd, '.kiro/specs/demo/requirements.md'), true);
    assert.equal(isFrozenPath(cwd, 'contracts/demo/hello.contract.test.js'), true);
    assert.equal(isFrozenPath(cwd, 'src/canon.js'), false);

    assert.equal(getExpectedHash(cwd, '.kiro/specs/demo/requirements.md'), sha256(REQ));
    assert.equal(getExpectedHash(cwd, 'contracts/demo/hello.contract.test.js'), sha256(CONTRACT));
    assert.equal(getExpectedHash(cwd, 'src/canon.js'), null);

    assert.deepEqual(
      frozenFiles(cwd, 'demo').map((f) => f.path).sort(),
      ['.kiro/specs/demo/requirements.md', 'contracts/demo/hello.contract.test.js'],
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeLock then readLock round-trips and sorts keys', () => {
  const cwd = tmpCwd();
  try {
    writeLock(cwd, { specs: { zeta: { frozenAt: 'x', requirements: { path: 'r', sha256: 'h' } } } });
    const lock = readLock(cwd);
    assert.equal(lock.specs.zeta.requirements.path, 'r');
    // raw file has 2-space indent (pretty printed)
    const raw = fs.readFileSync(path.join(cwd, '.necro', 'lock.json'), 'utf8');
    assert.ok(raw.includes('\n  "specs"'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
