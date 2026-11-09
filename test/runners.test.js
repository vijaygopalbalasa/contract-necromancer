import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashFile } from '../src/canon.js';
import { runContracts } from '../src/contracts.js';
import { freezeSpec, readLock, isFrozenPath, frozenFiles, getExpectedHash } from '../src/lock.js';
import { runCheck, checkSpec } from '../src/check.js';
import { verify } from '../src/verify.js';
import { computeReceiptHash } from '../src/receipts.js';
import { handlePreToolUse, handlePostToolUse } from '../src/hooks.js';
import { spawnSync } from 'node:child_process';
import { parseRunners, readRunners, matchesPattern, splitCommand, findRunner, expandGlobs, runnerTimeLimitMs, RUNNER_TIME_LIMIT_MS, REDIRECT_VARS, withoutRedirects } from '../src/runners.js';

const FAKE = path.join(import.meta.dirname, 'fixtures', 'fake-runner.js');
const SPEC = 'demo';
const RUNNERS_REL = '.kiro/specs/demo/runners.json';
const COMMAND = `"${process.execPath}" "${FAKE}" {file} {report}`;

function tmpCwd(prefix = 'necro-runners-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function runnersJson(command = COMMAND, pattern = '*_contract.fake', extra = {}) {
  return JSON.stringify({ [pattern]: command, ...extra }, null, 2) + '\n';
}

// A project whose spec has fake-framework contracts. `files` maps a file name in
// contracts/demo to its lines.
function project(files, { runners = runnersJson(), tasks, cwd = tmpCwd() } = {}) {
  put(cwd, '.kiro/specs/demo/requirements.md', '# Demo\n');
  if (runners !== null) put(cwd, RUNNERS_REL, runners);
  for (const [name, text] of Object.entries(files)) put(cwd, `contracts/demo/${name}`, text);
  if (tasks) put(cwd, '.kiro/specs/demo/tasks.md', tasks);
  return cwd;
}

function done(cwd) {
  fs.rmSync(cwd, { recursive: true, force: true });
}

function withLog(fn) {
  const log = path.join(tmpCwd('necro-runners-log-'), 'calls.log');
  process.env.FAKE_RUNNER_LOG = log;
  try {
    return fn(log);
  } finally {
    delete process.env.FAKE_RUNNER_LOG;
    fs.rmSync(path.dirname(log), { recursive: true, force: true });
  }
}

function calls(log) {
  return fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
}

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

function pre(cwd, toolName, toolInput) {
  return handlePreToolUse({ session_id: 's', hook_event_name: 'PreToolUse', cwd, tool_name: toolName, tool_input: toolInput });
}

function post(cwd, toolName, toolInput = {}) {
  return handlePostToolUse({ session_id: 's', hook_event_name: 'PostToolUse', cwd, tool_name: toolName, tool_input: toolInput });
}

const byName = (results) => Object.fromEntries(results.map((r) => [r.name, r.result]));

// ---------------------------------------------------------------------------
// src/runners.js: reading runners.json
// ---------------------------------------------------------------------------

test('R13.1 parseRunners reads a pattern to command object, in file order', () => {
  const patterns = parseRunners('{"test_*_contract.py": "python3 -m pytest {file} --junitxml={report} -q", "*.t": "x {file} {report}"}');
  assert.deepEqual(patterns, [
    { pattern: 'test_*_contract.py', command: 'python3 -m pytest {file} --junitxml={report} -q' },
    { pattern: '*.t', command: 'x {file} {report}' },
  ]);
});

test('R13.1 parseRunners refuses what is not a pattern to command object, in plain words', () => {
  const bad = [
    '',
    'not json',
    '[]',
    'null',
    '"x"',
    '{"*.py": 1}',
    '{"*.py": ""}',
    '{"*.py": "   "}',
    '{"": "x {file} {report}"}',
    '{"sub/*.py": "x {file} {report}"}',
    '{"../*.py": "x {file} {report}"}',
    '{"*.py": "\\"unclosed {file}"}',
  ];
  for (const text of bad) {
    assert.throws(() => parseRunners(text), (e) => e instanceof Error && /runners\.json/.test(e.message), text);
  }
});

test('R13.1 matchesPattern supports * and ? within a file name and nothing else', () => {
  assert.ok(matchesPattern('test_*_contract.py', 'test_split_contract.py'));
  assert.ok(matchesPattern('test_*_contract.py', 'test__contract.py'));
  assert.ok(!matchesPattern('test_*_contract.py', 'test_split_contract.pyc'));
  assert.ok(!matchesPattern('test_*_contract.py', 'xtest_split_contract.py'));
  assert.ok(matchesPattern('a?.go', 'ab.go'));
  assert.ok(!matchesPattern('a?.go', 'a.go'));
  assert.ok(!matchesPattern('*.go', 'dir/a.go'), '* does not cross a folder');
  assert.ok(matchesPattern('a.b(c)+[d]{e}^$|.t', 'a.b(c)+[d]{e}^$|.t'), 'other characters are literal');
  assert.ok(!matchesPattern('a.t', 'aXt'), '. is a dot');
  assert.ok(!matchesPattern('[ab].t', 'a.t'), 'no character classes');
});

test('R13.2 splitCommand splits on spaces and keeps quoted words whole, with no shell syntax', () => {
  assert.deepEqual(splitCommand('python3 -m pytest {file} --junitxml={report} -q'), ['python3', '-m', 'pytest', '{file}', '--junitxml={report}', '-q']);
  assert.deepEqual(splitCommand('  a   b  '), ['a', 'b']);
  assert.deepEqual(splitCommand('"/p with space/node" \'x y\' z'), ['/p with space/node', 'x y', 'z']);
  assert.deepEqual(splitCommand('a "" b'), ['a', '', 'b']);
  assert.deepEqual(splitCommand('a&&b ; c | d $(x) `y` > z'), ['a&&b', ';', 'c', '|', 'd', '$(x)', '`y`', '>', 'z'], 'shell operators are plain words');
  assert.deepEqual(splitCommand('--opt="a b"'), ['--opt=a b']);
  assert.throws(() => splitCommand('a "b'), Error);
});

test('R13.1 findRunner returns the command of the first pattern that matches, or null', () => {
  const patterns = parseRunners('{"a_*.x": "first", "*.x": "second"}');
  assert.equal(findRunner(patterns, 'a_1.x'), 'first');
  assert.equal(findRunner(patterns, 'b_1.x'), 'second');
  assert.equal(findRunner(patterns, 'b_1.y'), null);
});

test('R13.1 readRunners is null when the spec has no runners.json, and pins the file when it has one', () => {
  const cwd = project({}, { runners: null });
  try {
    assert.equal(readRunners(cwd, SPEC), null);
    put(cwd, RUNNERS_REL, runnersJson());
    const r = readRunners(cwd, SPEC);
    assert.equal(r.path, RUNNERS_REL);
    assert.equal(r.sha256, hashFile(path.join(cwd, RUNNERS_REL)));
    assert.equal(r.patterns.length, 1);
    put(cwd, RUNNERS_REL, 'nope');
    assert.throws(() => readRunners(cwd, SPEC), /runners\.json/);
  } finally {
    done(cwd);
  }
});

// ---------------------------------------------------------------------------
// 13.1: matching files are contract files in freeze, check, the gate and verify
// ---------------------------------------------------------------------------

