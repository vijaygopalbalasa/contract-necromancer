// Contracts for Requirements 13.14 and 14.10 of the necro-core spec: the checks fail closed.
//
// R13.14: when the "frozen" globs of the locked runners.json are expanded again, a symbolic link met part way along a
// glob counts as an added file: a linked folder at an intermediate segment, and any link under `**`, whatever it points
// to (a folder, a file or nothing). Every runner file of the spec then fails with a reason that names the link, and the
// runner command never starts. A link that no glob could reach changes nothing.
//
// R14.10: when the Stop, PostTaskExec or audit code decides a task's verdict, a required contract that has no result in
// the run counts as failing, never as passing or absent. The Stop handler plans which contracts to run once and audits
// with the results of that run: a task that became ticked after it planned requires contracts that did not run, so it
// is "failing" and Stop puts it back to `[ ]`.
//
// This file carries its own helpers, so it does not depend on any file that is not frozen.
//
// The receipt pins the files this test exercises. Keep these lines, necro reads `from '...'` text:
//   from '../../src/runners.js'
//   from '../../src/contracts.js'
//   from '../../src/lock.js'
//   from '../../src/audit.js'
//   from '../../src/hooks.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runContracts } from '../../src/contracts.js';
import { freezeSpec, readLock } from '../../src/lock.js';
import { auditSpec } from '../../src/audit.js';
import { handlePreToolUse, handleStop } from '../../src/hooks.js';

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

// A fake test framework. It reads a contract file with one line per testcase ("pass <name>" or "fail <name>"), appends
// a line to a log file each time it is started, and writes a JUnit XML report to the path it is given.
const FAKE_RUNNER = `'use strict';
const fs = require('node:fs');
const [file, report, log] = process.argv.slice(2);
fs.appendFileSync(log, file + '\\n');
let cases = '';
for (const line of fs.readFileSync(file, 'utf8').split('\\n')) {
  if (line.trim() === '') continue;
  const space = line.indexOf(' ');
  const kind = line.slice(0, space);
  const name = line.slice(space + 1);
  cases += kind === 'pass'
    ? '<testcase classname="fake" name="' + name + '"/>'
    : '<testcase classname="fake" name="' + name + '"><failure message="failed">x</failure></testcase>';
}
fs.writeFileSync(report, '<?xml version="1.0"?><testsuites><testsuite name="fake">' + cases + '</testsuite></testsuites>');
`;

test('R13.14 a linked folder part way along a frozen glob, and any link under **, make every runner file fail with a reason naming the link, while a link no glob can reach changes nothing', () => {
  const aside = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-fail-closed-aside-'));
  const log = path.join(aside, 'started.log');
  const started = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0);
  const names = (results) => Object.fromEntries(results.map((r) => [r.name, r.result]));
  const PASS = { 'R1.1 right': 'pass', 'R1.2 also right': 'pass' };
  const FAIL = { 'R1.1 right': 'fail', 'R1.2 also right': 'fail' };

  // A fresh frozen project for each set of frozen globs.
  const build = (frozen) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-fail-closed-'));
    put(cwd, '.kiro/specs/demo/requirements.md', '# Demo\n');
    put(cwd, 'tools/fake-runner.cjs', FAKE_RUNNER);
    put(
      cwd,
      '.kiro/specs/demo/runners.json',
      JSON.stringify({
        '*_contract.fake': `"${process.execPath}" "${path.join(cwd, 'tools/fake-runner.cjs')}" {file} {report} ${log}`,
        frozen,
      }) + '\n',
    );
    put(cwd, 'contracts/demo/a_contract.fake', 'pass R1.1 right\n');
    put(cwd, 'contracts/demo/b_contract.fake', 'pass R1.2 also right\n');
    put(cwd, 'conf/real/settings.txt', 'settings\n');
    put(cwd, 'data/sub/file.txt', 'file\n');
    put(cwd, 'src/deep/conftest.txt', 'conftest\n');
    put(cwd, 'elsewhere/folder/planted.txt', 'a folder elsewhere\n');
    put(cwd, 'elsewhere/target.txt', 'a file elsewhere\n');
    freezeSpec(cwd, 'demo');
    return cwd;
  };

  // Each case: the frozen globs and the links that must be caught, as [path, kind of target]. A link at a path in
  // `replaces` takes the place of the real folder that was locked.
  const cases = [
    { frozen: ['conf/*/settings.txt'], links: [['conf/linked', 'folder'], ['conf/to-file', 'file'], ['conf/dangling', 'none']] },
    { frozen: ['data/sub/file.txt'], links: [['data/sub', 'folder']], replaces: ['data/sub'] },
    { frozen: ['**/conftest.txt'], links: [['src/deep/hidden', 'folder'], ['src/dangling', 'none'], ['top-link', 'file']] },
  ];
  const target = (cwd, kind) =>
    path.join(cwd, kind === 'folder' ? 'elsewhere/folder' : kind === 'file' ? 'elsewhere/target.txt' : 'elsewhere/does-not-exist');
  const plant = (cwd, rel, kind) => {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.symlinkSync(target(cwd, kind), path.join(cwd, rel));
  };

  try {
    for (const { frozen, links, replaces = [] } of cases) {
      for (const [rel, kind] of links) {
        const cwd = build(frozen);
        try {
          assert.deepEqual(names(runContracts(cwd, 'demo', readLock(cwd))), PASS, `${frozen}: nothing moved`);
          if (replaces.includes(rel)) fs.rmSync(path.join(cwd, rel), { recursive: true });
          plant(cwd, rel, kind);
          const before = started();
          const results = runContracts(cwd, 'demo', readLock(cwd));
          assert.deepEqual(names(results), FAIL, `${frozen}: ${rel}`);
          for (const r of results) assert.ok(r.reason.includes(rel), `${rel}: ${r.reason}`);
          assert.equal(started(), before, `${rel}: the fake framework did not start`);
          if (!replaces.includes(rel)) {
            fs.rmSync(path.join(cwd, rel));
            assert.deepEqual(names(runContracts(cwd, 'demo', readLock(cwd))), PASS, `${frozen}: ${rel} removed`);
          }
        } finally {
          fs.rmSync(cwd, { recursive: true, force: true });
        }
      }
    }

    // Links that no glob can reach change nothing.
    const cwd = build(['conf/*/settings.txt', 'data/sub/file.txt']);
    try {
      plant(cwd, 'conf/real/settings.md', 'file');
      plant(cwd, 'data/other', 'folder');
      plant(cwd, 'elsewhere/link', 'folder');
      assert.deepEqual(names(runContracts(cwd, 'demo', readLock(cwd))), PASS);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(aside, { recursive: true, force: true });
  }
});

