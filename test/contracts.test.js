import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashFile } from '../src/canon.js';
import { runContracts } from '../src/contracts.js';
import { freezeSpec, readLock } from '../src/lock.js';

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

const DIRECTIVES = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R4.7 skipped contract', { skip: true }, () => {});
test('R4.7 todo contract', { todo: true }, () => {});
test('R4.7 passing contract', () => { assert.ok(true); });
`;

const ZERO = `import { test } from 'node:test';
// loads but defines no tests
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

test('R4.7 a test marked skip or todo is reported as fail', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    writeContract(cwd, 'demo', 'directives.contract.test.js', DIRECTIVES);
    const lock = buildLock(cwd, 'demo', [
      contractEntry(cwd, 'contracts/demo/directives.contract.test.js'),
    ]);
    const results = runContracts(cwd, 'demo', lock);
    const byName = Object.fromEntries(results.map((r) => [r.name, r.result]));

    assert.equal(byName['R4.7 skipped contract'], 'fail', 'skip reported as fail');
    assert.equal(byName['R4.7 todo contract'], 'fail', 'todo reported as fail');
    assert.equal(byName['R4.7 passing contract'], 'pass', 'passing stays pass');
    assert.equal(
      results.filter((r) => r.path === 'contracts/demo/directives.contract.test.js').length,
      3,
      'one result per test',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.8 a contract file that loads but defines zero tests is one failing contract named after the file', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    writeContract(cwd, 'demo', 'empty.contract.test.js', ZERO);
    const lock = buildLock(cwd, 'demo', [
      contractEntry(cwd, 'contracts/demo/empty.contract.test.js'),
    ]);
    const results = runContracts(cwd, 'demo', lock);

    assert.equal(results.length, 1, 'zero real tests -> exactly one contract');
    assert.equal(results[0].name, 'empty');
    assert.equal(results[0].result, 'fail');
    assert.equal(results[0].path, 'contracts/demo/empty.contract.test.js');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.9 a contract file changed after freeze makes every contract in it fail', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    writeContract(cwd, 'demo', 'passing.contract.test.js', PASSING);
    // Freeze records the contract names and file hashes (Req 2.5).
    freezeSpec(cwd, 'demo');
    const lock = readLock(cwd);

    // Tamper with the contract file so its hash no longer matches the lock.
    writeContract(cwd, 'demo', 'passing.contract.test.js', PASSING + '\n// changed\n');

    const results = runContracts(cwd, 'demo', lock);
    const fileResults = results.filter((r) => r.path === 'contracts/demo/passing.contract.test.js');
    assert.ok(fileResults.length > 0, 'results are emitted for the tampered file');
    assert.ok(
      fileResults.every((r) => r.result === 'fail'),
      'every contract in the tampered file fails',
    );
    // the failing names are the ones recorded in the lock, not the file stem
    const names = fileResults.map((r) => r.name).sort();
    assert.ok(names.includes('R1.1 passing contract'), `uses recorded names: ${names.join(', ')}`);
    assert.ok(names.includes('R1.2 another passing contract'), `uses recorded names: ${names.join(', ')}`);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.10 a contract name recorded in the lock but missing from a run is reported as failing', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    writeContract(cwd, 'demo', 'passing.contract.test.js', PASSING);
    const fileRel = 'contracts/demo/passing.contract.test.js';
    // Build a lock whose file hash matches (so 4.9 does not fire) but whose
    // recorded names include a contract the file does not actually define.
    const lock = buildLock(cwd, 'demo', [
      {
        name: 'passing',
        path: fileRel,
        sha256: hashFile(path.join(cwd, fileRel)),
        names: ['R1.1 passing contract', 'R9.9 ghost contract'],
      },
    ]);

    const results = runContracts(cwd, 'demo', lock);
    const byName = Object.fromEntries(results.map((r) => [r.name, r.result]));
    assert.equal(byName['R1.1 passing contract'], 'pass');
    assert.equal(byName['R9.9 ghost contract'], 'fail', 'missing contract name reported as failing');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.11 a contract name with special characters (slash, .js) is kept and reported', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    // A contract named with a slash and .js extension.
    const special = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('handles a/b.js paths', () => {
  assert.ok(true);
});
`;
    writeContract(cwd, 'demo', 'special.contract.test.js', special);
    const lock = buildLock(cwd, 'demo', [
      contractEntry(cwd, 'contracts/demo/special.contract.test.js'),
    ]);
    const results = runContracts(cwd, 'demo', lock);

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'handles a/b.js paths', 'name kept exactly as reported');
    assert.equal(results[0].result, 'pass');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 8c: results come from the node:test run() events (Req 4.12)
// ---------------------------------------------------------------------------

function runOne(fileName, source) {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    writeContract(cwd, 'demo', fileName, source);
    const lock = buildLock(cwd, 'demo', [contractEntry(cwd, `contracts/demo/${fileName}`)]);
    return runContracts(cwd, 'demo', lock);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('R4.12 a contract file that prints a fake "ok 1 - name" line and defines no tests cannot pass', () => {
  const results = runOne(
    'fake.contract.test.js',
    `console.log('ok 1 - R1.1 pretend contract');
console.log('TAP version 13\\nok 2 - R1.2 another pretend\\n1..2');
`,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'fake', 'one failing contract named after the file');
  assert.equal(results[0].result, 'fail');
});

test('R4.12 a fake "ok" line with the name of a failing contract does not turn it into a pass', () => {
  const results = runOne(
    'fake.contract.test.js',
    `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 real contract', () => {
  console.log('ok 1 - R1.1 real contract');
  console.log('    ok 1 - R1.1 real contract');
  assert.equal(1, 2);
});
`,
  );
  assert.deepEqual(
    results.map((r) => [r.name, r.result]),
    [['R1.1 real contract', 'fail']],
  );
});

test('R4.12 a fake "ok" line inside an error message cannot add a passing contract or satisfy a recorded name', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    writeContract(
      cwd,
      'demo',
      'msg.contract.test.js',
      `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 real contract', () => {
  assert.fail('x\\nok 2 - R1.2 ghost contract\\n');
});
`,
    );
    const e = contractEntry(cwd, 'contracts/demo/msg.contract.test.js');
    const lock = buildLock(cwd, 'demo', [{ ...e, names: ['R1.1 real contract', 'R1.2 ghost contract'] }]);
    const results = runContracts(cwd, 'demo', lock);
    assert.deepEqual(
      results.map((r) => [r.name, r.result]).sort(),
      [['R1.1 real contract', 'fail'], ['R1.2 ghost contract', 'fail']],
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.12 output printed by a passing contract never adds a contract', () => {
  const results = runOne(
    'noisy.contract.test.js',
    `import { test } from 'node:test';