test('R13.1 freeze treats files matching a pattern as contract files, alongside *.contract.test.js', () => {
  const cwd = project({
    'a_contract.fake': 'pass R1.1 first\nfail R1.2 second\n',
    'b_contract.fake': 'pass R2.1 other\n',
    'notes.txt': 'pass R9.9 not a contract\n',
    'js.contract.test.js': "import { test } from 'node:test';\ntest('R3.1 js contract', () => {});\n",
  });
  try {
    freezeSpec(cwd, SPEC);
    const entry = readLock(cwd).specs[SPEC];
    assert.deepEqual(
      entry.contracts.map((c) => c.path).sort(),
      ['contracts/demo/a_contract.fake', 'contracts/demo/b_contract.fake', 'contracts/demo/js.contract.test.js'],
    );
    const names = Object.fromEntries(entry.contracts.map((c) => [c.path, c.names]));
    assert.deepEqual(names['contracts/demo/a_contract.fake'], ['R1.1 first', 'R1.2 second']);
    assert.deepEqual(names['contracts/demo/b_contract.fake'], ['R2.1 other']);
    assert.deepEqual(names['contracts/demo/js.contract.test.js'], ['R3.1 js contract']);
    for (const c of entry.contracts) assert.equal(c.sha256, hashFile(path.join(cwd, c.path)));
  } finally {
    done(cwd);
  }
});

test('R13.1 a spec whose only contract files are runner files can be frozen, and one with none is refused', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    assert.equal(readLock(cwd).specs[SPEC].contracts.length, 1);
  } finally {
    done(cwd);
  }
  const empty = project({ 'notes.txt': 'x\n' });
  try {
    assert.throws(() => freezeSpec(empty, SPEC), /at least one/);
  } finally {
    done(empty);
  }
});

test('R13.1 files matching no pattern are not contract files, and a runners.json that cannot be read refuses the freeze', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n', 'b.other': 'pass R1.2 y\n' });
  try {
    freezeSpec(cwd, SPEC);
    assert.deepEqual(readLock(cwd).specs[SPEC].contracts.map((c) => c.path), ['contracts/demo/a_contract.fake']);
    put(cwd, RUNNERS_REL, '{ not json');
    assert.throws(() => freezeSpec(cwd, SPEC), /runners\.json/);
  } finally {
    done(cwd);
  }
});

test('R13.1 a pattern that matches a *.contract.test.js file does not take it from node:test', () => {
  const js = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('R1.1 js', () => assert.ok(true));\n";
  const cwd = project({ 'a.contract.test.js': js }, { runners: runnersJson(COMMAND, '*') });
  try {
    freezeSpec(cwd, SPEC);
    const results = runContracts(cwd, SPEC, readLock(cwd));
    assert.deepEqual(results.map((r) => [r.name, r.result]), [['R1.1 js', 'pass']]);
  } finally {
    done(cwd);
  }
});

test('R13.1 check runs the contracts of runner files and writes a receipt that names them', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 first\nfail R1.2 second\n' });
  try {
    freezeSpec(cwd, SPEC);
    const { frozen, results, receipt } = runCheck(cwd, SPEC);
    assert.equal(frozen, true);
    assert.deepEqual(byName(results), { 'R1.1 first': 'pass', 'R1.2 second': 'fail' });
    const written = JSON.parse(fs.readFileSync(path.join(cwd, receipt), 'utf8'));
    assert.deepEqual(written.contracts.map((c) => [c.path, c.name, c.result]), [
      ['contracts/demo/a_contract.fake', 'R1.1 first', 'pass'],
      ['contracts/demo/a_contract.fake', 'R1.2 second', 'fail'],
    ]);
    const printed = checkSpec(cwd, SPEC);
    assert.equal(printed.exitCode, 1);
    assert.match(printed.stdout, /pass R1\.1 first/);
    assert.match(printed.stdout, /fail R1\.2 second/);
  } finally {
    done(cwd);
  }
});

test('R13.1 verify re-runs runner files from the lock and prints CONFIRMED, then MISMATCH when a contract file changes', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 first\npass R1.2 second\n' });
  try {
    freezeSpec(cwd, SPEC);
    const { receipt } = runCheck(cwd, SPEC);
    const ok = captureStdout(() => verify(cwd, receipt));
    assert.equal(ok.code, 0);
    assert.match(ok.out, /CONFIRMED/);

    put(cwd, 'contracts/demo/a_contract.fake', 'pass R1.1 first\nfail R1.2 second\n');
    const bad = captureStdout(() => verify(cwd, receipt));
    assert.equal(bad.code, 1);
    assert.match(bad.out, /MISMATCH/);
    assert.match(bad.out, /a_contract\.fake/);
  } finally {
    done(cwd);
  }
});

// ---------------------------------------------------------------------------
// 13.2: how a runner file runs, and where results come from
// ---------------------------------------------------------------------------

test('R13.2 results come only from the report: a printed fake pass cannot rescue a failing report', () => {
  const cwd = project({
    'a_contract.fake': '@print ok 1 - R1.1 first\n@print # pass 1\n@print R1.1 first PASSED\nfail R1.1 first\n',
  });
  try {
    freezeSpec(cwd, SPEC);
    assert.deepEqual(byName(runContracts(cwd, SPEC, readLock(cwd))), { 'R1.1 first': 'fail' });
  } finally {
    done(cwd);
  }
});

test('R13.2 a failure, an error and a skipped testcase do not pass, and a clean testcase does', () => {
  const cwd = project({
    'a_contract.fake': 'pass R1.1 clean\nfail R1.2 failure\nerror R1.3 error\nskip R1.4 skipped\n',
  });
  try {
    freezeSpec(cwd, SPEC);
    assert.deepEqual(byName(runContracts(cwd, SPEC, readLock(cwd))), {
      'R1.1 clean': 'pass',
      'R1.2 failure': 'fail',
      'R1.3 error': 'fail',
      'R1.4 skipped': 'fail',
    });
  } finally {
    done(cwd);
  }
});

test('R13.7 a non-zero exit fails the file even when the report says every testcase passed', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\nfail R1.2 y\n@exit 1\n', 'b_contract.fake': 'pass R2.1 z\n@exit 3\n' });
  try {
    freezeSpec(cwd, SPEC);
    const results = runContracts(cwd, SPEC, readLock(cwd));
    assert.deepEqual(byName(results), { 'R1.1 x': 'fail', 'R1.2 y': 'fail', 'R2.1 z': 'fail' }, 'names are kept, none passes');
    const reasonOf = (name) => results.find((r) => r.name === name).reason;
    assert.match(reasonOf('R1.1 x'), /a_contract\.fake/);
    assert.match(reasonOf('R1.1 x'), /status 1\b/);
    assert.match(reasonOf('R2.1 z'), /status 3\b/);
  } finally {
    done(cwd);
  }
});

test('R13.7 a non-zero exit with no readable report is one failing contract named after the file, with the status', () => {
  const cwd = project({ 'a_contract.fake': '@no-report\n@exit 2\n' });
  try {
    freezeSpec(cwd, SPEC);
    const results = runContracts(cwd, SPEC, readLock(cwd));
    assert.equal(results.length, 1);
    assert.equal(results[0].result, 'fail');
    assert.ok(results[0].name.includes('a_contract.fake'));
    assert.match(results[0].reason, /status 2\b/);
  } finally {
    done(cwd);
  }
});

test('R13.7 a report rewritten to all-pass by another process cannot rescue a run that exited non-zero', () => {
  // The real run fails (exit 1); the report on disk says everything passed, as a background process would leave it.
  const cwd = project({ 'a_contract.fake': 'pass R1.1 add\n@exit 1\n' });
  try {
    freezeSpec(cwd, SPEC);
    assert.deepEqual(byName(runContracts(cwd, SPEC, readLock(cwd))), { 'R1.1 add': 'fail' });
  } finally {
    done(cwd);
  }
});

