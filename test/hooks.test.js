import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../src/canon.js';
import { freezeSpec } from '../src/lock.js';
import { handlePreToolUse, handlePostToolUse, detectTaskDone, countTaskMarks } from '../src/hooks.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const REQ = fs.readFileSync(path.join(FIXTURES, 'requirements.md'), 'utf8');
const CONTRACT = fs.readFileSync(path.join(FIXTURES, 'hello.contract.test.js'), 'utf8');

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'necro-hooks-'));
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

function writeTasks(cwd, spec, content) {
  const dir = path.join(cwd, '.kiro', 'specs', spec);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tasks.md'), content);
}

function setupFrozen(cwd, spec) {
  writeReq(cwd, spec, REQ);
  writeContract(cwd, spec, 'hello.contract.test.js', CONTRACT);
  freezeSpec(cwd, spec);
}

function payload(cwd, toolName, toolInput) {
  return {
    session_id: 's-test',
    hook_event_name: 'PreToolUse',
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
  };
}

// A passing contract and a failing contract, used by the gate tests.
const PASSING_CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R1.1 passing contract', () => {
  assert.ok(true);
});
`;

const FAILING_CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R1.2 failing contract', () => {
  assert.equal(1, 2);
});
`;

// ---------------------------------------------------------------------------
// Task 6: PreToolUse blocks edits to frozen files (Req 3.1, 3.2, 3.4)
// ---------------------------------------------------------------------------

test('R3.1 handlePreToolUse blocks fs_write to a frozen file with a reason on stderr', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const frozenRel = '.kiro/specs/demo/requirements.md';
    const res = handlePreToolUse(
      payload(cwd, 'fs_write', { path: path.join(cwd, frozenRel), text: 'changed' }),
    );
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /frozen file/);
    assert.ok(res.stderr.includes(frozenRel), 'stderr names the frozen path');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.1 handlePreToolUse blocks str_replace to a frozen contract file', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const frozenRel = 'contracts/demo/hello.contract.test.js';
    const res = handlePreToolUse(
      payload(cwd, 'str_replace', { path: frozenRel, oldStr: 'a', newStr: 'b' }),
    );
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /frozen file/);
    assert.ok(res.stderr.includes(frozenRel), 'stderr names the frozen contract path');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.2 handlePreToolUse blocks any path under .necro/', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const res = handlePreToolUse(
      payload(cwd, 'fs_write', { path: path.join(cwd, '.necro', 'lock.json'), text: 'x' }),
    );
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /\.necro/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.2 handlePreToolUse blocks a relative path under .necro/', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const res = handlePreToolUse(
      payload(cwd, 'fs_write', { path: '.necro/receipts/demo/abc.json', text: 'x' }),
    );
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /\.necro/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.4 handlePreToolUse exits 0 and prints nothing for a non-frozen path', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const res = handlePreToolUse(
      payload(cwd, 'fs_write', { path: 'src/canon.js', text: 'x' }),
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, '');
    assert.equal(res.stdout, '');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 7: Gate on marking a task done (Req 4.1, 4.2, 4.3, 4.4, 4.5, 4.6)
// ---------------------------------------------------------------------------

test('countTaskMarks counts [x] marks case-insensitively', () => {
  assert.equal(countTaskMarks(''), 0);
  assert.equal(countTaskMarks('no marks here'), 0);
  assert.equal(countTaskMarks('- [ ] one\n- [ ] two'), 0);
  assert.equal(countTaskMarks('- [x] one\n- [ ] two'), 1);
  assert.equal(countTaskMarks('- [x] one\n- [X] two\n- [x] three'), 3);
});

