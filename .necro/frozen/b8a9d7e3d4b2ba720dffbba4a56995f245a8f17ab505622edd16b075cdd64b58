// Contracts for Requirement 8 (init): `necro init` sets a project up for Kiro.
// R8.1 to R8.7.
//
// Each test runs `necro init` in a throwaway project in a temp directory and reads back what it wrote. R8.6 runs
// the written hook commands with no PATH, from a copy of the tool installed in a folder whose name has a space and
// a dollar sign. This file carries its own helpers.
//
// The receipt pins the files `necro init` copies from. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../templates/necromancer.hooks.json'
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

function init(project, bin = BIN) {
  return spawnSync(process.execPath, [bin, 'init'], { cwd: project, encoding: 'utf8', env: cleanEnv() });
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-init-'));
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

const HOOKS_REL = '.kiro/hooks/necromancer.json';
const STEERING_REL = '.kiro/steering/necromancer.md';

function initialized(project) {
  const res = init(project);
  assert.equal(res.status, 0, res.stderr);
  return {
    res,
    config: JSON.parse(fs.readFileSync(path.join(project, HOOKS_REL), 'utf8')),
    steering: fs.readFileSync(path.join(project, STEERING_REL), 'utf8'),
  };
}

// How Kiro applies a hook matcher to a tool name: a hook with no matcher (or an empty one) runs for every tool,
// otherwise the matcher is a regular expression tested against the tool name. "*" is not a valid regular
// expression, so a matcher that is not a valid expression matches nothing.
function matches(matcher, toolName) {
  if (matcher === undefined || matcher === null || matcher === '') return true;
  if (typeof matcher !== 'string') return false;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return false;
  }
}

function hooksFor(config, trigger) {
  const found = config.hooks.filter((h) => h.trigger === trigger);
  assert.equal(found.length, 1, `exactly one ${trigger} hook`);
  return found[0];
}

test('R8.1 init writes .kiro/hooks/necromancer.json with PreToolUse, PostToolUse and Stop hooks that call necro hook pre, post and stop, each with a timeout of 300 seconds', () =>
  temp((project) => {
    const { config } = initialized(project);
    assert.equal(config.version, 'v1');
    assert.ok(Array.isArray(config.hooks));
    assert.equal(config.hooks.length, 4); // PostTaskExec added by Req 14.4 (person edit, Nov 10)
    for (const [trigger, sub] of [['PreToolUse', 'pre'], ['PostToolUse', 'post'], ['Stop', 'stop']]) {
      const hook = hooksFor(config, trigger);
      assert.equal(hook.action.type, 'command', trigger);
      assert.match(hook.action.command, new RegExp(`necro(\\.js)?"? hook ${sub}$`), `${trigger}: ${hook.action.command}`);
      assert.equal(hook.timeout, 300, `${trigger} timeout`);
    }
  }));

test('R8.2 init writes .kiro/steering/necromancer.md telling the agent that frozen contracts decide "done" and must not be edited', () =>
  temp((project) => {
    const { steering } = initialized(project);
    assert.match(steering, /frozen contracts/i);
    assert.match(steering, /"done"|\bdone\b/i);
    assert.match(steering, /(do not|must not|never|cannot) (be )?edit/i);
  }));

test('R8.3 if the hook and steering files already exist init leaves them unchanged and says so', () => {
  // Files written by an earlier init.
  temp((project) => {
    initialized(project);
    const before = {
      hooks: fs.readFileSync(path.join(project, HOOKS_REL)),
      steering: fs.readFileSync(path.join(project, STEERING_REL)),
    };
    const second = init(project);
    assert.equal(second.status, 0, second.stderr);
    assert.ok(fs.readFileSync(path.join(project, HOOKS_REL)).equals(before.hooks), 'hooks file unchanged');
    assert.ok(fs.readFileSync(path.join(project, STEERING_REL)).equals(before.steering), 'steering file unchanged');
    assert.match(second.stdout, /already exist/i);
    assert.match(second.stdout, /unchanged/i);
  });

  // Files the user wrote and edited.
  temp((project) => {
    fs.mkdirSync(path.join(project, '.kiro/hooks'), { recursive: true });
    fs.mkdirSync(path.join(project, '.kiro/steering'), { recursive: true });
    fs.writeFileSync(path.join(project, HOOKS_REL), '{"version":"v1","hooks":[],"mine":true}\n');
    fs.writeFileSync(path.join(project, STEERING_REL), '# My own steering\n');
    const res = init(project);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.readFileSync(path.join(project, HOOKS_REL), 'utf8'), '{"version":"v1","hooks":[],"mine":true}\n');
    assert.equal(fs.readFileSync(path.join(project, STEERING_REL), 'utf8'), '# My own steering\n');
    assert.match(res.stdout, /already exist/i);
  });
});

