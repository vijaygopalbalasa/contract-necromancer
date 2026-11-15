import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideTicks, failedMessage } from '../src/hooks.js';
import { checkSpec } from '../src/check.js';
import { auditSpec, problems } from '../src/audit.js';
import { freezeSpec, readLock } from '../src/lock.js';

// Req 6.16: outside `necro verify`, a contract that cannot run counts as failing and the message names what is missing.

const MISSING = 'the program pytest was not found';

test('R6.16 decideTicks returns the phrase of a failing contract that cannot run, and failedMessage appends the sentence', () => {
  const results = [
    { name: 'R1.1 ok', path: 'a', result: 'pass' },
    { name: 'R1.2 broken', path: 'a', result: 'fail' },
    { name: 'R1.3 needs pytest', path: 'b', result: 'fail', cannotRun: MISSING },
  ];
  const out = decideTicks({ specs: {} }, 'demo', results, { before: '', after: '' });
  assert.deepEqual(out.failing, ['R1.2 broken', 'R1.3 needs pytest']);
  const message = failedMessage(out.failing, out.reasons, out.missing);
  assert.match(message, /^Contracts failed: R1\.2 broken, R1\.3 needs pytest\./);
  assert.ok(message.includes(`The contracts cannot run here: ${MISSING}`), message);
});

test('R6.16 decideTicks counts a contract that cannot run as failing, and names nothing when none cannot run', () => {
  const only = decideTicks({ specs: {} }, 'demo', [{ name: 'R1.1 a', path: 'a', result: 'fail', cannotRun: MISSING }], { before: '', after: '' });
  assert.deepEqual(only.failing, ['R1.1 a']);
  const plain = decideTicks({ specs: {} }, 'demo', [{ name: 'R1.1 a', path: 'a', result: 'fail' }], { before: '', after: '' });
  assert.ok(!failedMessage(plain.failing, plain.reasons, plain.missing).includes('cannot run here'));
});

const REAL = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('R1.1 real failure', () => { assert.equal(1, 2); });\n`;
const NEEDS = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { v } from 'necro-no-such-package';\ntest('R1.2 needs a package', () => { assert.ok(v); });\n`;

function mixed(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-cannot-run-'));
  try {
    const put = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
      fs.writeFileSync(path.join(cwd, rel), text);
    };
    put('.kiro/specs/demo/requirements.md', '# Requirements\n');
    put('.kiro/specs/demo/tasks.md', '- [x] 1. **One** (Req 1.1, 1.2)\n- [ ] 2. **Two** (Req 1.2)\n');
    put('contracts/demo/a.contract.test.js', REAL);
    put('contracts/demo/b.contract.test.js', NEEDS);
    put('node_modules/necro-no-such-package/package.json', '{"name":"necro-no-such-package","type":"module","main":"index.js"}\n');
    put('node_modules/necro-no-such-package/index.js', 'export const v = 1;\n');
    freezeSpec(cwd, 'demo');
    fs.rmSync(path.join(cwd, 'node_modules'), { recursive: true, force: true });
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('R6.16 checkSpec with a real failure and a contract that cannot run exits 1 and names what is missing', () =>
  mixed((cwd) => {
    const res = checkSpec(cwd, 'demo');
    assert.equal(res.exitCode, 1);
    assert.match(res.stdout, /fail R1\.1 real failure/);
    assert.match(res.stdout, /The contracts cannot run here: .*necro-no-such-package/);
  }));

test('R6.16 auditSpec with a real failure and a contract that cannot run says FAILING and the reason lists the phrase', () =>
  mixed((cwd) => {
    const lock = readLock(cwd);
    const task = auditSpec(cwd, 'demo', lock).tasks[0];
    assert.equal(task.verdict, 'failing');
    const reason = problems({ tasks: [task] })[0].reason;
    assert.match(reason, /required contracts fail now/);
    assert.match(reason, /necro-no-such-package/);
  }));