test('R13.2 {file} is the contract file and {report} is a new path in a fresh temporary folder, new each run', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    withLog((log) => {
      freezeSpec(cwd, SPEC);
      runContracts(cwd, SPEC, readLock(cwd));
      const seen = calls(log);
      assert.equal(seen.length, 2);
      for (const c of seen) {
        assert.equal(fs.realpathSync(c.file), fs.realpathSync(path.join(cwd, 'contracts/demo/a_contract.fake')));
        assert.equal(fs.realpathSync(c.cwd), fs.realpathSync(cwd), 'the command runs in the project');
        assert.ok(path.isAbsolute(c.report));
        assert.ok(path.dirname(c.report).startsWith(os.tmpdir()), `the report is under the temporary folder: ${c.report}`);
        assert.ok(path.relative(cwd, c.report).startsWith('..'), 'the report is not inside the project');
        assert.ok(!fs.existsSync(c.report), 'the report is removed after the run');
        assert.ok(!fs.existsSync(path.dirname(c.report)), 'the temporary folder is removed after the run');
      }
      assert.notEqual(seen[0].report, seen[1].report);
      assert.notEqual(path.dirname(seen[0].report), path.dirname(seen[1].report));
    });
  } finally {
    done(cwd);
  }
});

test('R13.2 the command runs without a shell: operators, substitutions and redirections are plain arguments', () => {
  const marker = path.join(tmpCwd('necro-runners-marker-'), 'pwned');
  const command = `"${process.execPath}" "${FAKE}" {file} {report} ; touch ${marker} && echo hi > ${marker} $(touch ${marker}) \`touch ${marker}\` | cat`;
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' }, { runners: runnersJson(command) });
  try {
    withLog((log) => {
      freezeSpec(cwd, SPEC);
      assert.deepEqual(byName(runContracts(cwd, SPEC, readLock(cwd))), { 'R1.1 x': 'pass' });
      const argv = calls(log)[0].argv;
      assert.equal(argv[2], ';', 'the operator reaches the program as an argument');
      assert.ok(argv.includes('&&') && argv.includes('|') && argv.includes('>'));
    });
    assert.ok(!fs.existsSync(marker), 'no shell ran the rest of the line');
  } finally {
    done(cwd);
    fs.rmSync(path.dirname(marker), { recursive: true, force: true });
  }
});

test('R13.2 a project folder with a space and a contract name with shell characters stay one argument each', () => {
  const cwd = project({ "we ird;'name_contract.fake": 'pass R1.1 x\n' }, { cwd: tmpCwd('necro runners space ') });
  try {
    withLog((log) => {
      freezeSpec(cwd, SPEC);
      assert.deepEqual(byName(runContracts(cwd, SPEC, readLock(cwd))), { 'R1.1 x': 'pass' });
      const [c] = calls(log);
      assert.equal(c.argv.length, 2);
      assert.ok(c.file.endsWith("we ird;'name_contract.fake"));
    });
  } finally {
    done(cwd);
  }
});

// ---------------------------------------------------------------------------
// 13.3: testcase names are contract names, and the gate requires them by criterion
// ---------------------------------------------------------------------------

const TASKS = [
  '- [ ] 1. First (Req 1.1)',
  '- [ ] 2. Second (Req 2.1)',
  '- [ ] 3. Third (Req 3.1)',
].join('\n') + '\n';

function taskUpdate(cwd, text) {
  return { tasksFilePath: path.join(cwd, '.kiro/specs/demo/tasks.md'), status: 'completed', taskId: text, error: '' };
}

function receiptsOf(cwd) {
  const dir = path.join(cwd, '.necro', 'receipts', SPEC);
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
}

test('R13.3 the gate requires the contracts of the ticked task by criterion and refuses on a failing one', () => {
  const cwd = project(
    { 'a_contract.fake': 'pass R1.1 first thing\nfail R2.1 second thing\npass R3.1 third thing\n' },
    { tasks: TASKS },
  );
  try {
    freezeSpec(cwd, SPEC);
    assert.deepEqual(readLock(cwd).specs[SPEC].tasks['2'].criteria, ['2.1']);

    const refused = pre(cwd, 'task_update', taskUpdate(cwd, '2. Second (Req 2.1)'));
    assert.equal(refused.exitCode, 2);
    assert.match(refused.stderr, /R2\.1 second thing/);
    assert.equal(receiptsOf(cwd).length, 0);

    const accepted = pre(cwd, 'task_update', taskUpdate(cwd, '1. First (Req 1.1)'));
    assert.equal(accepted.exitCode, 0, accepted.stderr);
    const [receipt] = receiptsOf(cwd);
    assert.deepEqual(receipt.required, ['R1.1 first thing']);
    assert.deepEqual(receipt.task, { id: '1', line: '1. First (Req 1.1)' });
    assert.deepEqual(byName(receipt.contracts), { 'R1.1 first thing': 'pass', 'R2.1 second thing': 'fail', 'R3.1 third thing': 'pass' });
  } finally {
    done(cwd);
  }
});

test('R13.3 the gate also works when a task is ticked in tasks.md with str_replace', () => {
  const cwd = project({ 'a_contract.fake': 'fail R1.1 first thing\npass R2.1 second thing\npass R3.1 third thing\n' }, { tasks: TASKS });
  try {
    freezeSpec(cwd, SPEC);
    const tasksFile = path.join(cwd, '.kiro/specs/demo/tasks.md');
    const refused = pre(cwd, 'str_replace', { path: tasksFile, oldStr: '- [ ] 1. First', newStr: '- [x] 1. First' });
    assert.equal(refused.exitCode, 2);
    assert.match(refused.stderr, /R1\.1 first thing/);
    const accepted = pre(cwd, 'str_replace', { path: tasksFile, oldStr: '- [ ] 2. Second', newStr: '- [x] 2. Second' });
    assert.equal(accepted.exitCode, 0, accepted.stderr);
  } finally {
    done(cwd);
  }
});

test('R13.3 names are kept exactly as the report gives them, entities decoded', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 a < b & "c" > d\n' });
  try {
    freezeSpec(cwd, SPEC);
    assert.deepEqual(readLock(cwd).specs[SPEC].contracts[0].names, ['R1.1 a < b & "c" > d']);
    assert.deepEqual(byName(runContracts(cwd, SPEC, readLock(cwd))), { 'R1.1 a < b & "c" > d': 'pass' });
  } finally {
    done(cwd);
  }
});

test('R13.3 a name recorded at freeze that a later run does not report counts as failing', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 one\npass R1.2 two\n' });
  try {
    freezeSpec(cwd, SPEC);
    // The runner script is not frozen, so a run can lose a testcase without any pinned file changing.
    const lock = readLock(cwd);
    lock.specs[SPEC].contracts[0].names.push('R1.3 never reported');
    assert.deepEqual(byName(runContracts(cwd, SPEC, lock)), { 'R1.1 one': 'pass', 'R1.2 two': 'pass', 'R1.3 never reported': 'fail' });
  } finally {
    done(cwd);
  }
});

// ---------------------------------------------------------------------------
// 13.4: a file that gives no usable report is one failing contract, never a pass
// ---------------------------------------------------------------------------

function onlyFailure(results, file) {
  assert.equal(results.length, 1, JSON.stringify(results));
  assert.equal(results[0].result, 'fail');
  assert.equal(results[0].path, `contracts/demo/${file}`);
  assert.ok(results[0].name.includes(file), `the name should name the file: ${results[0].name}`);
  assert.ok(typeof results[0].reason === 'string' && results[0].reason.includes(file), `the reason should name the file: ${results[0].reason}`);
}

function failingProject(text, runners = runnersJson()) {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' }, { runners });
  freezeSpec(cwd, SPEC);
  // Swap in the failing content without touching the lock: build the results from a lock for the new file.
  put(cwd, 'contracts/demo/a_contract.fake', text);
  const lock = readLock(cwd);
  lock.specs[SPEC].contracts[0].sha256 = hashFile(path.join(cwd, 'contracts/demo/a_contract.fake'));
  lock.specs[SPEC].contracts[0].names = [];
  return { cwd, lock };
}