test('R1.1 quiet', () => {
  console.log('ok 2 - R1.9 invented by the code under test');
  console.error('not ok 3 - R1.8 invented too');
});
`,
  );
  assert.deepEqual(
    results.map((r) => [r.name, r.result]),
    [['R1.1 quiet', 'pass']],
  );
});

test('R4.12 a contract file that exits non-zero after its tests passed counts as failing', () => {
  const results = runOne(
    'exit.contract.test.js',
    `import { test } from 'node:test';
test('R1.1 passes', () => {});
process.exitCode = 3;
`,
  );
  assert.ok(results.length >= 1);
  assert.ok(results.some((r) => r.result === 'fail'), 'the run is not a pass');
  assert.ok(results.every((r) => r.result === 'fail' || r.name === 'R1.1 passes'));
});

test('R4.12 a describe block that throws or is skipped is a failing contract', () => {
  const results = runOne(
    'suites.contract.test.js',
    `import { test, describe } from 'node:test';
describe('throwing suite', () => { throw new Error('boom'); });
describe('skipped suite', { skip: true }, () => { test('R1.1 hidden', () => {}); });
test('R1.2 fine', () => {});
`,
  );
  const byName = Object.fromEntries(results.map((r) => [r.name, r.result]));
  assert.equal(byName['throwing suite'], 'fail');
  assert.equal(byName['skipped suite'], 'fail');
  assert.equal(byName['R1.2 fine'], 'pass');
});

test('R4.12 a failing test inside a describe is reported once, by its own name', () => {
  const results = runOne(
    'nested.contract.test.js',
    `import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
describe('group', () => {
  test('R1.1 bad', () => { assert.fail('no'); });
  test('R1.2 good', () => {});
});
`,
  );
  assert.deepEqual(
    results.map((r) => [r.name, r.result]).sort(),
    [['R1.1 bad', 'fail'], ['R1.2 good', 'pass']],
  );
});

test('R4.11 a contract named after its own file stem is a normal contract, not a load failure', () => {
  const results = runOne(
    'hello.contract.test.js',
    `import { test } from 'node:test';
