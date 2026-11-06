// Contracts for Requirement 3 (block edits to frozen files): what happens around shell commands and writes to tasks.md.
// R3.3, R3.7, R3.8, R3.9, R3.10, R3.12, R3.13. The PreToolUse blocks are in block.contract.test.js.
//
// A shell command cannot be stopped in advance, so the hooks check afterwards: PreToolUse records tasks.md,
// PostToolUse restores frozen files and undoes ticks the contracts do not support. Each test plays the hooks in order
// with `necro hook pre` / `necro hook post` and changes files in between, as the shell command would.
// This file carries its own helpers.
//
// The receipt pins the files the hooks use. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/hooks.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function necro(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv() });
}

function hook(cwd, kind, toolName, toolInput) {
  const event = { pre: 'PreToolUse', post: 'PostToolUse' }[kind];
  const payload = { session_id: 's-contract', hook_event_name: event, cwd, tool_name: toolName, tool_input: toolInput };
  return necro(cwd, ['hook', kind], JSON.stringify(payload));
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-shell-'));
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function read(cwd, rel) {
  return fs.readFileSync(path.join(cwd, rel), 'utf8');
}

function freeze(cwd, spec = 'demo') {
  const res = necro(cwd, ['freeze', spec]);
  assert.equal(res.status, 0, `freeze failed: ${res.stderr}${res.stdout}`);
}

function receiptFiles(cwd, spec = 'demo') {
  const dir = path.join(cwd, '.necro', 'receipts', spec);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}

const REQ_REL = '.kiro/specs/demo/requirements.md';
const CONTRACT_REL = 'contracts/demo/c.contract.test.js';
const TASKS_REL = '.kiro/specs/demo/tasks.md';

const PASSING = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.1 passing contract', () => { assert.ok(true); });
`;

const FAILING = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R1.2 failing contract', () => { assert.equal(1, 2); });
`;

// Tasks with no "(Req ...)" criteria, so ticking one requires every contract.
const TASKS_TWO = '- [ ] 1. Task one\n- [ ] 2. Task two\n';
const TICKED_ONE = '- [x] 1. Task one\n- [ ] 2. Task two\n';

// A frozen spec "demo" with the given contract and tasks.md.
function frozen(cwd, contract, tasks = TASKS_TWO, spec = 'demo') {
  put(cwd, `.kiro/specs/${spec}/requirements.md`, `# Requirements: ${spec}\n`);
  put(cwd, `contracts/${spec}/c.contract.test.js`, contract);
  put(cwd, `.kiro/specs/${spec}/tasks.md`, tasks);
  freeze(cwd, spec);
}

const SHELL = { command: 'sed -i s/a/b/ somefile' };

test('R3.3 after a shell command, a frozen file whose SHA-256 changed is restored and named on stderr', () =>
  temp((cwd) => {
    frozen(cwd, PASSING);
    const contract = read(cwd, CONTRACT_REL);
    const requirements = read(cwd, REQ_REL);

    // One file edited, one deleted.
    fs.writeFileSync(path.join(cwd, CONTRACT_REL), `${contract}\n// edited by a command\n`);
    fs.rmSync(path.join(cwd, REQ_REL));

    const res = hook(cwd, 'post', 'execute_bash', SHELL);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(cwd, CONTRACT_REL), contract, 'the edited contract is back');
    assert.equal(read(cwd, REQ_REL), requirements, 'the deleted requirements file is back');
    assert.ok(res.stderr.includes(CONTRACT_REL), `names the restored contract: ${res.stderr}`);
    assert.ok(res.stderr.includes(REQ_REL), `names the restored requirements file: ${res.stderr}`);
    assert.match(res.stderr, /[Rr]estored/);
  }));

test('R3.7 a shell command that ticks a task is checked, and undone with the failing names on stderr if a contract fails', () => {
  // Failing contract: the tick is undone and the failing contract is named.
  temp((cwd) => {
    frozen(cwd, FAILING);
    assert.equal(hook(cwd, 'pre', 'execute_bash', SHELL).status, 0);
    put(cwd, TASKS_REL, TICKED_ONE); // what `sed -i` did
    const res = hook(cwd, 'post', 'execute_bash', SHELL);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(read(cwd, TASKS_REL), TASKS_TWO, 'tasks.md is back to the recorded state');
    assert.ok(res.stderr.includes('R1.2 failing contract'), `names the failing contract: ${res.stderr}`);
    assert.deepEqual(receiptFiles(cwd), [], 'no receipt for a refused tick');
  });

  // Passing contract: the tick stays and a receipt is written.
  temp((cwd) => {
    frozen(cwd, PASSING);
    hook(cwd, 'pre', 'execute_bash', SHELL);
    put(cwd, TASKS_REL, TICKED_ONE);
    const res = hook(cwd, 'post', 'execute_bash', SHELL);
    assert.equal(res.status, 0);
    assert.equal(res.stderr, '');
    assert.equal(read(cwd, TASKS_REL), TICKED_ONE);
    assert.equal(receiptFiles(cwd).length, 1, 'a receipt is written for the tick');
  });

  // Only a change from [ ] to [x] is checked: unticking is left alone.
  temp((cwd) => {
    frozen(cwd, FAILING, TICKED_ONE);
    hook(cwd, 'pre', 'execute_bash', SHELL);
    put(cwd, TASKS_REL, TASKS_TWO);
    const res = hook(cwd, 'post', 'execute_bash', SHELL);
    assert.equal(res.stderr, '');
    assert.equal(read(cwd, TASKS_REL), TASKS_TWO);
  });
});