test('R13.4 a command that cannot start fails the file, with the file named', () => {
  const { cwd, lock } = failingProject('pass R1.1 x\n', runnersJson('/no/such/program-for-necro {file} {report}'));
  try {
    onlyFailure(runContracts(cwd, SPEC, lock), 'a_contract.fake');
  } finally {
    done(cwd);
  }
});

test('R13.4 a command that exits without writing a report fails the file', () => {
  const { cwd, lock } = failingProject('@no-report\npass R1.1 x\n');
  try {
    onlyFailure(runContracts(cwd, SPEC, lock), 'a_contract.fake');
  } finally {
    done(cwd);
  }
});

test('R13.4 XML that does not parse fails the file', () => {
  const { cwd, lock } = failingProject('@bad-xml\npass R1.1 x\n');
  try {
    onlyFailure(runContracts(cwd, SPEC, lock), 'a_contract.fake');
  } finally {
    done(cwd);
  }
});

test('R13.4 a report with no testcase fails the file', () => {
  const { cwd, lock } = failingProject('@empty\n');
  try {
    onlyFailure(runContracts(cwd, SPEC, lock), 'a_contract.fake');
  } finally {
    done(cwd);
  }
});

test('R13.4 a command without {report} writes no report there, so the file fails', () => {
  const { cwd, lock } = failingProject('pass R1.1 x\n', runnersJson(`"${process.execPath}" "${FAKE}" {file} /dev/null`));
  try {
    onlyFailure(runContracts(cwd, SPEC, lock), 'a_contract.fake');
  } finally {
    done(cwd);
  }
});

test('R13.4 a report left in the project is never read: only the {report} path counts', () => {
  const { cwd, lock } = failingProject('pass R1.1 x\n', runnersJson(`"${process.execPath}" "${FAKE}" {file} report.xml`));
  try {
    put(cwd, 'report.xml', '<testsuite><testcase name="R1.1 x"/></testsuite>');
    onlyFailure(runContracts(cwd, SPEC, lock), 'a_contract.fake');
  } finally {
    done(cwd);
  }
});

test('R13.4 the gate lists the failing file by name and writes no receipt', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 first\n', 'b_contract.fake': '@no-report\n' }, { tasks: TASKS });
  try {
    freezeSpec(cwd, SPEC);
    // Task 3 names R3.1, which no contract has, so every contract is required and the broken file fails the tick.
    const res = pre(cwd, 'task_update', taskUpdate(cwd, '3. Third (Req 3.1)'));
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /b_contract\.fake/);
    assert.equal(receiptsOf(cwd).length, 0);
  } finally {
    done(cwd);
  }
});

// ---------------------------------------------------------------------------
// 13.5: runners.json is locked with the spec's other frozen files
// ---------------------------------------------------------------------------

test('R13.5 freeze records runners.json by hash and stores a copy under .necro/frozen', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    const hash = hashFile(path.join(cwd, RUNNERS_REL));
    assert.deepEqual(readLock(cwd).specs[SPEC].runners, { path: RUNNERS_REL, sha256: hash });
    assert.equal(fs.readFileSync(path.join(cwd, '.necro/frozen', hash), 'utf8'), fs.readFileSync(path.join(cwd, RUNNERS_REL), 'utf8'));
    assert.ok(isFrozenPath(cwd, RUNNERS_REL));
    assert.equal(getExpectedHash(cwd, RUNNERS_REL), hash);
    assert.ok(frozenFiles(cwd, SPEC).some((f) => f.path === RUNNERS_REL && f.sha256 === hash));
  } finally {
    done(cwd);
  }
});

test('R13.5 a spec without runners.json has no runners entry, and freezing again after removing it drops the entry', () => {
  const cwd = project({ 'a.contract.test.js': "import { test } from 'node:test';\ntest('R1.1 js', () => {});\n", 'b_contract.fake': 'pass R2.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    assert.ok(readLock(cwd).specs[SPEC].runners);
    fs.rmSync(path.join(cwd, RUNNERS_REL));
    freezeSpec(cwd, SPEC);
    const entry = readLock(cwd).specs[SPEC];
    assert.equal(Object.hasOwn(entry, 'runners'), false);
    assert.deepEqual(entry.contracts.map((c) => c.path), ['contracts/demo/a.contract.test.js']);
  } finally {
    done(cwd);
  }
});

test('R13.5 the receipt pins runners.json, and a spec without one has a receipt with no runners field', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    const { receipt } = runCheck(cwd, SPEC);
    const written = JSON.parse(fs.readFileSync(path.join(cwd, receipt), 'utf8'));
    assert.deepEqual(written.runners, { path: RUNNERS_REL, sha256: hashFile(path.join(cwd, RUNNERS_REL)) });
  } finally {
    done(cwd);
  }
  const plain = project({ 'a.contract.test.js': "import { test } from 'node:test';\ntest('R1.1 js', () => {});\n" }, { runners: null });
  try {
    freezeSpec(plain, SPEC);
    const { receipt } = runCheck(plain, SPEC);
    const written = JSON.parse(fs.readFileSync(path.join(plain, receipt), 'utf8'));
    assert.equal(Object.hasOwn(written, 'runners'), false);
  } finally {
    done(plain);
  }
});

test('R13.5 PreToolUse refuses a write to runners.json by any write tool', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    const abs = path.join(cwd, RUNNERS_REL);
    for (const [tool, input] of [
      ['fs_write', { path: abs, text: '{}' }],
      ['str_replace', { path: RUNNERS_REL, oldStr: 'fake', newStr: 'x' }],
      ['fs_append', { path: abs, text: ' ' }],
      ['delete_file', { targetFile: abs }],
    ]) {
      const res = pre(cwd, tool, input);
      assert.equal(res.exitCode, 2, tool);
      assert.match(res.stderr, /runners\.json/, tool);
    }
    assert.equal(pre(cwd, 'read_file', { path: abs }).exitCode, 0);
  } finally {
    done(cwd);
  }
});

test('R13.5 PostToolUse puts back an edited or deleted runners.json and names it', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    const abs = path.join(cwd, RUNNERS_REL);
    const original = fs.readFileSync(abs, 'utf8');

    pre(cwd, 'execute_bash', { command: 'sed -i s/fake/x/ runners.json' });
    fs.writeFileSync(abs, '{"*": "true"}\n');
    let res = post(cwd, 'execute_bash', { command: 'x' });
    assert.equal(res.exitCode, 0);
    assert.match(res.stderr, /Restored frozen file \.kiro\/specs\/demo\/runners\.json/);
    assert.equal(fs.readFileSync(abs, 'utf8'), original);

    pre(cwd, 'execute_bash', { command: 'rm runners.json' });
    fs.rmSync(abs);
    res = post(cwd, 'execute_bash', { command: 'x' });
    assert.match(res.stderr, /runners\.json/);
    assert.equal(fs.readFileSync(abs, 'utf8'), original);
  } finally {
    done(cwd);
  }
});

test('R13.5 a runners.json that differs from the lock fails every runner file instead of running a new command', () => {
  const marker = path.join(tmpCwd('necro-runners-marker-'), 'ran');
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    put(cwd, RUNNERS_REL, runnersJson(`touch ${marker}`));
    const results = runContracts(cwd, SPEC, readLock(cwd));
    assert.deepEqual(byName(results), { 'R1.1 x': 'fail' });
    assert.ok(!fs.existsSync(marker), 'the edited command did not run');
    fs.rmSync(path.join(cwd, RUNNERS_REL));
    assert.deepEqual(byName(runContracts(cwd, SPEC, readLock(cwd))), { 'R1.1 x': 'fail' });
  } finally {
    done(cwd);
    fs.rmSync(path.dirname(marker), { recursive: true, force: true });
  }
});