// Two contract files and three tasks. R1.1 passes always. Task 3 names no contract, so it requires every contract.
const ALWAYS = (n) => `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('R${n}.1 holds ${n}', () => { assert.ok(true); });
`;

// The contract file of task 2 ticks task 3 while it runs, when a file tick-three exists.
const TICKS_THREE = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
if (fs.existsSync(new URL('../../tick-three', import.meta.url))) {
  const tasks = new URL('../../.kiro/specs/demo/tasks.md', import.meta.url);
  fs.writeFileSync(tasks, fs.readFileSync(tasks, 'utf8').replace('- [ ] 3.', '- [x] 3.'));
}
test('R2.1 holds 2', () => { assert.ok(true); });
`;

const TASKS_REL = '.kiro/specs/demo/tasks.md';
const T1 = '1. One (Req 1.1)';
const T2 = '2. Two (Req 2.1)';
const T3 = '3. Three (Req 3.1)';
const tasksText = (ticked) => [T1, T2, T3].map((t) => `- [${ticked.includes(t) ? 'x' : ' '}] ${t}`).join('\n') + '\n';

test('R14.10 a required contract with no result in the run counts as failing: in the audit, and in Stop, which audits with the results it planned', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-fail-closed-'));
  try {
    put(cwd, '.kiro/specs/demo/requirements.md', '# Demo\n');
    put(cwd, 'contracts/demo/a.contract.test.js', ALWAYS(1));
    put(cwd, 'contracts/demo/b.contract.test.js', TICKS_THREE);
    put(cwd, TASKS_REL, tasksText([T1]));
    freezeSpec(cwd, 'demo');
    const lock = readLock(cwd);

    // The gate lets task 2 through and writes its receipt.
    const gate = handlePreToolUse({
      hook_event_name: 'PreToolUse',
      cwd,
      tool_name: 'task_update',
      tool_input: { tasksFilePath: TASKS_REL, taskId: T2, status: 'completed' },
    });
    assert.equal(gate.exitCode, 0, gate.stderr);
    put(cwd, TASKS_REL, tasksText([T1, T2]));

    // The audit: the results hold R1.1 only, so R2.1 did not run. Task 2 is failing, with the full run and with only the new tasks.
    const partial = runContracts(cwd, 'demo', lock, new Set(['contracts/demo/a.contract.test.js']));
    assert.deepEqual(partial.map((r) => r.name), ['R1.1 holds 1']);
    for (const onlyNew of [false, true]) {
      const two = auditSpec(cwd, 'demo', lock, partial, { onlyNew }).tasks.find((t) => t.id === '2');
      assert.equal(two.verdict, 'failing', `onlyNew ${onlyNew}`);
      assert.deepEqual(two.failing, ['R2.1 holds 2']);
    }
    // With its results complete, the same task is ok.
    assert.equal(auditSpec(cwd, 'demo', lock, runContracts(cwd, 'demo', lock), { onlyNew: true }).tasks[0].verdict, 'ok');

    // A required contract file removed after the audit was planned.
    fs.copyFileSync(path.join(cwd, 'contracts/demo/b.contract.test.js'), path.join(cwd, 'b.copy'));
    fs.rmSync(path.join(cwd, 'contracts/demo/b.contract.test.js'));
    const removed = auditSpec(cwd, 'demo', lock, null, { onlyNew: true }).tasks[0];
    assert.equal(removed.verdict, 'failing');
    assert.deepEqual(removed.failing, ['R2.1 holds 2']);
    fs.copyFileSync(path.join(cwd, 'b.copy'), path.join(cwd, 'contracts/demo/b.contract.test.js'));

    // Stop plans a run of the contract file of task 2 only. That run ticks task 3, which requires every contract,
    // and the contracts of task 1 did not run: Stop audits with the results it has, finds task 3 failing, and unticks it.
    put(cwd, 'tick-three', '');
    const stop = handleStop({ hook_event_name: 'Stop', cwd });
    assert.equal(stop.exitCode, 0, stop.stderr);
    assert.equal(fs.readFileSync(path.join(cwd, TASKS_REL), 'utf8'), tasksText([T1, T2]), 'task 3 is unticked, task 2 stays');
    assert.match(stop.stderr, /Unticked "3\. Three \(Req 3\.1\)"/);
    assert.match(stop.stderr, /required contracts fail now: R1\.1 holds 1/);
    assert.doesNotMatch(stop.stderr, /no receipt/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