test('R3.8 before each shell call the current tasks.md of every frozen spec is recorded, replacing any earlier record', () =>
  temp((cwd) => {
    frozen(cwd, FAILING, TASKS_TWO, 'demo');
    frozen(cwd, FAILING, TASKS_TWO, 'second');

    // The record is replaced: a task ticked between two shell calls (say, by a person in the editor) is part of
    // the second record, so a command that changes nothing is not blamed for it.
    assert.equal(hook(cwd, 'pre', 'execute_bash', SHELL).status, 0);
    put(cwd, TASKS_REL, TICKED_ONE);
    assert.equal(hook(cwd, 'pre', 'execute_bash', SHELL).status, 0);
    const quiet = hook(cwd, 'post', 'execute_bash', SHELL);
    assert.equal(quiet.stderr, '', 'the second record includes the tick');
    assert.equal(read(cwd, TASKS_REL), TICKED_ONE);

    // Every frozen spec is recorded, not only one: ticks in both are undone.
    put(cwd, TASKS_REL, TASKS_TWO);
    hook(cwd, 'pre', 'execute_bash', SHELL);
    put(cwd, TASKS_REL, TICKED_ONE);
    put(cwd, '.kiro/specs/second/tasks.md', TICKED_ONE);
    const res = hook(cwd, 'post', 'execute_bash', SHELL);
    assert.equal(read(cwd, TASKS_REL), TASKS_TWO);
    assert.equal(read(cwd, '.kiro/specs/second/tasks.md'), TASKS_TWO);
    assert.ok(res.stderr.includes(TASKS_REL), res.stderr);
    assert.ok(res.stderr.includes('.kiro/specs/second/tasks.md'), res.stderr);
  }));

test('R3.9 when the recorded state changed during the command, every [x] task line counts as newly ticked', () => {
  const stateFile = '.necro/state/demo.tasks.md';

  // The command rewrites the record. A tick that was already there before is checked again.
  temp((cwd) => {
    frozen(cwd, FAILING, TICKED_ONE);
    assert.equal(hook(cwd, 'pre', 'execute_bash', SHELL).status, 0);
    assert.ok(fs.existsSync(path.join(cwd, stateFile)), 'the state is recorded before the command');
    fs.appendFileSync(path.join(cwd, stateFile), '\n');
    const res = hook(cwd, 'post', 'execute_bash', { command: `echo >> ${stateFile}` });
    assert.ok(res.stderr.includes('R1.2 failing contract'), `the old tick is checked again: ${res.stderr}`);
    assert.equal(read(cwd, TASKS_REL), TASKS_TWO);
  });

  // The command forges the record to match a new tick.
  temp((cwd) => {
    frozen(cwd, FAILING);
    hook(cwd, 'pre', 'execute_bash', SHELL);
    put(cwd, TASKS_REL, TICKED_ONE);
    put(cwd, stateFile, TICKED_ONE);
    const res = hook(cwd, 'post', 'execute_bash', { command: `cp tasks.md ${stateFile}` });
    assert.ok(res.stderr.includes('R1.2 failing contract'), res.stderr);
    assert.equal(read(cwd, TASKS_REL), TASKS_TWO);
    assert.deepEqual(receiptFiles(cwd), []);
  });

  // The command deletes the record.
  temp((cwd) => {
    frozen(cwd, FAILING, TICKED_ONE);
    hook(cwd, 'pre', 'execute_bash', SHELL);
    fs.rmSync(path.join(cwd, '.necro', 'state'), { recursive: true, force: true });
    const res = hook(cwd, 'post', 'execute_bash', { command: 'rm -r .necro/state' });
    assert.ok(res.stderr.includes('R1.2 failing contract'), res.stderr);
    assert.equal(read(cwd, TASKS_REL), TASKS_TWO);
  });
});

test('R3.10 a write to tasks.md is recorded by PostToolUse from the file on disk, not before the write', () =>
  temp((cwd) => {
    // A person ticked task 1 in the editor earlier; no shell call has recorded anything yet.
    frozen(cwd, FAILING, TICKED_ONE);

    // The write the hook was shown ticks nothing, so PreToolUse lets it through.
    const edit = { path: TASKS_REL, text: TASKS_TWO };
    const pre = hook(cwd, 'pre', 'fs_write', edit);
    assert.equal(pre.status, 0, pre.stderr);

    // What really landed on disk differs from what the hook was shown.
    put(cwd, TASKS_REL, TICKED_ONE);
    const post = hook(cwd, 'post', 'fs_write', edit);
    assert.equal(post.status, 0, post.stderr);
    assert.equal(post.stderr, '');

    // The next shell command changes nothing. The record is the file as it landed, so nothing is undone.
    const shell = hook(cwd, 'post', 'execute_bash', SHELL);
    assert.equal(shell.stderr, '', 'the record came from the file on disk');
    assert.equal(read(cwd, TASKS_REL), TICKED_ONE);
  }));