test('R13.5 verify prints MISMATCH naming runners.json when it was edited after the receipt was written', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    const { receipt } = runCheck(cwd, SPEC);
    assert.equal(captureStdout(() => verify(cwd, receipt)).code, 0);

    // An edit that keeps the command working: only the spacing changes.
    put(cwd, RUNNERS_REL, runnersJson() + '\n');
    const out = captureStdout(() => verify(cwd, receipt));
    assert.equal(out.code, 1);
    assert.match(out.out, /MISMATCH/);
    assert.match(out.out, /runners\.json/);
  } finally {
    done(cwd);
  }
});

// Rewrite a written receipt with a change and a correct receiptHash, so only the pinning is at issue.
function rewriteReceipt(cwd, rel, mutate) {
  const file = path.join(cwd, rel);
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(r);
  delete r.receiptHash;
  delete r.createdAt;
  r.receiptHash = computeReceiptHash(r);
  fs.writeFileSync(file, JSON.stringify(r, null, 2) + '\n');
}

test('R13.5 verify prints MISMATCH when a receipt leaves out the runners.json the lock holds', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    const { receipt } = runCheck(cwd, SPEC);
    rewriteReceipt(cwd, receipt, (r) => delete r.runners);
    const out = captureStdout(() => verify(cwd, receipt));
    assert.equal(out.code, 1);
    assert.match(out.out, /MISMATCH/);
    assert.match(out.out, /runners\.json/);
  } finally {
    done(cwd);
  }
});

test('R13.5 verify prints MISMATCH when a receipt pins a runners.json the lock lacks', () => {
  const cwd = project({ 'a.contract.test.js': "import { test } from 'node:test';\ntest('R1.1 js', () => {});\n" }, { runners: null });
  try {
    freezeSpec(cwd, SPEC);
    const { receipt } = runCheck(cwd, SPEC);
    assert.equal(captureStdout(() => verify(cwd, receipt)).code, 0);
    rewriteReceipt(cwd, receipt, (r) => {
      r.runners = { path: RUNNERS_REL, sha256: 'a'.repeat(64) };
    });
    const out = captureStdout(() => verify(cwd, receipt));
    assert.equal(out.code, 1);
    assert.match(out.out, /MISMATCH/);
    assert.match(out.out, /runners\.json/);
  } finally {
    done(cwd);
  }
});

test('R13.5 verify prints SUPERSEDED when the spec was frozen again with a changed runners.json', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    const { receipt } = runCheck(cwd, SPEC);
    put(cwd, RUNNERS_REL, runnersJson() + '\n');
    freezeSpec(cwd, SPEC);
    const out = captureStdout(() => verify(cwd, receipt));
    assert.equal(out.code, 1);
    assert.match(out.out, /SUPERSEDED/);
    assert.match(out.out, /runners\.json/);
  } finally {
    done(cwd);
  }
});

test('R13.5 freeze refuses a runners.json that resolves outside the project', () => {
  const outside = tmpCwd('necro-runners-outside-');
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' }, { runners: null });
  try {
    fs.writeFileSync(path.join(outside, 'runners.json'), runnersJson());
    fs.symlinkSync(path.join(outside, 'runners.json'), path.join(cwd, RUNNERS_REL));
    assert.throws(() => freezeSpec(cwd, SPEC), /outside the project root/);
  } finally {
    done(cwd);
    done(outside);
  }
});

// ---------------------------------------------------------------------------
// Task 29: hardening after an independent review (Req 13.7 to 13.9)
// ---------------------------------------------------------------------------

// Set the runner time limit for one block of code.
function withLimit(ms, fn) {
  process.env.NECRO_RUNNER_TIMEOUT_MS = String(ms);
  try {
    return fn();
  } finally {
    delete process.env.NECRO_RUNNER_TIMEOUT_MS;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitDead(pid, ms = 3000) {
  const end = Date.now() + ms;
  while (alive(pid) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  return !alive(pid);
}

test('R13.7 the runner time limit is 240 seconds, and the environment can only lower it', () => {
  assert.equal(RUNNER_TIME_LIMIT_MS, 240000);
  assert.equal(runnerTimeLimitMs({}), 240000);
  assert.equal(runnerTimeLimitMs({ NECRO_RUNNER_TIMEOUT_MS: '1500' }), 1500);
  assert.equal(runnerTimeLimitMs({ NECRO_RUNNER_TIMEOUT_MS: '99999999' }), 240000, 'never above the default');
  for (const bad of ['', '0', '-5', 'abc', '1.5e3x']) assert.equal(runnerTimeLimitMs({ NECRO_RUNNER_TIMEOUT_MS: bad }), 240000, bad);
});

test('R13.7 a hung runner command is stopped at the limit: the file fails with a reason, the folder is gone', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    put(cwd, 'contracts/demo/a_contract.fake', 'pass R1.1 x\n@sleep 60000\n');
    const lock = readLock(cwd);
    lock.specs[SPEC].contracts[0].sha256 = hashFile(path.join(cwd, 'contracts/demo/a_contract.fake'));
    withLog((log) => {
      const started = Date.now();
      const results = withLimit(600, () => runContracts(cwd, SPEC, lock));
      assert.ok(Date.now() - started < 20000, 'the hang was cut off');
      assert.ok(results.every((r) => r.result === 'fail'), 'nothing passes, recorded names included');
      const named = results.find((r) => r.name.includes('a_contract.fake'));
      assert.match(named.reason, /a_contract\.fake/);
      assert.match(named.reason, /time limit/);
      const [c] = calls(log);
      assert.ok(!fs.existsSync(path.dirname(c.report)), 'the temporary folder is removed');
      assert.ok(!fs.existsSync(c.pycachePrefix), 'the bytecode folder is removed');
    });
  } finally {
    done(cwd);
  }
});

test('R13.7 on a timeout the command and its child processes are killed', () => {
  const pidFile = path.join(tmpCwd('necro-runners-pid-'), 'child.pid');
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    freezeSpec(cwd, SPEC);
    put(cwd, 'contracts/demo/a_contract.fake', `@child ${pidFile}\n@sleep 60000\n`);
    const lock = readLock(cwd);
    lock.specs[SPEC].contracts[0].sha256 = hashFile(path.join(cwd, 'contracts/demo/a_contract.fake'));
    const results = withLimit(1500, () => runContracts(cwd, SPEC, lock));
    assert.equal(results[0].result, 'fail');
    assert.match(results[0].reason, /time limit/);
    const childPid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(childPid > 0, 'the command started a child');
    assert.ok(waitDead(childPid), 'the child process is gone');
  } finally {
    done(cwd);
    fs.rmSync(path.dirname(pidFile), { recursive: true, force: true });
  }
});

test('R13.7 a run that finishes inside the limit is not affected by it', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n@sleep 100\n' });
  try {
    freezeSpec(cwd, SPEC);
    assert.deepEqual(byName(withLimit(20000, () => runContracts(cwd, SPEC, readLock(cwd)))), { 'R1.1 x': 'pass' });
  } finally {
    done(cwd);
  }
});

test('R13.8 {file} and {report} are replaced in one pass: a project path that holds {report} stays intact', () => {
  const parent = tmpCwd('necro-runners-braces-');
  const cwd = path.join(parent, 'x{report}y {file}z');
  try {
    project({ 'a_contract.fake': 'pass R1.1 x\n' }, { cwd });
    withLog((log) => {
      freezeSpec(cwd, SPEC);
      assert.deepEqual(byName(runContracts(cwd, SPEC, readLock(cwd))), { 'R1.1 x': 'pass' });
      const [c] = calls(log);
      assert.equal(c.argv.length, 2);
      assert.ok(c.file.endsWith('x{report}y {file}z/contracts/demo/a_contract.fake'), c.file);
      assert.ok(!c.report.includes('x{report}y'), 'the report path is not built from the project path');
    });
  } finally {
    done(parent);
  }
});