test('R8.4 the PreToolUse hook init writes matches every tool, not a fixed list of write tools', () =>
  temp((project) => {
    const { config } = initialized(project);
    const hook = hooksFor(config, 'PreToolUse');
    for (const tool of [
      'fs_write', 'str_replace', 'fs_append', 'delete_file', 'execute_bash', 'read_file', 'grep_search',
      'code', 'task_update', 'some_future_write_tool', '@server/write_note',
    ]) {
      assert.ok(matches(hook.matcher, tool), `the PreToolUse hook must match ${tool} (matcher: ${JSON.stringify(hook.matcher)})`);
    }
    // Self-check of the matcher rule used above.
    assert.equal(matches('fs_write|str_replace', 'read_file'), false);
    assert.equal(matches('*', 'fs_write'), false);
  }));

test('R8.5 the PostToolUse hook init writes matches every write and shell tool named in Requirement 3', () =>
  temp((project) => {
    const { config } = initialized(project);
    const hook = hooksFor(config, 'PostToolUse');
    for (const tool of [
      'execute_bash', 'execute_pwsh', 'control_bash_process', 'control_pwsh_process',
      'fs_write', 'str_replace', 'fs_append', 'delete_file',
    ]) {
      assert.ok(matches(hook.matcher, tool), `the PostToolUse hook must match ${tool} (matcher: ${JSON.stringify(hook.matcher)})`);
    }
  }));

// A copy of the tool in a folder whose name has a space and a dollar sign, so a command that is not quoted breaks.
function installCopy() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-install-'));
  const root = path.join(base, 'my tool $HOME');
  for (const dir of ['bin', 'src', 'templates']) fs.cpSync(path.join(REPO, dir), path.join(root, dir), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'));
  return { base, root };
}

// Reads a command of the form: "<path>" "<path>" hook <sub>, where each path is a double-quoted shell word.
function parseCommand(command) {
  const m = /^"((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)" hook (pre|post|stop|posttask)$/.exec(command);
  assert.ok(m, `the command is two quoted paths followed by "hook <name>": ${command}`);
  const unquote = (s) => s.replace(/\\(.)/g, '$1');
  return { node: unquote(m[1]), script: unquote(m[2]), sub: m[3] };
}

test('R8.6 init writes hook commands with the absolute, quoted path of the Node.js binary that ran init and of bin/necro.js', () => {
  const { base, root } = installCopy();
  const project = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-project-')), 'a project with spaces');
  fs.mkdirSync(project);
  try {
    const res = init(project, path.join(root, 'bin', 'necro.js'));
    assert.equal(res.status, 0, res.stderr);
    const config = JSON.parse(fs.readFileSync(path.join(project, HOOKS_REL), 'utf8'));
    const subs = { PreToolUse: 'pre', PostToolUse: 'post', Stop: 'stop', PostTaskExec: 'posttask' };
    assert.equal(config.hooks.length, 4); // PostTaskExec added by Req 14.4 (person edit, Nov 10)

    for (const hook of config.hooks) {
      const { node, script, sub } = parseCommand(hook.action.command);
      assert.equal(sub, subs[hook.trigger], `${hook.trigger} calls hook ${subs[hook.trigger]}`);
      assert.ok(path.isAbsolute(node), `an absolute Node.js path: ${node}`);
      assert.equal(fs.realpathSync(node), fs.realpathSync(process.execPath), 'the Node.js binary that ran init');
      assert.ok(path.isAbsolute(script), `an absolute script path: ${script}`);
      // Compared by real path: a temp folder can be reached through a link (/var is /private/var on macOS).
      assert.equal(fs.realpathSync(script), fs.realpathSync(path.join(root, 'bin', 'necro.js')), 'the necro.js of the copy that ran init');
      assert.equal(hook.timeout, 300);
    }

    // The Kiro IDE started from the Dock has no PATH, so each written command must work without one. The payload
    // is a read tool for every hook; the last call checks that PreToolUse really reaches the handler.
    for (const hook of config.hooks) {
      const payload = JSON.stringify({ hook_event_name: hook.trigger, cwd: project, tool_name: 'read_file', tool_input: { path: 'README.md' } });
      const run = spawnSync('/bin/sh', ['-c', hook.action.command], {
        cwd: project,
        input: payload,
        encoding: 'utf8',
        env: { PATH: '/nonexistent' },
      });
      assert.equal(run.status, 0, `${hook.trigger}: ${run.stderr}`);
    }
    const pre = config.hooks.find((h) => h.trigger === 'PreToolUse');
    const blocked = spawnSync('/bin/sh', ['-c', pre.action.command], {
      cwd: project,
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        cwd: project,
        tool_name: 'fs_write',
        tool_input: { path: '.necro/lock.json', text: '{}' },
      }),
      encoding: 'utf8',
      env: { PATH: '/nonexistent' },
    });
    assert.equal(blocked.status, 2, blocked.stderr);
    assert.match(blocked.stderr, /\.necro/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(path.dirname(project), { recursive: true, force: true });
  }
});

test('R8.7 init says Kiro runs hooks only in a trusted workspace and that after trusting it Kiro must be quit and reopened', () =>
  temp((project) => {
    // On the run that writes the files and on the run that finds them.
    for (const round of ['first run', 'second run']) {
      const res = init(project);
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /trusted workspace/i, round);
      assert.match(res.stdout, /quit and reopen/i, round);
    }
  }));