test('R3.12 every Kiro shell tool gets the execute_bash treatment', () => {
  const calls = [
    ['execute_bash', { command: 'sed -i s/a/b/ somefile' }],
    ['execute_pwsh', { command: '(Get-Content somefile) -replace "a","b" | Set-Content somefile' }],
    ['control_bash_process', { action: 'input', processId: '7', command: 'sed -i s/a/b/ somefile' }],
    ['control_pwsh_process', { action: 'input', processId: '7', command: 'Set-Content somefile x' }],
  ];
  for (const [tool, input] of calls) {
    temp((cwd) => {
      frozen(cwd, FAILING);
      const contract = read(cwd, CONTRACT_REL);

      // PreToolUse records the state, and a long command is not a path, so it is allowed.
      const pre = hook(cwd, 'pre', tool, { ...input, command: `${input.command} ${'x'.repeat(5000)}` });
      assert.equal(pre.status, 0, `${tool}: ${pre.stderr}`);
      assert.equal(pre.stderr, '', tool);

      // The command edits a frozen file and ticks a task.
      fs.writeFileSync(path.join(cwd, CONTRACT_REL), `${contract}// edited\n`);
      put(cwd, TASKS_REL, TICKED_ONE);

      const post = hook(cwd, 'post', tool, input);
      assert.equal(post.status, 0, `${tool}: ${post.stderr}`);
      assert.equal(read(cwd, CONTRACT_REL), contract, `${tool}: the frozen file is restored`);
      assert.ok(post.stderr.includes(CONTRACT_REL), `${tool}: names the restored file: ${post.stderr}`);
      assert.equal(read(cwd, TASKS_REL), TASKS_TWO, `${tool}: the tick is undone`);
      assert.ok(post.stderr.includes('R1.2 failing contract'), `${tool}: names the failing contract: ${post.stderr}`);
    });
  }
});

test('R3.13 fs_append and delete_file on tasks.md are writes to tasks.md for the done gate', () => {
  // fs_append that adds a ticked task line runs the gate.
  temp((cwd) => {
    frozen(cwd, FAILING);
    const res = hook(cwd, 'pre', 'fs_append', { path: TASKS_REL, text: '- [x] 3. Task three\n' });
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /Contracts failed: R1\.2 failing contract\./);

    // Without a final newline on disk, the appended line still starts a new line.
    put(cwd, TASKS_REL, '- [ ] 1. Task one');
    const noNewline = hook(cwd, 'pre', 'fs_append', { path: TASKS_REL, text: '- [x] 2. Task two\n' });
    assert.equal(noNewline.status, 2, noNewline.stderr);

    // An append that ticks nothing is not gated, whatever it holds.
    put(cwd, TASKS_REL, TASKS_TWO);
    for (const text of ['- [ ] 3. Task three\n', 'Notes\n', 'a\u0000b']) {
      const quiet = hook(cwd, 'pre', 'fs_append', { path: TASKS_REL, text });
      assert.equal(quiet.status, 0, quiet.stderr);
      assert.equal(quiet.stderr, '');
    }

    // delete_file on tasks.md ticks nothing; writing a ticked file back afterwards is still gated.
    const del = { explanation: 'remove tasks', targetFile: TASKS_REL };
    assert.equal(hook(cwd, 'pre', 'delete_file', del).status, 0);
    fs.rmSync(path.join(cwd, TASKS_REL));
    assert.equal(hook(cwd, 'post', 'delete_file', del).status, 0);
    const again = hook(cwd, 'pre', 'fs_write', { path: TASKS_REL, text: '- [x] 1. Task one\n' });
    assert.equal(again.status, 2, again.stderr);
    assert.match(again.stderr, /Contracts failed: R1\.2 failing contract\./);
  });

  // With passing contracts the appended tick is allowed and receipted.
  temp((cwd) => {
    frozen(cwd, PASSING);
    const res = hook(cwd, 'pre', 'fs_append', { path: TASKS_REL, text: '- [x] 3. Task three\n' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(receiptFiles(cwd).length, 1);
  });

  // PostToolUse records tasks.md after fs_append lands, so a later shell command is compared with it.
  temp((cwd) => {
    frozen(cwd, FAILING, TICKED_ONE);
    const edit = { path: TASKS_REL, text: '- [ ] 3. Task three\n' };
    assert.equal(hook(cwd, 'pre', 'fs_append', edit).status, 0);
    fs.appendFileSync(path.join(cwd, TASKS_REL), edit.text);
    assert.equal(hook(cwd, 'post', 'fs_append', edit).status, 0);
    const shell = hook(cwd, 'post', 'execute_bash', SHELL);
    assert.equal(shell.stderr, '', 'the record is the file as the append left it');
    assert.equal(read(cwd, TASKS_REL), `${TICKED_ONE}${edit.text}`);
  });
});