test('R13.8 the command gets a fresh empty PYTHONPYCACHEPREFIX folder, new each run, and PYTHONDONTWRITEBYTECODE=1', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  try {
    withLog((log) => {
      freezeSpec(cwd, SPEC);
      runContracts(cwd, SPEC, readLock(cwd));
      const seen = calls(log);
      assert.equal(seen.length, 2);
      for (const c of seen) {
        assert.equal(c.dontWriteBytecode, '1');
        assert.ok(typeof c.pycachePrefix === 'string' && path.isAbsolute(c.pycachePrefix));
        assert.deepEqual(c.pycacheEntries, [], 'the bytecode folder is empty when the command starts');
        assert.ok(path.relative(cwd, c.pycachePrefix).startsWith('..'), 'the bytecode folder is not inside the project');
        assert.notEqual(path.dirname(c.pycachePrefix), path.dirname(c.report));
        assert.ok(!fs.existsSync(c.pycachePrefix), 'the bytecode folder is removed after the run');
      }
      assert.notEqual(seen[0].pycachePrefix, seen[1].pycachePrefix);
    });
  } finally {
    done(cwd);
  }
});

test('R13.8 a value of PYTHONPYCACHEPREFIX or PYTHONDONTWRITEBYTECODE in the environment does not replace the fresh one', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' });
  process.env.PYTHONPYCACHEPREFIX = '/tmp/stale-cache';
  process.env.PYTHONDONTWRITEBYTECODE = '';
  try {
    withLog((log) => {
      freezeSpec(cwd, SPEC);
      const [c] = calls(log);
      assert.notEqual(c.pycachePrefix, '/tmp/stale-cache');
      assert.equal(c.dontWriteBytecode, '1');
    });
  } finally {
    delete process.env.PYTHONPYCACHEPREFIX;
    delete process.env.PYTHONDONTWRITEBYTECODE;
    done(cwd);
  }
});

// --- 13.9: reserved keys "sources" and "frozen" in runners.json ---------------------------------

test('R13.9 sources and frozen are reserved keys: they are not patterns, and they must be arrays of project-relative globs', () => {
  const text = JSON.stringify({ 'test_*.py': 'x {file} {report}', sources: ['app/**/*.py'], frozen: ['conftest.py', 'pytest.ini'] });
  assert.deepEqual(parseRunners(text), [{ pattern: 'test_*.py', command: 'x {file} {report}' }]);
  const bad = [
    { sources: 'app/*.py' },
    { frozen: 'conftest.py' },
    { sources: [1] },
    { frozen: [''] },
    { sources: ['/etc/passwd'] },
    { frozen: ['../outside.py'] },
    { sources: ['a/../../b.py'] },
    { frozen: ['a\\b.py'] },
    { sources: ['a//b.py'] },
    { frozen: ['C:/x.py'] },
    { sources: null },
  ];
  for (const extra of bad) {
    const t = JSON.stringify({ '*.t': 'x {file} {report}', ...extra });
    assert.throws(() => parseRunners(t), (e) => e instanceof Error && /runners\.json/.test(e.message), t);
  }
});

test('R13.9 expandGlobs lists project files that match: * and ? inside a name, ** across folders, generated folders skipped', () => {
  const cwd = tmpCwd('necro-globs-');
  try {
    for (const f of ['x.txt', 'a/b.txt', 'a/c/d.txt', 'a/c/e.md', 'node_modules/n.txt', 'a/__pycache__/z.txt', '.git/g.txt']) put(cwd, f, 'x');
    fs.symlinkSync(path.join(cwd, 'x.txt'), path.join(cwd, 'link.txt'));
    assert.deepEqual(expandGlobs(cwd, ['x.txt']), ['x.txt']);
    assert.deepEqual(expandGlobs(cwd, ['a/*.txt']), ['a/b.txt']);
    assert.deepEqual(expandGlobs(cwd, ['a/**/*.txt']), ['a/b.txt', 'a/c/d.txt']);
    assert.deepEqual(expandGlobs(cwd, ['**/*.txt']), ['a/b.txt', 'a/c/d.txt', 'x.txt'], 'links and generated folders are skipped');
    assert.deepEqual(expandGlobs(cwd, ['?.txt', 'a/b.txt']), ['a/b.txt', 'x.txt']);
    assert.deepEqual(expandGlobs(cwd, ['node_modules/n.txt']), ['node_modules/n.txt'], 'named on purpose');
    assert.deepEqual(expandGlobs(cwd, ['nope/*.txt', 'nothing.md']), []);
  } finally {
    done(cwd);
  }
});

function sourcesProject(extra) {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 x\n' }, { runners: runnersJson(COMMAND, '*_contract.fake', extra) });
  put(cwd, 'app/calc.txt', 'one\n');
  put(cwd, 'app/more.txt', 'two\n');
  put(cwd, 'conftest.txt', 'plugin-free\n');
  put(cwd, 'pytest.txt', 'ini-free\n');
  return cwd;
}

test('R13.9 the receipt pins the files that match sources, and verify prints MISMATCH when one changes', () => {
  const cwd = sourcesProject({ sources: ['app/*.txt'] });
  try {
    freezeSpec(cwd, SPEC);
    const { receipt } = runCheck(cwd, SPEC);
    const written = JSON.parse(fs.readFileSync(path.join(cwd, receipt), 'utf8'));
    assert.deepEqual(
      written.sources,
      [
        { path: 'app/calc.txt', sha256: hashFile(path.join(cwd, 'app/calc.txt')) },
        { path: 'app/more.txt', sha256: hashFile(path.join(cwd, 'app/more.txt')) },
      ],
    );
    assert.equal(captureStdout(() => verify(cwd, receipt)).code, 0);
    put(cwd, 'app/more.txt', 'changed\n');
    const out = captureStdout(() => verify(cwd, receipt));
    assert.equal(out.code, 1);
    assert.match(out.out, /MISMATCH/);
    assert.match(out.out, /app\/more\.txt/);
  } finally {
    done(cwd);
  }
});

test('R13.9 a spec without sources keeps a receipt with no sources from runner files', () => {
  const cwd = sourcesProject({});
  try {
    freezeSpec(cwd, SPEC);
    const { receipt } = runCheck(cwd, SPEC);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, receipt), 'utf8')).sources, []);
  } finally {
    done(cwd);
  }
});

test('R13.9 freeze locks every file listed under frozen with the spec, stores a copy, and the hooks protect them', () => {
  const cwd = sourcesProject({ frozen: ['conftest.txt', 'pytest.txt'] });
  try {
    freezeSpec(cwd, SPEC);
    const entry = readLock(cwd).specs[SPEC];
    const hashes = { 'conftest.txt': hashFile(path.join(cwd, 'conftest.txt')), 'pytest.txt': hashFile(path.join(cwd, 'pytest.txt')) };
    assert.deepEqual(entry.frozen, [
      { path: 'conftest.txt', sha256: hashes['conftest.txt'] },
      { path: 'pytest.txt', sha256: hashes['pytest.txt'] },
    ]);
    for (const [p, h] of Object.entries(hashes)) {
      assert.equal(fs.readFileSync(path.join(cwd, '.necro/frozen', h), 'utf8'), fs.readFileSync(path.join(cwd, p), 'utf8'));
      assert.ok(isFrozenPath(cwd, p));
      assert.equal(getExpectedHash(cwd, p), h);
      assert.ok(frozenFiles(cwd, SPEC).some((f) => f.path === p && f.sha256 === h));
    }
    // PreToolUse refuses a write, PostToolUse puts the file back.
    const res = pre(cwd, 'fs_write', { path: path.join(cwd, 'conftest.txt'), text: 'plugin' });
    assert.equal(res.exitCode, 2);
    assert.match(res.stderr, /conftest\.txt/);
    pre(cwd, 'execute_bash', { command: 'echo plugin > conftest.txt' });
    fs.writeFileSync(path.join(cwd, 'conftest.txt'), 'plugin\n');
    fs.rmSync(path.join(cwd, 'pytest.txt'));
    const back = post(cwd, 'execute_bash', { command: 'x' });
    assert.match(back.stderr, /Restored frozen file conftest\.txt/);
    assert.match(back.stderr, /Restored frozen file pytest\.txt/);
    assert.equal(fs.readFileSync(path.join(cwd, 'conftest.txt'), 'utf8'), 'plugin-free\n');
    assert.equal(fs.readFileSync(path.join(cwd, 'pytest.txt'), 'utf8'), 'ini-free\n');
  } finally {
    done(cwd);
  }
});