test('R4.1 detectTaskDone sees a str_replace on tasks.md with more [x] in newStr as marking done', () => {
  const cwd = tmpCwd();
  try {
    writeTasks(cwd, 'demo', '- [ ] task one\n- [ ] task two\n');
    assert.equal(
      detectTaskDone(cwd, 'str_replace', {
        path: '.kiro/specs/demo/tasks.md',
        oldStr: '- [ ] task one',
        newStr: '- [x] task one',
      }),
      true,
    );
    // equal count -> not marking done
    assert.equal(
      detectTaskDone(cwd, 'str_replace', {
        path: '.kiro/specs/demo/tasks.md',
        oldStr: '- [x] task one',
        newStr: '- [x] task one',
      }),
      false,
    );
    // fewer [x] in newStr -> not marking done
    assert.equal(
      detectTaskDone(cwd, 'str_replace', {
        path: '.kiro/specs/demo/tasks.md',
        oldStr: '- [x] task one',
        newStr: '- [ ] task one',
      }),
      false,
    );
    // a path that is not tasks.md -> not a task-done edit
    assert.equal(
      detectTaskDone(cwd, 'str_replace', {
        path: 'src/canon.js',
        oldStr: '- [ ] task one',
        newStr: '- [x] task one',
      }),
      false,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.2 detectTaskDone sees an fs_write on tasks.md with more [x] than disk as marking done', () => {
  const cwd = tmpCwd();
  try {
    writeTasks(cwd, 'demo', '- [ ] task one\n'); // 0 [x] on disk
    assert.equal(
      detectTaskDone(cwd, 'fs_write', {
        path: '.kiro/specs/demo/tasks.md',
        text: '- [x] task one\n',
      }),
      true,
    );
    // same count on disk -> not marking done
    writeTasks(cwd, 'demo', '- [x] task one\n'); // 1 [x] on disk
    assert.equal(
      detectTaskDone(cwd, 'fs_write', {
        path: '.kiro/specs/demo/tasks.md',
        text: '- [x] task one\n',
      }),
      false,
    );
    // a path that is not tasks.md -> not a task-done edit
    assert.equal(
      detectTaskDone(cwd, 'fs_write', {
        path: 'src/canon.js',
        text: '- [x] task one\n',
      }),
      false,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.3 marking a task done on an unfrozen spec exits 2 with a freeze instruction', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'hello.contract.test.js', CONTRACT);
    writeTasks(cwd, 'demo', '- [ ] task one\n');
    // deliberately NOT frozen
    const res = handlePreToolUse(
      payload(cwd, 'str_replace', {
        path: '.kiro/specs/demo/tasks.md',
        oldStr: '- [ ] task one',
        newStr: '- [x] task one',
      }),
    );
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /not frozen/);
    assert.ok(res.stderr.includes('demo'), 'stderr names the spec');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.4 + R4.5 the gate runs the frozen contracts and a failing contract blocks the edit, listing names', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'fail.contract.test.js', FAILING_CONTRACT);
    freezeSpec(cwd, 'demo');
    writeTasks(cwd, 'demo', '- [ ] task one\n');

    const res = handlePreToolUse(
      payload(cwd, 'str_replace', {
        path: '.kiro/specs/demo/tasks.md',
        oldStr: '- [ ] task one',
        newStr: '- [x] task one',
      }),
    );
    // R4.5: exit 2 and list each failing contract by name. The failing name can
    // only appear if the gate ran the contracts (R4.4).
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /Contracts failed/);
    assert.ok(
      res.stderr.includes('R1.2 failing contract'),
      `lists the failing contract name: ${res.stderr}`,
    );
    // no receipt written on failure
    const receiptsDir = path.join(cwd, '.necro', 'receipts', 'demo');
    assert.ok(!fs.existsSync(receiptsDir) || fs.readdirSync(receiptsDir).length === 0, 'no receipt on failure');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.6 all contracts passing writes a receipt to .necro/receipts/<spec>/<hash>.json and exits 0', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo'); // hello contract -> 'demo contract' passes
    writeTasks(cwd, 'demo', '- [ ] task one\n');

    const res = handlePreToolUse(
      payload(cwd, 'str_replace', {
        path: '.kiro/specs/demo/tasks.md',
        oldStr: '- [ ] task one',
        newStr: '- [x] task one',
      }),
    );
    assert.equal(res.exitCode, 0);

    const receiptsDir = path.join(cwd, '.necro', 'receipts', 'demo');
    const files = fs.readdirSync(receiptsDir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1, 'exactly one receipt written');
    const fileName = files[0].replace(/\.json$/, '');
    const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, files[0]), 'utf8'));
    assert.equal(receipt.spec, 'demo');
    assert.equal(receipt.receiptHash, fileName, 'file is named after its receiptHash');
    assert.ok(
      receipt.contracts.every((c) => c.result === 'pass'),
      'every recorded contract passed',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 8: PostToolUse restores frozen files (Req 3.3)
// ---------------------------------------------------------------------------

function postPayload(cwd, command) {
  return {
    session_id: 's-test',
    hook_event_name: 'PostToolUse',
    cwd,
    tool_name: 'execute_bash',
    tool_input: { command },
  };
}

test('R3.3 handlePostToolUse restores a tampered frozen file from .necro/frozen and names it on stderr', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const contractRel = 'contracts/demo/hello.contract.test.js';
    const original = fs.readFileSync(path.join(cwd, contractRel), 'utf8');
    // Tamper with the frozen contract file so its SHA-256 no longer matches the lock.
    fs.writeFileSync(path.join(cwd, contractRel), original + '\n// tampered\n');
    assert.notEqual(
      sha256(fs.readFileSync(path.join(cwd, contractRel))),
      sha256(original),
    );

    const res = handlePostToolUse(postPayload(cwd, "sed -i 's/x/y/' contracts/demo/hello.contract.test.js"));
    assert.equal(res.exitCode, 0);
    assert.match(res.stderr, /Restored frozen file/);
    assert.ok(res.stderr.includes(contractRel), 'stderr names the restored file');
    // The file is restored to its original frozen content.
    assert.equal(fs.readFileSync(path.join(cwd, contractRel), 'utf8'), original);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.3 handlePostToolUse restores the requirements file too when it is tampered', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const reqRel = '.kiro/specs/demo/requirements.md';
    const original = fs.readFileSync(path.join(cwd, reqRel), 'utf8');
    fs.writeFileSync(path.join(cwd, reqRel), original + '\ntampered\n');

    const res = handlePostToolUse(postPayload(cwd, 'echo bad >> .kiro/specs/demo/requirements.md'));
    assert.equal(res.exitCode, 0);
    assert.ok(res.stderr.includes(reqRel), 'stderr names the restored requirements file');
    assert.equal(fs.readFileSync(path.join(cwd, reqRel), 'utf8'), original);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.3 handlePostToolUse exits 0 and prints nothing when no frozen file changed', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const res = handlePostToolUse(postPayload(cwd, 'ls -la'));
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, '');
    assert.equal(res.stdout, '');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.3 handlePostToolUse is a no-op for a non-execute_bash tool', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const res = handlePostToolUse({
      session_id: 's-test',
      hook_event_name: 'PostToolUse',
      cwd,
      tool_name: 'fs_write',
      tool_input: { path: 'src/canon.js', text: 'x' },
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, '');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
