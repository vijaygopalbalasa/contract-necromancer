import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../src/canon.js';
import { freezeSpec } from '../src/lock.js';
import { verify } from '../src/verify.js';
import { handlePreToolUse, handlePostToolUse, handleStop, detectTaskDone, countTaskMarks } from '../src/hooks.js';

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


// ---------------------------------------------------------------------------
// Task 8c: Close bypasses (Req 3.5, 3.6, 3.7, 4.1, 4.2)
// ---------------------------------------------------------------------------

const FROZEN_CONTRACT_REL = 'contracts/demo/hello.contract.test.js';
const TASKS_REL = '.kiro/specs/demo/tasks.md';

function preBlocked(cwd, toolName, toolInput) {
  return handlePreToolUse(payload(cwd, toolName, toolInput));
}

test('R3.5 a write whose path differs only in letter case from a frozen file is blocked', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    for (const p of [
      'Contracts/demo/hello.contract.test.js',
      'contracts/DEMO/HELLO.contract.test.js',
      '.KIRO/specs/demo/Requirements.md',
    ]) {
      const res = preBlocked(cwd, 'fs_write', { path: p, text: 'x' });
      assert.equal(res.exitCode, 2, `${p} is blocked`);
      assert.match(res.stderr, /frozen file/);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.5 a write whose path differs only in letter case from .necro/ is blocked', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    for (const p of ['.NECRO/lock.json', '.Necro/receipts/demo/a.json', '.necro']) {
      const res = preBlocked(cwd, 'str_replace', { path: p, oldStr: 'a', newStr: 'b' });
      assert.equal(res.exitCode, 2, `${p} is blocked`);
      assert.match(res.stderr, /\.necro/);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.5 a write through a symbolic link to a frozen file is blocked', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.symlinkSync(path.join(cwd, FROZEN_CONTRACT_REL), path.join(cwd, 'src', 'alias.js'));
    // a relative link target works too
    fs.symlinkSync(`../${FROZEN_CONTRACT_REL}`, path.join(cwd, 'src', 'alias2.js'));
    for (const p of ['src/alias.js', 'src/alias2.js']) {
      const res = preBlocked(cwd, 'fs_write', { path: p, text: 'x' });
      assert.equal(res.exitCode, 2, `${p} is blocked`);
      assert.ok(res.stderr.includes(FROZEN_CONTRACT_REL), 'stderr names the real frozen path');
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.5 a new file under a symbolic link to .necro/ is blocked using the nearest existing parent', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    fs.symlinkSync(path.join(cwd, '.necro'), path.join(cwd, 'shortcut'));
    const res = preBlocked(cwd, 'fs_write', { path: 'shortcut/receipts/demo/new.json', text: '{}' });
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /\.necro/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.5 a project path that is not protected stays allowed even through a symbolic link', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'a.js'), '');
    fs.symlinkSync(path.join(cwd, 'src', 'a.js'), path.join(cwd, 'src', 'b.js'));
    const res = preBlocked(cwd, 'fs_write', { path: 'src/b.js', text: 'x' });
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, '');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.6 an unknown tool is blocked when any input field names a protected path', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const absFrozen = path.join(cwd, FROZEN_CONTRACT_REL);
    const calls = [
      ['custom_write_tool', { path: FROZEN_CONTRACT_REL, text: 'x' }],
      ['delete_file', { explanation: 'tidy', targetFile: absFrozen }],
      ['fs_append', { path: FROZEN_CONTRACT_REL, text: 'x' }],
      ['multi_edit', { edits: [{ file: 'src/ok.js' }, { file: '.necro/lock.json' }] }],
      ['move_files', { paths: ['src/a.js', FROZEN_CONTRACT_REL] }],
      ['rename', { from: 'src/a.js', to: 'Contracts/demo/HELLO.contract.test.js' }],
    ];
    for (const [tool, input] of calls) {
      const res = preBlocked(cwd, tool, input);
      assert.equal(res.exitCode, 2, `${tool} is blocked`);
      assert.notEqual(res.stderr, '', `${tool} gives a reason`);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.6 only read_file, list_directory, grep and glob may touch a protected path', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    for (const tool of ['read_file', 'list_directory', 'grep', 'glob']) {
      const res = preBlocked(cwd, tool, { path: FROZEN_CONTRACT_REL, pattern: '.necro/lock.json' });
      assert.equal(res.exitCode, 0, `${tool} is allowed`);
      assert.equal(res.stderr, '');
    }
    // any other tool name, even one that sounds read-only, is treated as a write
    for (const tool of ['grep_search', 'file_search', 'view_file']) {
      const res = preBlocked(cwd, tool, { path: FROZEN_CONTRACT_REL });
      assert.equal(res.exitCode, 2, `${tool} is not a known read-only tool`);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.6 an unknown tool that names no protected path is allowed silently', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const res = preBlocked(cwd, 'custom_write_tool', { path: 'src/ok.js', other: ['a', { b: 'c' }], n: 3 });
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, '');
    assert.equal(res.stdout, '');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.6 a write tool with no tool_input at all does not crash', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const res = handlePreToolUse({ cwd, tool_name: 'custom_write_tool' });
    assert.equal(res.exitCode, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// -- R3.7: a shell command ticks a task ------------------------------------

const TASKS_TWO = '- [ ] 1. Task one\n- [ ] 2. Task two\n';

function tasksPath(cwd) {
  return path.join(cwd, TASKS_REL);
}

function bashPre(cwd) {
  return handlePreToolUse(payload(cwd, 'execute_bash', { command: 'true' }));
}

// PostToolUse payload for a write tool (fs_write or str_replace).
function writePostPayload(cwd, toolName, toolInput) {
  return { session_id: 's-test', hook_event_name: 'PostToolUse', cwd, tool_name: toolName, tool_input: toolInput };
}

function receiptCount(cwd) {
  const dir = path.join(cwd, '.necro', 'receipts', 'demo');
  return fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
}

test('R3.7 a shell command that ticks a task while contracts fail gets tasks.md restored, with the failing names on stderr', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'fail.contract.test.js', FAILING_CONTRACT);
    freezeSpec(cwd, 'demo');
    writeTasks(cwd, 'demo', TASKS_TWO);

    const pre = bashPre(cwd); // the gate records tasks.md before the command runs
    assert.equal(pre.exitCode, 0);
    assert.equal(pre.stderr, '');

    fs.writeFileSync(tasksPath(cwd), '- [x] 1. Task one\n- [ ] 2. Task two\n'); // "sed -i" did this
    const res = handlePostToolUse(postPayload(cwd, "sed -i 's/\\[ \\] 1/[x] 1/' tasks.md"));

    assert.equal(res.exitCode, 0);
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_TWO, 'tasks.md is back to the recorded state');
    assert.ok(res.stderr.includes('R1.2 failing contract'), `names the failing contract: ${res.stderr}`);
    assert.ok(res.stderr.includes(TASKS_REL), 'names the restored file');
    assert.equal(receiptCount(cwd), 0, 'no receipt for a failed gate');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.7 a shell tick is kept and receipted when every contract passes', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    writeTasks(cwd, 'demo', TASKS_TWO);
    bashPre(cwd);
    const ticked = '- [x] 1. Task one\n- [ ] 2. Task two\n';
    fs.writeFileSync(tasksPath(cwd), ticked);

    const res = handlePostToolUse(postPayload(cwd, 'echo ticked'));
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, '');
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), ticked);
    assert.equal(receiptCount(cwd), 1, 'a receipt was written');

    // the new state is recorded: a later failing tick is compared against it
    fs.writeFileSync(tasksPath(cwd), '- [x] 1. Task one\n- [x] 2. Task two\n');
    const again = handlePostToolUse(postPayload(cwd, 'echo again'));
    assert.equal(again.stderr, '');
    assert.equal(receiptCount(cwd), 2, 'a second tick is another task, so it gets its own receipt (Req 5.5)');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.7 a shell tick on a frozen spec with no recorded state is checked against an all-unticked baseline', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'fail.contract.test.js', FAILING_CONTRACT);
    freezeSpec(cwd, 'demo');
    writeTasks(cwd, 'demo', '- [x] 1. Task one\n- [ ] 2. Task two\n');

    const res = handlePostToolUse(postPayload(cwd, 'echo hi'));
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_TWO, 'the unvetted tick is undone');
    assert.ok(res.stderr.includes('R1.2 failing contract'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.7 a shell command that does not tick a task changes nothing and prints nothing', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'fail.contract.test.js', FAILING_CONTRACT);
    freezeSpec(cwd, 'demo');
    writeTasks(cwd, 'demo', '- [x] 1. Task one\n- [ ] 2. Task two\n');
    bashPre(cwd);

    // unchanged
    let res = handlePostToolUse(postPayload(cwd, 'ls'));
    assert.equal(res.stderr, '');
    // unticking is allowed
    fs.writeFileSync(tasksPath(cwd), TASKS_TWO);
    res = handlePostToolUse(postPayload(cwd, 'sed ...'));
    assert.equal(res.stderr, '');
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_TWO);
    // the recorded state followed the untick, so ticking task 1 again is a new tick
    fs.writeFileSync(tasksPath(cwd), '- [x] 1. Task one\n- [ ] 2. Task two\n');
    res = handlePostToolUse(postPayload(cwd, 'sed ...'));
    assert.ok(res.stderr.includes('R1.2 failing contract'));
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_TWO);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.7 a shell tick in a spec that is not frozen is ignored', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    writeTasks(cwd, 'other', '- [ ] 1. Task\n');
    bashPre(cwd);
    const otherTasks = path.join(cwd, '.kiro', 'specs', 'other', 'tasks.md');
    fs.writeFileSync(otherTasks, '- [x] 1. Task\n');
    const res = handlePostToolUse(postPayload(cwd, 'echo hi'));
    assert.equal(res.stderr, '');
    assert.equal(fs.readFileSync(otherTasks, 'utf8'), '- [x] 1. Task\n');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.7 a task edit allowed by PreToolUse is recorded (R3.10: by PostToolUse), so unticking then re-ticking by shell is caught', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'fail.contract.test.js', FAILING_CONTRACT);
    freezeSpec(cwd, 'demo');
    writeTasks(cwd, 'demo', '- [x] 1. Task one\n- [ ] 2. Task two\n');
    bashPre(cwd); // records task 1 as ticked
    // an untick through str_replace is allowed and must update the recorded state
    const edit = { path: TASKS_REL, oldStr: '- [x] 1.', newStr: '- [ ] 1.' };
    const res = handlePreToolUse(payload(cwd, 'str_replace', edit));
    assert.equal(res.exitCode, 0);
    fs.writeFileSync(tasksPath(cwd), TASKS_TWO); // the tool applied it
    handlePostToolUse(writePostPayload(cwd, 'str_replace', edit)); // and PostToolUse records it
    // now a shell command ticks task 1 again
    fs.writeFileSync(tasksPath(cwd), '- [x] 1. Task one\n- [ ] 2. Task two\n');
    const post = handlePostToolUse(postPayload(cwd, 'sed ...'));
    assert.ok(post.stderr.includes('R1.2 failing contract'), `re-tick is gated: ${post.stderr}`);
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_TWO);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// -- R4.1 / R4.2: detecting a tick ------------------------------------------