test('R13.9 a frozen file that changed or is gone fails every runner file without running the command', () => {
  const cwd = sourcesProject({ frozen: ['conftest.txt'] });
  try {
    withLog((log) => {
      freezeSpec(cwd, SPEC);
      const before = calls(log).length;
      put(cwd, 'conftest.txt', 'planted\n');
      let results = runContracts(cwd, SPEC, readLock(cwd));
      assert.deepEqual(byName(results), { 'R1.1 x': 'fail' });
      assert.match(results[0].reason, /conftest\.txt/);
      fs.rmSync(path.join(cwd, 'conftest.txt'));
      results = runContracts(cwd, SPEC, readLock(cwd));
      assert.deepEqual(byName(results), { 'R1.1 x': 'fail' });
      assert.equal(calls(log).length, before, 'the command did not run');
    });
  } finally {
    done(cwd);
  }
});

test('R13.9 the receipt pins the frozen files, and verify prints MISMATCH when one changes or the receipt leaves them out', () => {
  const cwd = sourcesProject({ frozen: ['conftest.txt'] });
  try {
    freezeSpec(cwd, SPEC);
    const { receipt } = runCheck(cwd, SPEC);
    const written = JSON.parse(fs.readFileSync(path.join(cwd, receipt), 'utf8'));
    assert.deepEqual(written.frozen, [{ path: 'conftest.txt', sha256: hashFile(path.join(cwd, 'conftest.txt')) }]);
    assert.equal(captureStdout(() => verify(cwd, receipt)).code, 0);

    rewriteReceipt(cwd, receipt, (r) => delete r.frozen);
    let out = captureStdout(() => verify(cwd, receipt));
    assert.equal(out.code, 1);
    assert.match(out.out, /MISMATCH/);
    assert.match(out.out, /conftest\.txt/);

    const { receipt: again } = runCheck(cwd, SPEC);
    assert.equal(captureStdout(() => verify(cwd, again)).code, 0);
    put(cwd, 'conftest.txt', 'planted\n');
    out = captureStdout(() => verify(cwd, again));
    assert.equal(out.code, 1);
    assert.match(out.out, /MISMATCH/);
    assert.match(out.out, /conftest\.txt/);
  } finally {
    done(cwd);
  }
});

test('R13.9 freeze says which entry of sources or frozen matches no file, and a spec without them has no frozen entry', () => {
  for (const key of ['sources', 'frozen']) {
    const cwd = sourcesProject({ [key]: ['missing/*.txt'] });
    try {
      assert.throws(() => freezeSpec(cwd, SPEC), (e) => /runners\.json/.test(e.message) && /missing\/\*\.txt/.test(e.message) && new RegExp(key).test(e.message));
    } finally {
      done(cwd);
    }
  }
  const cwd = sourcesProject({});
  try {
    freezeSpec(cwd, SPEC);
    assert.equal(Object.hasOwn(readLock(cwd).specs[SPEC], 'frozen'), false);
    const { receipt } = runCheck(cwd, SPEC);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(cwd, receipt), 'utf8')), 'frozen'), false);
  } finally {
    done(cwd);
  }
});

test('R13.9 verify prints SUPERSEDED when the spec was frozen again with a changed frozen file', () => {
  const cwd = sourcesProject({ frozen: ['conftest.txt'] });
  try {
    freezeSpec(cwd, SPEC);
    const { receipt } = runCheck(cwd, SPEC);
    put(cwd, 'conftest.txt', 'a deliberate change by a person\n');
    freezeSpec(cwd, SPEC);
    const out = captureStdout(() => verify(cwd, receipt));
    assert.equal(out.code, 1);
    assert.match(out.out, /SUPERSEDED/);
    assert.match(out.out, /conftest\.txt/);
  } finally {
    done(cwd);
  }
});

// --- The review's attacks against a real pytest (skipped with a plain message when it is missing) -----------