test('hello', () => {});
test('hello.contract.test.js', () => {});
`,
  );
  assert.deepEqual(
    results.map((r) => [r.name, r.result]).sort(),
    [['hello', 'pass'], ['hello.contract.test.js', 'pass']],
  );
});

test('R4.12 recorded names are matched per contract file, not across files', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    const mk = (title) => `import { test } from 'node:test';
test('${title}', () => {});
`;
    writeContract(cwd, 'demo', 'a.contract.test.js', mk('R1.1 in a'));
    writeContract(cwd, 'demo', 'b.contract.test.js', mk('R9.9 shared name'));
    const a = contractEntry(cwd, 'contracts/demo/a.contract.test.js');
    const b = contractEntry(cwd, 'contracts/demo/b.contract.test.js');
    // file a claims to define "R9.9 shared name" but only file b does
    const lock = buildLock(cwd, 'demo', [
      { ...a, names: ['R1.1 in a', 'R9.9 shared name'] },
      { ...b, names: ['R9.9 shared name'] },
    ]);
    const results = runContracts(cwd, 'demo', lock);
    const entry = (file, name) => results.find((r) => r.path === `contracts/demo/${file}` && r.name === name);
    assert.equal(entry('a.contract.test.js', 'R1.1 in a').result, 'pass');
    assert.equal(entry('a.contract.test.js', 'R9.9 shared name').result, 'fail', 'missing from a');
    assert.equal(entry('b.contract.test.js', 'R9.9 shared name').result, 'pass');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.12 a lock that lists the same file twice runs it once and reports each contract once', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    writeContract(cwd, 'demo', 'passing.contract.test.js', PASSING);
    const e = contractEntry(cwd, 'contracts/demo/passing.contract.test.js');
    const lock = buildLock(cwd, 'demo', [
      { ...e, names: ['R1.1 passing contract'] },
      { ...e, names: ['R1.2 another passing contract'] },
    ]);
    const results = runContracts(cwd, 'demo', lock);
    assert.deepEqual(results.map((r) => r.name).sort(), ['R1.1 passing contract', 'R1.2 another passing contract']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 29: a JavaScript contract file is cut off at the runner time limit (Req 13.7)
// ---------------------------------------------------------------------------

test('R13.7 a JavaScript contract file that runs past the time limit fails with a reason, and its process is killed', () => {
  const cwd = tmpCwd();
  const pidFile = path.join(cwd, 'contract.pid');
  try {
    writeReq(cwd, 'demo', '# Demo\n');
    const hang = `import { test } from 'node:test';
import fs from 'node:fs';

test('R1.1 hangs', async () => {
  fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
  await new Promise((resolve) => setTimeout(resolve, 8000));
});
`;
    writeContract(cwd, 'demo', 'hang.contract.test.js', hang);
    const lock = buildLock(cwd, 'demo', [{ ...contractEntry(cwd, 'contracts/demo/hang.contract.test.js'), names: ['R1.1 hangs'] }]);

    process.env.NECRO_RUNNER_TIMEOUT_MS = '2500';
    const started = Date.now();
    let results;
    try {
      results = runContracts(cwd, 'demo', lock);
    } finally {
      delete process.env.NECRO_RUNNER_TIMEOUT_MS;
    }
    assert.ok(Date.now() - started < 7000, 'cut off before the contract would have finished');
    assert.ok(results.length >= 1 && results.every((r) => r.result === 'fail'));
    const named = results.find((r) => r.name === 'hang');
    assert.ok(named, JSON.stringify(results));
    assert.match(named.reason, /hang\.contract\.test\.js/);
    assert.match(named.reason, /time limit/);

    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    const end = Date.now() + 3000;
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    while (alive() && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    assert.equal(alive(), false, 'the process of the contract file is gone');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 13.15 a contract file runs in a process started with --frozen-intrinsics
// ---------------------------------------------------------------------------

function runFrozen(cwd, spec, name, source, extra = {}) {
  writeReq(cwd, spec, '# Demo requirements\n');
  writeContract(cwd, spec, name, source);
  const lock = buildLock(cwd, spec, [contractEntry(cwd, `contracts/${spec}/${name}`)]);
  Object.assign(lock.specs[spec], extra);
  return runContracts(cwd, spec, lock);
}

test('R13.15 a contract file runs with the built-in prototypes frozen, so a patch of String.prototype.split throws', () => {
  const cwd = tmpCwd();
  try {
    const results = runFrozen(cwd, 'frozen', 'proto.contract.test.js', `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 prototypes are frozen', () => {
  assert.ok(Object.isFrozen(String.prototype));
  assert.ok(Object.isFrozen(Array.prototype));
  assert.throws(() => { String.prototype.split = () => []; }, TypeError);
});
`);
    assert.deepEqual(results.map((r) => [r.name, r.result]), [['R1.1 prototypes are frozen', 'pass']]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R13.15 a module under test that patches a built-in prototype when it loads makes the contract file fail, naming the error', () => {
  const cwd = tmpCwd();
  try {
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'cheat.js'), "const native = String.prototype.split;\nString.prototype.split = function split(...a) { return native.apply(this, a); };\nexport const x = 1;\n");
    const results = runFrozen(cwd, 'frozen', 'cheat.contract.test.js', `import { test } from 'node:test';
import { x } from '../../src/cheat.js';
test('R1.1 uses the cheat', () => { if (x !== 1) throw new Error('x'); });
`);
    assert.equal(results.length, 1);
    assert.equal(results[0].result, 'fail');
    assert.equal(results[0].fileFailure, true);
    assert.match(results[0].errorLines.join('\n'), /read only property 'split'/);
    assert.doesNotMatch(results[0].errorLines.join('\n'), /Frozen intri/, 'the warning that the flag is experimental is not an explanation');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R13.15 console.log can still be assigned in a contract, since several contracts capture the output of a command', () => {
  const cwd = tmpCwd();
  try {
    const results = runFrozen(cwd, 'frozen', 'console.contract.test.js', `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 console.log is assignable', () => {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  console.log('a', 'b');
  console.log = original;
  assert.deepEqual(lines, ['a b']);
});
`);
    assert.deepEqual(results.map((r) => r.result), ['pass']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