function detectOnDisk(tasksText, toolName, toolInput) {
  const cwd = tmpCwd();
  try {
    writeTasks(cwd, 'demo', tasksText);
    return detectTaskDone(cwd, toolName, { path: TASKS_REL, ...toolInput });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('R4.1 a str_replace that unticks one task and ticks another is marking a task done', () => {
  const disk = '- [x] Task A\n- [ ] Task B\n';
  assert.equal(
    detectOnDisk(disk, 'str_replace', {
      oldStr: '- [x] Task A\n- [ ] Task B\n',
      newStr: '- [ ] Task A\n- [x] Task B\n',
    }),
    true,
  );
  // only unticking is not marking done
  assert.equal(
    detectOnDisk(disk, 'str_replace', { oldStr: '- [x] Task A', newStr: '- [ ] Task A' }),
    false,
  );
});

test('R4.1 a str_replace is applied to the file on disk, so a partial-line edit that ticks a box is caught', () => {
  const disk = '- [ ] Task A\n- [ ] Task B\n';
  assert.equal(detectOnDisk(disk, 'str_replace', { oldStr: ' ] Task A', newStr: 'x] Task A' }), true);
  assert.equal(detectOnDisk(disk, 'str_replace', { oldStr: '[ ] Task A', newStr: '[X] Task A' }), true);
});

test('R4.1 a str_replace that ticks a task and renames it in the same edit is caught', () => {
  const disk = '- [ ] Task A\n- [ ] Task B\n';
  assert.equal(
    detectOnDisk(disk, 'str_replace', { oldStr: '- [ ] Task A', newStr: '- [x] Task A, renamed' }),
    true,
  );
});

test('R4.1 replace_all ticks every match', () => {
  const disk = '- [ ] Task A\n- [ ] Task A\n';
  assert.equal(
    detectOnDisk(disk, 'str_replace', { oldStr: '- [ ] Task A', newStr: '- [x] Task A', replace_all: true }),
    true,
  );
});

test('R4.1 a str_replace on tasks.md that changes no task line is not marking done', () => {
  const disk = '- [x] Task A\n- [ ] Task B\nSome notes\n';
  assert.equal(detectOnDisk(disk, 'str_replace', { oldStr: 'Some notes', newStr: 'Other [x] notes' }), false);
  assert.equal(detectOnDisk(disk, 'str_replace', { oldStr: 'Task B', newStr: 'Task C' }), false);
});

test('R4.1 a str_replace through a symbolic link to tasks.md is checked as tasks.md', () => {
  const cwd = tmpCwd();
  try {
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'fail.contract.test.js', FAILING_CONTRACT);
    freezeSpec(cwd, 'demo');
    writeTasks(cwd, 'demo', TASKS_TWO);
    fs.symlinkSync(tasksPath(cwd), path.join(cwd, 'notes.md'));
    const res = handlePreToolUse(
      payload(cwd, 'str_replace', { path: 'notes.md', oldStr: '- [ ] 1.', newStr: '- [x] 1.' }),
    );
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /Contracts failed/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.2 an fs_write that ticks one task and renames another line is caught', () => {
  assert.equal(
    detectOnDisk('- [ ] Task A\n- [ ] Task B\n', 'fs_write', { text: '- [x] Task A v2\n- [ ] Task B\n' }),
    true,
  );
  // CRLF files and LF text compare equal line by line
  assert.equal(
    detectOnDisk('- [ ] Task A\r\n- [ ] Task B\r\n', 'fs_write', { text: '- [x] Task A\n- [ ] Task B\n' }),
    true,
  );
  assert.equal(
    detectOnDisk('- [x] Task A\r\n- [ ] Task B\r\n', 'fs_write', { text: '- [x] Task A\n- [ ] Task B\n' }),
    false,
  );
});

test('R4.2 an fs_write that unticks one task and ticks another is marking done', () => {
  assert.equal(
    detectOnDisk('- [x] Task A\n- [ ] Task B\n', 'fs_write', { text: '- [ ] Task A\n- [x] Task B\n' }),
    true,
  );
});

test('R4.2 an fs_write that only unticks or leaves ticks as they were is not marking done', () => {
  const disk = '- [x] Task A\n- [x] Task B\n';
  assert.equal(detectOnDisk(disk, 'fs_write', { text: '- [x] Task A\n- [ ] Task B\n' }), false);
  assert.equal(detectOnDisk(disk, 'fs_write', { text: disk }), false);
});

test('R4.2 an fs_write that creates tasks.md with a ticked task is marking done', () => {
  const cwd = tmpCwd();
  try {
    assert.equal(
      detectTaskDone(cwd, 'fs_write', { path: TASKS_REL, text: '- [x] Task A\n' }),
      true,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 9: Stop handler - session summary (Req 7.1)
// ---------------------------------------------------------------------------

function stopPayload(cwd) {
  return {
    session_id: 's-test',
    hook_event_name: 'Stop',
    cwd,
  };
}

test('R7.1 handleStop prints each frozen spec: count of tasks done, count of receipts, and contract status', () => {
  const cwd = tmpCwd();
  try {
    // Set up a frozen spec with both passing and failing contracts
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'passing.contract.test.js', PASSING_CONTRACT);
    writeContract(cwd, 'demo', 'failing.contract.test.js', FAILING_CONTRACT);
    freezeSpec(cwd, 'demo');

    // Write tasks with 1 done
    writeTasks(cwd, 'demo', '- [x] Task 1\n- [ ] Task 2\n');

    // Write a receipt
    const receiptsDir = path.join(cwd, '.necro', 'receipts', 'demo');
    fs.mkdirSync(receiptsDir, { recursive: true });
    const fakeReceiptName = 'aaaa0000000000000000000000000000000000000000000000000000000000.json';
    fs.writeFileSync(path.join(receiptsDir, fakeReceiptName), '{}');

    const result = handleStop(stopPayload(cwd));
    assert.equal(result.exitCode, 0);
    const out = result.stdout;
    assert.match(out, /Spec demo:/);
    assert.ok(out.includes('1 tasks done'), 'output shows 1 task done');
    assert.ok(out.includes('1 receipts'), 'output shows 1 receipt');
    assert.ok(out.includes('failing'), 'output shows failing contracts (since failing contract exists)');
    assert.ok(out.includes('R1.2 failing contract'), 'output includes the failing contract name');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 8d: fail closed on ticks (Req 4.13)
// ---------------------------------------------------------------------------

// A frozen spec whose only contract fails, so any write the gate lets through
// is a hole, and any write it stops shows "Contracts failed".
function frozenFailingWithTasks(tasksText) {
  const cwd = tmpCwd();
  writeReq(cwd, 'demo', REQ);
  writeContract(cwd, 'demo', 'fail.contract.test.js', FAILING_CONTRACT);
  freezeSpec(cwd, 'demo');
  if (tasksText !== null) writeTasks(cwd, 'demo', tasksText);
  return cwd;
}

function assertGated(res) {
  assert.equal(res.exitCode, 2, `expected the gate to run, got: ${JSON.stringify(res)}`);
  assert.match(res.stderr, /Contracts failed: R1\.2 failing contract/);
}

test('R4.13 an fs_write that creates tasks.md with a ticked line runs the gate', () => {
  const cwd = frozenFailingWithTasks(null);
  try {
    assertGated(handlePreToolUse(payload(cwd, 'fs_write', { path: TASKS_REL, text: '- [x] 1. Task one\n' })));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.13 an fs_write that adds a ticked line with no matching unticked line before it runs the gate', () => {
  const cwd = frozenFailingWithTasks(TASKS_TWO);
  try {
    const text = `${TASKS_TWO}- [x] 3. Task three, never listed before\n`;
    assertGated(handlePreToolUse(payload(cwd, 'fs_write', { path: TASKS_REL, text })));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.13 a ticked line without a list marker counts as a ticked task line', () => {
  const cwd = frozenFailingWithTasks(null);
  try {
    for (const line of ['[x] 1. Task one', '-[x] 1. Task one', '  [X] 1. Task one']) {
      assertGated(handlePreToolUse(payload(cwd, 'fs_write', { path: TASKS_REL, text: `${line}\n` })));
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.13 a bare [ ] -> [x] change on a line without a list marker runs the gate', () => {
  const cwd = frozenFailingWithTasks('[ ] 1. Task one\n');
  try {
    assertGated(
      handlePreToolUse(payload(cwd, 'str_replace', { path: TASKS_REL, oldStr: '[ ] 1.', newStr: '[x] 1.' })),
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.13 a partial-line str_replace that does not match the file on disk still runs the gate', () => {
  // The oldStr is not in the file exactly (extra space on disk), so the edit
  // cannot be applied here; the hook must not guess it is harmless.
  const cwd = frozenFailingWithTasks('- [ ]  1. Task one\n');
  try {
    assertGated(
      handlePreToolUse(payload(cwd, 'str_replace', { path: TASKS_REL, oldStr: '[ ] 1.', newStr: '[x] 1.' })),
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.13 a partial-line str_replace that ticks inside a line, applied to the disk file, runs the gate', () => {
  const cwd = frozenFailingWithTasks(TASKS_TWO);
  try {
    assertGated(
      handlePreToolUse(payload(cwd, 'str_replace', { path: TASKS_REL, oldStr: ' ] 2.', newStr: 'x] 2.' })),
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.13 a write that does not raise the ticked count stays silent', () => {
  const cwd = frozenFailingWithTasks('- [x] 1. Task one\n- [ ] 2. Task two\n');
  try {
    const quiet = [
      ['fs_write', { path: TASKS_REL, text: '- [x] 1. Task one\n- [ ] 2. Task two\nNotes about [x] marks\n' }],
      ['fs_write', { path: TASKS_REL, text: '- [ ] 1. Task one\n- [ ] 2. Task two\n' }],
      ['str_replace', { path: TASKS_REL, oldStr: 'Task two', newStr: 'Task 2' }],
    ];
    for (const [tool, input] of quiet) {
      assert.deepEqual(handlePreToolUse(payload(cwd, tool, input)), { exitCode: 0, stdout: '', stderr: '' });
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 8e: state the shell cannot forge, fail closed on odd input
// (Req 3.8, 3.9, 3.10, 3.11)
// ---------------------------------------------------------------------------

function stateFilePath(cwd) {
  return path.join(cwd, '.necro', 'state', 'demo.tasks.md');
}

function readState(cwd) {
  try {
    return fs.readFileSync(stateFilePath(cwd), 'utf8');
  } catch {
    return null;
  }
}

function frozenWithFailingContract(cwd, tasks = TASKS_TWO) {
  writeReq(cwd, 'demo', REQ);
  writeContract(cwd, 'demo', 'fail.contract.test.js', FAILING_CONTRACT);
  freezeSpec(cwd, 'demo');
  writeTasks(cwd, 'demo', tasks);
}

test('R3.8 PreToolUse for execute_bash replaces an earlier recorded state with the current tasks.md', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    writeTasks(cwd, 'demo', TASKS_TWO);
    assert.equal(bashPre(cwd).exitCode, 0);
    assert.equal(readState(cwd), TASKS_TWO);

    const later = '- [ ] 1. Task one\n- [ ] 2. Task two\n- [ ] 3. Task three\n';
    fs.writeFileSync(tasksPath(cwd), later);
    assert.equal(bashPre(cwd).exitCode, 0);
    assert.equal(readState(cwd), later, 'the earlier record is replaced, not kept');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.8 PreToolUse for execute_bash records every frozen spec and skips specs that are not frozen', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    setupFrozen(cwd, 'second');
    writeTasks(cwd, 'demo', TASKS_TWO);
    writeTasks(cwd, 'second', '- [ ] 1. Other\n');
    writeTasks(cwd, 'loose', '- [ ] 1. Not frozen\n');
    bashPre(cwd);
    const stateDir = path.join(cwd, '.necro', 'state');
    assert.equal(fs.readFileSync(path.join(stateDir, 'demo.tasks.md'), 'utf8'), TASKS_TWO);
    assert.equal(fs.readFileSync(path.join(stateDir, 'second.tasks.md'), 'utf8'), '- [ ] 1. Other\n');
    assert.ok(!fs.existsSync(path.join(stateDir, 'loose.tasks.md')), 'no record for a spec that is not frozen');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.9 a shell command that edits the recorded state and ticks a task while contracts fail still gets tasks.md restored', () => {
  const cwd = tmpCwd();
  try {
    frozenWithFailingContract(cwd);
    assert.equal(bashPre(cwd).exitCode, 0);

    // the command forges the record so that the tick looks like it was always there
    const ticked = '- [x] 1. Task one\n- [ ] 2. Task two\n';
    fs.writeFileSync(tasksPath(cwd), ticked);
    fs.writeFileSync(stateFilePath(cwd), ticked);

    const res = handlePostToolUse(postPayload(cwd, 'cp tasks.md .necro/state/demo.tasks.md'));
    assert.equal(res.exitCode, 0);
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_TWO, 'tasks.md is unticked again');
    assert.ok(res.stderr.includes('R1.2 failing contract'), `names the failing contract: ${res.stderr}`);
    assert.ok(res.stderr.includes(TASKS_REL), 'names the restored file');
    assert.equal(receiptCount(cwd), 0, 'no receipt for a failed gate');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.9 when the recorded state changed during the command, every [x] task line is newly ticked', () => {
  const cwd = tmpCwd();
  try {
    frozenWithFailingContract(cwd, '- [x] 1. Task one\n- [ ] 2. Task two\n');
    bashPre(cwd); // records task 1 as already ticked
    // the command rewrites the record but changes nothing in tasks.md
    fs.writeFileSync(stateFilePath(cwd), '- [x] 1. Task one\n- [ ] 2. Task two\n\n');
    const res = handlePostToolUse(postPayload(cwd, 'echo >> .necro/state/demo.tasks.md'));
    assert.ok(res.stderr.includes('R1.2 failing contract'), `ticked line 1 is checked again: ${res.stderr}`);
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_TWO);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.9 a forged record with passing contracts keeps the tick and writes a receipt', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    writeTasks(cwd, 'demo', TASKS_TWO);
    bashPre(cwd);
    const ticked = '- [x] 1. Task one\n- [ ] 2. Task two\n';
    fs.writeFileSync(tasksPath(cwd), ticked);
    fs.writeFileSync(stateFilePath(cwd), ticked);
    const res = handlePostToolUse(postPayload(cwd, 'cp tasks.md state'));
    assert.equal(res.stderr, '');
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), ticked);
    assert.equal(receiptCount(cwd), 1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.9 a record the command left alone is still the baseline, so earlier ticks are not re-checked', () => {
  const cwd = tmpCwd();
  try {
    frozenWithFailingContract(cwd, '- [x] 1. Task one\n- [ ] 2. Task two\n');
    bashPre(cwd);
    const res = handlePostToolUse(postPayload(cwd, 'ls'));
    assert.equal(res.stderr, '');
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), '- [x] 1. Task one\n- [ ] 2. Task two\n');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.9 a record that was deleted during the command is not trusted either', () => {
  const cwd = tmpCwd();
  try {
    frozenWithFailingContract(cwd);
    bashPre(cwd);
    fs.writeFileSync(tasksPath(cwd), '- [x] 1. Task one\n- [ ] 2. Task two\n');
    fs.rmSync(path.join(cwd, '.necro', 'state'), { recursive: true, force: true });
    const res = handlePostToolUse(postPayload(cwd, 'rm -r .necro/state'));
    assert.ok(res.stderr.includes('R1.2 failing contract'));
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_TWO);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.10 PreToolUse records nothing for a tasks.md write; PostToolUse records the file on disk', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    writeTasks(cwd, 'demo', TASKS_TWO);
    const edit = { path: TASKS_REL, oldStr: '- [ ] 1.', newStr: '- [x] 1.' };
    const pre = handlePreToolUse(payload(cwd, 'str_replace', edit));
    assert.equal(pre.exitCode, 0);
    assert.equal(readState(cwd), null, 'nothing is recorded before the write has been applied');

    // what the tool really left on disk differs from what the hook could predict
    const landed = '- [x] 1. Task one\n- [ ] 2. Task two\nline the tool added\n';
    fs.writeFileSync(tasksPath(cwd), landed);
    const post = handlePostToolUse(writePostPayload(cwd, 'str_replace', edit));
    assert.equal(post.exitCode, 0);
    assert.equal(post.stderr, '');
    assert.equal(post.stdout, '');
    assert.equal(readState(cwd), landed, 'the record is the file on disk');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.10 PostToolUse after an fs_write on tasks.md records the file on disk', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    writeTasks(cwd, 'demo', TASKS_TWO);
    const edit = { path: TASKS_REL, text: '- [x] 1. Task one\n- [ ] 2. Task two\n' };
    assert.equal(handlePreToolUse(payload(cwd, 'fs_write', edit)).exitCode, 0);
    assert.equal(readState(cwd), null);
    fs.writeFileSync(tasksPath(cwd), edit.text);
    handlePostToolUse(writePostPayload(cwd, 'fs_write', edit));
    assert.equal(readState(cwd), edit.text);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.10 a blocked tick records nothing, and an allowed untick is recorded after it lands', () => {
  const cwd = tmpCwd();
  try {
    frozenWithFailingContract(cwd);
    const tick = { path: TASKS_REL, oldStr: '- [ ] 1.', newStr: '- [x] 1.' };
    assert.equal(handlePreToolUse(payload(cwd, 'str_replace', tick)).exitCode, 2);
    assert.equal(readState(cwd), null);

    bashPre(cwd); // state = TASKS_TWO
    fs.writeFileSync(tasksPath(cwd), '- [x] 1. Task one\n- [ ] 2. Task two\n'); // a person ticked in the editor
    const untick = { path: TASKS_REL, oldStr: '- [x] 1.', newStr: '- [ ] 1.' };
    assert.equal(handlePreToolUse(payload(cwd, 'str_replace', untick)).exitCode, 0);
    fs.writeFileSync(tasksPath(cwd), TASKS_TWO);
    handlePostToolUse(writePostPayload(cwd, 'str_replace', untick));
    assert.equal(readState(cwd), TASKS_TWO);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.10 PostToolUse after a write records nothing for other files or for a spec that is not frozen', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    writeTasks(cwd, 'demo', TASKS_TWO);
    writeTasks(cwd, 'loose', '- [x] 1. Not frozen\n');
    for (const input of [
      { path: 'src/canon.js', text: 'x' },
      { path: '.kiro/specs/loose/tasks.md', text: '- [x] 1. Not frozen\n' },
      { path: 'notes\0.md', text: 'x' },
    ]) {
      const res = handlePostToolUse(writePostPayload(cwd, 'fs_write', input));
      assert.equal(res.exitCode, 0);
      assert.equal(res.stderr, '');
    }
    assert.equal(readState(cwd), null);
    assert.ok(!fs.existsSync(path.join(cwd, '.necro', 'state', 'loose.tasks.md')));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.10 a tick recorded after a write is the baseline for a later shell tick of another task', () => {
  const cwd = tmpCwd();
  try {
    // contracts pass at first, so the editor tick is allowed and recorded
    setupFrozen(cwd, 'demo');
    writeTasks(cwd, 'demo', TASKS_TWO);
    const edit = { path: TASKS_REL, oldStr: '- [ ] 1.', newStr: '- [x] 1.' };
    assert.equal(handlePreToolUse(payload(cwd, 'str_replace', edit)).exitCode, 0);
    fs.writeFileSync(tasksPath(cwd), '- [x] 1. Task one\n- [ ] 2. Task two\n');
    handlePostToolUse(writePostPayload(cwd, 'str_replace', edit));

    // a later shell command with no PreToolUse record in between changes nothing
    const res = handlePostToolUse(postPayload(cwd, 'ls'));
    assert.equal(res.stderr, '');
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), '- [x] 1. Task one\n- [ ] 2. Task two\n');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

const TOO_LONG = 'a'.repeat(5000);

test('R3.11 a write tool whose path is too long to check is blocked', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    for (const [tool, input] of [
      ['fs_write', { path: `src/${TOO_LONG}.js`, text: 'x' }],
      ['str_replace', { path: `src/${TOO_LONG}.js`, oldStr: 'a', newStr: 'b' }],
    ]) {
      const res = preBlocked(cwd, tool, input);
      assert.equal(res.exitCode, 2, `${tool} is blocked`);
      assert.notEqual(res.stderr, '', 'gives a reason');
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.11 a write tool whose path contains a NUL character is blocked', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    for (const p of ['src/ok.js\0.txt', `${FROZEN_CONTRACT_REL}\0`, '\0', 'src/\0/ok.js']) {
      const res = preBlocked(cwd, 'fs_write', { path: p, text: 'x' });
      assert.equal(res.exitCode, 2, `${JSON.stringify(p)} is blocked`);
      assert.notEqual(res.stderr, '');
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.11 an unknown tool with a long or NUL string anywhere in its input is blocked', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const inputs = [
      { target: TOO_LONG },
      { target: 'src/a\0b.js' },
      { text: TOO_LONG, path: 'src/ok.js' },
      { edits: [{ file: 'src/ok.js' }, { file: `${TOO_LONG}` }] },
      { paths: ['src/ok.js', 'x\0y'] },
    ];
    for (const input of inputs) {
      const res = preBlocked(cwd, 'custom_write_tool', input);
      assert.equal(res.exitCode, 2, `${JSON.stringify(input).slice(0, 60)} is blocked`);
      assert.notEqual(res.stderr, '');
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.11 file content and shell commands may be long or hold NUL; read-only tools are never blocked for it', () => {
  const cwd = tmpCwd();
  try {
    setupFrozen(cwd, 'demo');
    const big = 'line\n'.repeat(50000);
    for (const [tool, input] of [
      ['fs_write', { path: 'src/big.js', text: big }],
      ['fs_write', { path: 'src/bin.dat', text: 'a\0b' }],
      ['str_replace', { path: 'src/ok.js', oldStr: big, newStr: `${big}\0` }],
      ['execute_bash', { command: `echo ${TOO_LONG}` }],
      ['read_file', { path: 'src/ok.js', note: TOO_LONG }],
      ['grep', { pattern: 'a\0b' }],
      ['glob', { pattern: TOO_LONG }],
      ['list_directory', { path: 'src\0' }],
    ]) {
      const res = preBlocked(cwd, tool, input);
      assert.equal(res.exitCode, 0, `${tool} is allowed`);
      assert.equal(res.stderr, '');
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 12: gate on the ticked task's own criteria (Req 2.7, 3.7, 4.5, 4.14, 4.15, 5.5)
// ---------------------------------------------------------------------------

// One contract file: R1.1 and R1.3 pass, R1.2 fails.
const MIXED_CONTRACT = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R1.1 passing contract', () => { assert.ok(true); });
test('R1.2 failing contract', () => { assert.equal(1, 2); });
test('R1.3 other passing contract', () => { assert.ok(true); });
`;

const T1 = '- [ ] 1. Task one (Req 1.1)';
const T2 = '- [ ] 2. Task two (Req 1.2)';
const T3 = '- [ ] 3. Task three (Req 1.3)';
const T4 = '- [ ] 4. Task four (Req 1.1, 1.2)';
const T5 = '- [ ] 5. Task five';
const T6 = '- [ ] 6. Task six (Req 7.7)';
const TASKS_MIXED = [T1, T2, T3, T4, T5, T6, ''].join('\n');

const tick = (line) => line.replace('[ ]', '[x]');

// A frozen spec whose tasks.md was in place at freeze time. Extra lines can be
// added to tasks.md afterwards, so the lock does not know them.
function setupMixed(tasksAtFreeze = TASKS_MIXED, tasksNow = tasksAtFreeze) {
  const cwd = tmpCwd();
  writeReq(cwd, 'demo', REQ);
  writeContract(cwd, 'demo', 'mixed.contract.test.js', MIXED_CONTRACT);
  writeTasks(cwd, 'demo', tasksAtFreeze);
  freezeSpec(cwd, 'demo');
  writeTasks(cwd, 'demo', tasksNow);
  return cwd;
}

function tickEdit(oldStr, newStr) {
  return { path: TASKS_REL, oldStr, newStr };
}

function readReceipts(cwd) {
  const dir = path.join(cwd, '.necro', 'receipts', 'demo');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

test('R4.14 + R5.5 ticking a task whose required contracts pass is allowed while another contract fails, and the receipt says what was required', () => {
  const cwd = setupMixed();
  try {
    const res = handlePreToolUse(payload(cwd, 'str_replace', tickEdit(T1, tick(T1))));
    assert.equal(res.exitCode, 0, res.stderr);
    assert.equal(res.stderr, '');

    const receipts = readReceipts(cwd);
    assert.equal(receipts.length, 1);
    const r = receipts[0];
    assert.deepEqual(r.task, { id: '1', line: '1. Task one (Req 1.1)' });
    assert.deepEqual(r.required, ['R1.1 passing contract']);
    const byName = Object.fromEntries(r.contracts.map((c) => [c.name, c.result]));
    assert.deepEqual(byName, {
      'R1.1 passing contract': 'pass',
      'R1.2 failing contract': 'fail',
      'R1.3 other passing contract': 'pass',
    });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.14 an fs_write that ticks one task is gated on that task alone', () => {
  const cwd = setupMixed();
  try {
    const res = handlePreToolUse(
      payload(cwd, 'fs_write', { path: TASKS_REL, text: TASKS_MIXED.replace(T3, tick(T3)) }),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(readReceipts(cwd)[0].required, ['R1.3 other passing contract']);
    assert.equal(readReceipts(cwd)[0].task.id, '3');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.14 a task that names several criteria requires the contracts of all of them', () => {
  const cwd = setupMixed();
  try {
    const res = handlePreToolUse(payload(cwd, 'str_replace', tickEdit(T4, tick(T4))));
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /Contracts failed: R1\.2 failing contract\./);
    assert.equal(readReceipts(cwd).length, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.5 a failing required contract blocks the tick and only required failures are listed', () => {
  const cwd = setupMixed();
  try {
    const res = handlePreToolUse(payload(cwd, 'str_replace', tickEdit(T2, tick(T2))));
    assert.equal(res.exitCode, 2);
    assert.equal(res.stderr, 'Contracts failed: R1.2 failing contract.');
    assert.equal(readReceipts(cwd).length, 0, 'no receipt on failure');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.14 a criterion matches a contract name only up to a space or the end of the name', () => {
  const cwd = tmpCwd();
  try {
    const contract = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1', () => { assert.ok(true); });
test('R1.10 not the same criterion', () => { assert.equal(1, 2); });
test('R1.12 also not', () => { assert.equal(1, 2); });
`;
    writeReq(cwd, 'demo', REQ);
    writeContract(cwd, 'demo', 'names.contract.test.js', contract);
    writeTasks(cwd, 'demo', '- [ ] 1. One (Req 1.1)\n- [ ] 2. Two (Req 1.10)\n');
    freezeSpec(cwd, 'demo');
    const res = handlePreToolUse(
      payload(cwd, 'str_replace', tickEdit('- [ ] 1. One (Req 1.1)', '- [x] 1. One (Req 1.1)')),
    );
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(readReceipts(cwd)[0].required, ['R1.1']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// -- R4.15: every case where the task's own criteria cannot be trusted ----------

function expectAllRequired(cwd, toolName, input) {
  const res = handlePreToolUse(payload(cwd, toolName, input));
  assert.equal(res.exitCode, 2, 'a failing contract elsewhere blocks the tick');
  assert.match(res.stderr, /Contracts failed: R1\.2 failing contract\./);
  assert.equal(readReceipts(cwd).length, 0);
}

test('R4.15 a task line edited to name different criteria requires every contract', () => {
  const cwd = setupMixed();
  try {
    // Task 2 is bound to Req 1.2 in the lock. The agent rewrites the line to name 1.1 while ticking it.
    const edited = '- [x] 2. Task two (Req 1.1)';
    expectAllRequired(cwd, 'str_replace', tickEdit(T2, edited));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.15 a task line that drops its criteria while being ticked requires every contract', () => {
  const cwd = setupMixed();
  try {
    expectAllRequired(cwd, 'str_replace', tickEdit(T2, '- [x] 2. Task two'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.15 a task line that adds a criterion while being ticked requires every contract', () => {
  const cwd = setupMixed();
  try {
    expectAllRequired(cwd, 'str_replace', tickEdit(T1, '- [x] 1. Task one (Req 1.1, 2.2)'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.15 the same edit with an fs_write is treated the same way', () => {
  const cwd = setupMixed();
  try {
    expectAllRequired(cwd, 'fs_write', { path: TASKS_REL, text: TASKS_MIXED.replace(T2, '- [x] 2. Task two (Req 1.1)') });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.15 a task id the lock does not know requires every contract', () => {
  const late = '- [ ] 9. Late task (Req 1.1)';
  const cwd = setupMixed(TASKS_MIXED, TASKS_MIXED + late + '\n');
  try {
    expectAllRequired(cwd, 'str_replace', tickEdit(late, tick(late)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.15 a task id that was renamed while being ticked requires every contract', () => {
  const cwd = setupMixed();
  try {
    expectAllRequired(cwd, 'str_replace', tickEdit(T1, '- [x] 77. Task one (Req 1.1)'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.15 a task for which the lock records no criteria requires every contract', () => {
  const cwd = setupMixed();
  try {
    expectAllRequired(cwd, 'str_replace', tickEdit(T5, tick(T5)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.15 a task whose criteria match no contract requires every contract', () => {
  const cwd = setupMixed();
  try {
    expectAllRequired(cwd, 'str_replace', tickEdit(T6, tick(T6)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.15 the last unticked task of the spec requires every contract', () => {
  const others = [tick(T2), tick(T3), tick(T4), tick(T5), tick(T6)];
  const cwd = setupMixed([T1, ...others, ''].join('\n'));
  try {
    expectAllRequired(cwd, 'str_replace', tickEdit(T1, tick(T1)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.15 a lock written before tasks were recorded requires every contract', () => {
  const cwd = setupMixed();
  try {
    const lockFile = path.join(cwd, '.necro', 'lock.json');
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    delete lock.specs.demo.tasks;
    fs.writeFileSync(lockFile, JSON.stringify(lock));
    expectAllRequired(cwd, 'str_replace', tickEdit(T1, tick(T1)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.15 a str_replace that does not apply to the file on disk requires every contract', () => {
  const cwd = setupMixed();
  try {
    expectAllRequired(cwd, 'str_replace', tickEdit('[ ] 1. Task one (Req 1.1) that is not on disk', '[x] 1. Task one (Req 1.1)'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.14 the criteria come from the lock: editing tasks.md on disk first does not change what is required', () => {
  const cwd = setupMixed();
  try {
    // The agent first rewrites the criteria of task 2 (an untick-neutral edit that ticks nothing), then ticks it.
    const rewritten = '- [ ] 2. Task two (Req 1.1)';
    const first = handlePreToolUse(payload(cwd, 'str_replace', tickEdit(T2, rewritten)));
    assert.equal(first.exitCode, 0, 'an edit that ticks nothing is not gated');
    fs.writeFileSync(tasksPath(cwd), TASKS_MIXED.replace(T2, rewritten));
    const second = handlePreToolUse(payload(cwd, 'str_replace', tickEdit(rewritten, tick(rewritten))));
    assert.equal(second.exitCode, 2);
    assert.match(second.stderr, /R1\.2 failing contract/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R4.14 + R6.1 a receipt written with a failing contract outside the required set verifies as CONFIRMED', () => {
  const cwd = setupMixed();
  try {
    assert.equal(handlePreToolUse(payload(cwd, 'str_replace', tickEdit(T1, tick(T1)))).exitCode, 0);
    const dir = path.join(cwd, '.necro', 'receipts', 'demo');
    const file = path.join(dir, fs.readdirSync(dir)[0]);
    const { code, out } = captureStdout(() => verify(cwd, file));
    assert.equal(code, 0, out);
    assert.match(out, /CONFIRMED/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// -- R3.7: a shell command ticks several tasks ---------------------------------

test('R3.7 a shell command that ticks one task is gated on that task alone and receipted', () => {
  const cwd = setupMixed();
  try {
    bashPre(cwd);
    fs.writeFileSync(tasksPath(cwd), TASKS_MIXED.replace(T1, tick(T1)));
    const res = handlePostToolUse(postPayload(cwd, 'sed -i ... tasks.md'));
    assert.equal(res.stderr, '');
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_MIXED.replace(T1, tick(T1)), 'the tick is kept');
    const [r] = readReceipts(cwd);
    assert.deepEqual(r.task, { id: '1', line: '1. Task one (Req 1.1)' });
    assert.deepEqual(r.required, ['R1.1 passing contract']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.7 a shell command that ticks several tasks requires the union of their criteria', () => {
  const cwd = setupMixed();
  try {
    bashPre(cwd);
    const ticked = TASKS_MIXED.replace(T1, tick(T1)).replace(T3, tick(T3));
    fs.writeFileSync(tasksPath(cwd), ticked);
    const res = handlePostToolUse(postPayload(cwd, 'sed -i ... tasks.md'));
    assert.equal(res.stderr, '');
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), ticked, 'both ticks are kept, R1.2 is not required');
    const [r] = readReceipts(cwd);
    assert.deepEqual(r.required, ['R1.1 passing contract', 'R1.3 other passing contract']);
    assert.equal(r.task.id, '1, 3');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.7 a shell command that ticks several tasks is undone when one of them requires a failing contract', () => {
  const cwd = setupMixed();
  try {
    bashPre(cwd);
    fs.writeFileSync(tasksPath(cwd), TASKS_MIXED.replace(T1, tick(T1)).replace(T2, tick(T2)));
    const res = handlePostToolUse(postPayload(cwd, 'sed -i ... tasks.md'));
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_MIXED, 'tasks.md is back to the recorded state');
    assert.match(res.stderr, /Contracts failed: R1\.2 failing contract\./);
    assert.ok(!res.stderr.includes('R1.1'), 'a passing required contract is not listed');
    assert.equal(readReceipts(cwd).length, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.7 + R4.15 a shell command that ticks a task and one the lock does not know requires every contract', () => {
  const late = '- [ ] 9. Late task (Req 1.1)';
  const cwd = setupMixed(TASKS_MIXED, TASKS_MIXED + late + '\n');
  try {
    bashPre(cwd);
    fs.writeFileSync(tasksPath(cwd), (TASKS_MIXED + late + '\n').replace(T1, tick(T1)).replace(late, tick(late)));
    const res = handlePostToolUse(postPayload(cwd, 'sed -i ... tasks.md'));
    assert.match(res.stderr, /Contracts failed: R1\.2 failing contract\./);
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_MIXED + late + '\n');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.7 + R4.15 a shell tick that edits the criteria on the task line requires every contract', () => {
  const cwd = setupMixed();
  try {
    bashPre(cwd);
    fs.writeFileSync(tasksPath(cwd), TASKS_MIXED.replace(T2, '- [x] 2. Task two (Req 1.1)'));
    const res = handlePostToolUse(postPayload(cwd, 'sed -i ... tasks.md'));
    assert.match(res.stderr, /Contracts failed: R1\.2 failing contract\./);
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), TASKS_MIXED);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R3.7 + R4.15 a shell tick of the last unticked task requires every contract', () => {
  const done = [tick(T2), tick(T3), tick(T4), tick(T5), tick(T6)];
  const cwd = setupMixed([T1, ...done, ''].join('\n'));
  try {
    bashPre(cwd);
    fs.writeFileSync(tasksPath(cwd), [tick(T1), ...done, ''].join('\n'));
    const res = handlePostToolUse(postPayload(cwd, 'sed -i ... tasks.md'));
    assert.match(res.stderr, /Contracts failed: R1\.2 failing contract\./);
    assert.equal(fs.readFileSync(tasksPath(cwd), 'utf8'), [T1, ...done, ''].join('\n'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