const HAS_PYTEST = (() => {
  try {
    return spawnSync('python3', ['-m', 'pytest', '--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();
const PYTEST = HAS_PYTEST ? {} : { skip: 'python3 -m pytest is not installed, so this Python check was skipped' };
const PY_COMMAND = 'python3 -m pytest {file} --junitxml={report} -q -p no:cacheprovider';
const PY_CONTRACT =
  "import sys, os\nsys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'app'))\nfrom calc import add\n\ndef test_R1_1_add():\n    assert add(2, 3) == 5\n";

// A Python project with the review's shape; `code` is the body of add().
function pyProject(code, extra = {}, command = PY_COMMAND) {
  const cwd = tmpCwd('necro-py-');
  put(cwd, '.kiro/specs/s/requirements.md', '# S\n');
  put(cwd, '.kiro/specs/s/runners.json', JSON.stringify({ 'test_*_contract.py': command, ...extra }, null, 2) + '\n');
  put(cwd, 'contracts/s/test_calc_contract.py', PY_CONTRACT);
  put(cwd, 'app/calc.py', `def add(a, b):\n    return ${code}\n`);
  return cwd;
}

const pyResults = (cwd) => Object.fromEntries(runContracts(cwd, 's', readLock(cwd)).map((r) => [r.name, r.result]));

test('R13.8 stale bytecode with a restored modified time cannot stand in for changed source (pytest)', PYTEST, () => {
  const cwd = pyProject('a + b');
  try {
    freezeSpec(cwd, 's');
    assert.deepEqual(pyResults(cwd), { test_R1_1_add: 'pass' });
    // Compile the correct code the ordinary way, so a cached copy sits in app/__pycache__.
    const compiled = spawnSync('python3', ['-c', 'import sys; sys.path.insert(0, "app"); import calc'], { cwd });
    assert.equal(compiled.status, 0);
    // Wrong code of the same size, with the old modified time put back.
    const file = path.join(cwd, 'app/calc.py');
    const { atime, mtime } = fs.statSync(file);
    fs.writeFileSync(file, 'def add(a, b):\n    return a - b\n');
    fs.utimesSync(file, atime, mtime);
    assert.deepEqual(pyResults(cwd), { test_R1_1_add: 'fail' });
  } finally {
    done(cwd);
  }
});

test('R13.9 a conftest.py or pytest.ini written after the freeze cannot turn a failing run into a pass (pytest)', PYTEST, () => {
  const cwd = pyProject('a - b', { frozen: ['conftest.py', 'pytest.ini'] });
  put(cwd, 'conftest.py', '# nothing here\n');
  put(cwd, 'pytest.ini', '[pytest]\n');
  try {
    // The person freezes wrong code on purpose here, so the contract fails before and after.
    freezeSpec(cwd, 's');
    assert.deepEqual(pyResults(cwd), { test_R1_1_add: 'fail' });
    const plugin =
      "import pytest\n@pytest.hookimpl(hookwrapper=True)\ndef pytest_runtest_makereport(item, call):\n    outcome = yield\n    rep = outcome.get_result()\n    if rep.when == 'call':\n        rep.outcome = 'passed'\n";
    put(cwd, 'conftest.py', plugin);
    assert.deepEqual(pyResults(cwd), { test_R1_1_add: 'fail' }, 'a planted conftest.py');
    put(cwd, 'conftest.py', '# nothing here\n');
    put(cwd, 'plug.py', plugin);
    put(cwd, 'pytest.ini', '[pytest]\naddopts = -p plug\n');
    assert.deepEqual(pyResults(cwd), { test_R1_1_add: 'fail' }, 'a planted pytest.ini');
  } finally {
    done(cwd);
  }
});

test('R13.7 a hang in the code under test is cut off at the limit (pytest)', PYTEST, () => {
  const cwd = pyProject('a + b');
  try {
    freezeSpec(cwd, 's');
    put(cwd, 'app/calc.py', 'import time\ntime.sleep(10**6)\ndef add(a, b):\n    return a + b\n');
    const started = Date.now();
    const results = withLimit(4000, () => runContracts(cwd, 's', readLock(cwd)));
    assert.ok(Date.now() - started < 30000);
    assert.equal(results.every((r) => r.result === 'fail'), true);
    assert.ok(results.some((r) => /time limit/.test(r.reason || '')));
  } finally {
    done(cwd);
  }
});

test('R13.1 a pytest.py planted in the project does not stand in for pytest when the command uses -P', PYTEST, () => {
  const cwd = pyProject('a - b', {}, 'python3 -P -m pytest {file} --junitxml={report} -q -p no:cacheprovider');
  try {
    freezeSpec(cwd, 's');
    put(
      cwd,
      'pytest.py',
      "import sys\nfor a in sys.argv:\n    if a.startswith('--junitxml='):\n        open(a.split('=', 1)[1], 'w').write('<testsuite><testcase name=\"test_R1_1_add\"/></testsuite>')\n",
    );
    assert.deepEqual(pyResults(cwd), { test_R1_1_add: 'fail' });
  } finally {
    done(cwd);
  }
});

// ---------------------------------------------------------------------------
// Task 30: a clean environment for contracts (Req 13.11)
// ---------------------------------------------------------------------------

const REDIRECTS = ['PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'PYTHONUSERBASE', 'PYTEST_ADDOPTS', 'PYTEST_PLUGINS', 'NODE_OPTIONS', 'NODE_PATH'];

// A preload that records that it ran and, if it reaches a contract process, makes every check pass: assert.equal,
// assert.ok and assert.strictEqual do nothing, and a fake runner exits 0 with a report that says all passed.
function leakPreload(dir, mark) {
  const file = path.join(dir, 'leak.cjs');
  fs.writeFileSync(
    file,
    `const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(mark)}, 'loaded\\n');
const a = require('node:assert/strict');
a.equal = () => {};
a.strictEqual = () => {};
a.ok = () => {};
process.on('exit', () => {
  const [contract, report] = process.argv.slice(2);
  if (contract && /_contract\\.fake$/.test(contract) && report) {
    fs.writeFileSync(report, '<testsuite><testcase name="R1.2 wrong"/></testsuite>');
    process.exitCode = 0;
  }
});
`,
  );
  return file;
}

// Run fn with every variable of Req 13.11 set in this process, then put the old values back.
function withLeakedEnv(preload, fn) {
  const saved = Object.fromEntries(REDIRECTS.map((name) => [name, process.env[name]]));
  for (const name of REDIRECTS) process.env[name] = `leak-${name}`;
  process.env.NODE_OPTIONS = `--require ${preload}`;
  try {
    return fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('R13.11 none of the redirecting variables set in the parent reaches a runner command, and a wrong implementation still fails', () => {
  const cwd = project({ 'a_contract.fake': 'pass R1.1 right\nfail R1.2 wrong\n' });
  const aside = tmpCwd('necro-runners-leak-');
  try {
    const mark = path.join(aside, 'mark');
    const preload = leakPreload(aside, mark);
    withLog((log) => {
      freezeSpec(cwd, SPEC);
      fs.rmSync(log, { force: true });
      const results = withLeakedEnv(preload, () => runContracts(cwd, SPEC, readLock(cwd)));
      assert.deepEqual(byName(results), { 'R1.1 right': 'pass', 'R1.2 wrong': 'fail' });
      const seen = calls(log);
      assert.equal(seen.length, 1);
      assert.deepEqual(seen[0].env, Object.fromEntries(REDIRECTS.map((name) => [name, null])));
    });
    assert.ok(!fs.existsSync(mark), 'the preload named in NODE_OPTIONS never ran in the command');
  } finally {
    done(cwd);
    done(aside);
  }
});

test('R13.11 none of the redirecting variables set in the parent reaches a JavaScript contract file, and a wrong implementation still fails', () => {
  const cwd = tmpCwd('necro-runners-js-');
  const aside = tmpCwd('necro-runners-leak-');
  try {
    const mark = path.join(aside, 'mark');
    const seen = path.join(aside, 'seen.json');
    const preload = leakPreload(aside, mark);
    const body = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const names = ${JSON.stringify(REDIRECTS)};
test('R1.1 right', () => {
  fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify(Object.fromEntries(names.map((n) => [n, process.env[n] ?? null]))));
  assert.equal(1, 1);
});
test('R1.2 wrong', () => {
  assert.equal(1, 2);
});
`;
    put(cwd, '.kiro/specs/demo/requirements.md', '# Demo\n');
    put(cwd, 'contracts/demo/leak.contract.test.js', body);
    const lock = {
      specs: {
        demo: {
          requirements: { path: '.kiro/specs/demo/requirements.md', sha256: hashFile(path.join(cwd, '.kiro/specs/demo/requirements.md')) },
          contracts: [
            { name: 'leak', path: 'contracts/demo/leak.contract.test.js', sha256: hashFile(path.join(cwd, 'contracts/demo/leak.contract.test.js')), names: ['R1.1 right', 'R1.2 wrong'] },
          ],
        },
      },
    };
    const results = withLeakedEnv(preload, () => runContracts(cwd, SPEC, lock));
    assert.deepEqual(byName(results), { 'R1.1 right': 'pass', 'R1.2 wrong': 'fail' });
    assert.deepEqual(JSON.parse(fs.readFileSync(seen, 'utf8')), Object.fromEntries(REDIRECTS.map((name) => [name, null])));
    assert.ok(!fs.existsSync(mark), 'the preload named in NODE_OPTIONS never ran in the contract process');
  } finally {
    done(cwd);
    done(aside);
  }
});

test('R13.11 withoutRedirects drops exactly the redirecting variables and leaves the rest, without changing its input', () => {
  assert.deepEqual([...REDIRECT_VARS].sort(), [...REDIRECTS].sort());
  const input = { PATH: '/bin', HOME: '/h', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1', NODE_ENV: 'test', ...Object.fromEntries(REDIRECTS.map((n) => [n, 'x'])) };
  const copy = { ...input };
  const out = withoutRedirects(input);
  assert.deepEqual(out, { PATH: '/bin', HOME: '/h', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1', NODE_ENV: 'test' });
  assert.deepEqual(input, copy);
  assert.notEqual(out, input);
});

test('R13.11 on Windows, where variable names ignore case, a differently spelled variable is dropped too', () => {
  assert.deepEqual(withoutRedirects({ Path: 'p', Node_Options: 'x', node_options: 'y', PythonPath: 'z' }, 'win32'), { Path: 'p' });
  assert.deepEqual(withoutRedirects({ node_options: 'y', NODE_OPTIONS: 'x' }, 'linux'), { node_options: 'y' });
});
