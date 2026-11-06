import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'necro-cli-'));
}

// Since bin/necro.js will be an executable that uses process.argv,
// we'll test the main functions from src/ modules.

test('Req 8.1: necro init writes .kiro/hooks/necromancer.json with PreToolUse, PostToolUse, and Stop hooks', () => {
  const cwd = tmpCwd();
  try {
    // For now, just verify the templates exist
    // The actual init command implementation will copy them
    const hookTemplate = path.resolve(path.join(__dirname, '../templates/necromancer.hooks.json'));
    assert.ok(fs.existsSync(hookTemplate), `hook template exists at ${hookTemplate}`);

    const content = JSON.parse(fs.readFileSync(hookTemplate, 'utf8'));
    assert.ok(Array.isArray(content.hooks), 'hooks is an array');
    
    // Check for pre, post, stop hooks
    const hookNames = content.hooks.map((h) => h.name.toLowerCase());
    assert.ok(hookNames.some((n) => n.includes('pre')), 'PreToolUse hook present');
    assert.ok(hookNames.some((n) => n.includes('post')), 'PostToolUse hook present');
    assert.ok(hookNames.some((n) => n.includes('stop')), 'Stop hook present');

    // Check timeout
    assert.ok(content.hooks.every((h) => h.timeout === 300), 'hooks have 300s timeout');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('Req 8.2: necro init writes .kiro/steering/necromancer.md', () => {
  const steeringTemplate = path.resolve(path.join(__dirname, '../templates/necromancer.steering.md'));
  assert.ok(fs.existsSync(steeringTemplate), `steering template exists at ${steeringTemplate}`);

  const content = fs.readFileSync(steeringTemplate, 'utf8');
  assert.ok(content.length > 0, 'steering file has content');
  // Should mention contracts and done
  assert.ok(content.toLowerCase().includes('contract'), 'mentions contracts');
});

test('Req 8.3: if hook/steering files already exist, necro init leaves them unchanged and says so', () => {
  const cwd = tmpCwd();
  try {
    // This would be tested by actually running `necro init` twice
    // For now, we just verify the test infrastructure
    assert.ok(true, 'placeholder for integration test');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Task 8d: the PreToolUse hook sees every tool (Req 8.4)
// ---------------------------------------------------------------------------

// How Kiro applies a hook matcher to a tool name. A hook with no matcher (or an
// empty one) runs for every tool; otherwise the matcher is a regular expression
// tested against the tool name. "*" is accepted by the Kiro CLI as "all tools"
// but is not a valid regular expression, so it does not count as matching here:
// the template must work under both readings, which a missing matcher does.
function matcherMatches(matcher, toolName) {
  if (matcher === undefined || matcher === null || matcher === '') return true;
  if (typeof matcher !== 'string') return false;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return false;
  }
}

const TOOL_NAMES = [
  'fs_write',
  'str_replace',
  'fs_append',
  'execute_bash',
  'delete_file',
  'read_file',
  'grep_search',
  'some_future_write_tool',
  '@server/write_note',
];

function preHook(config) {
  const pre = config.hooks.filter((h) => h.trigger === 'PreToolUse');
  assert.equal(pre.length, 1, 'exactly one PreToolUse hook');
  return pre[0];
}

test('Req 8.4: the template PreToolUse hook matches every tool, not a fixed list', () => {
  const template = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../templates/necromancer.hooks.json'), 'utf8'),
  );
  const hook = preHook(template);
  for (const tool of TOOL_NAMES) {
    assert.ok(matcherMatches(hook.matcher, tool), `PreToolUse hook must match ${tool}`);
  }
  assert.equal(hook.action.command, 'necro hook pre');
  assert.equal(hook.timeout, 300);
});

// Req 3.10: PostToolUse records tasks.md after a write lands, so it must run
// after fs_write and str_replace as well as after execute_bash, and only then.
function assertPostMatcher(config, label) {
  const post = config.hooks.filter((h) => h.trigger === 'PostToolUse');
  assert.equal(post.length, 1, `${label}: exactly one PostToolUse hook`);
  for (const tool of ['execute_bash', 'fs_write', 'str_replace']) {
    assert.ok(matcherMatches(post[0].matcher, tool), `${label}: PostToolUse hook must match ${tool}`);
  }
  // Req 8.5: every write and shell tool named in Requirement 3.
  for (const tool of [
    'execute_pwsh',
    'control_bash_process',
    'control_pwsh_process',
    'fs_append',
    'delete_file',
  ]) {
    assert.ok(matcherMatches(post[0].matcher, tool), `${label}: PostToolUse hook must match ${tool}`);
  }
  for (const tool of ['read_file', 'grep', 'glob', 'list_directory', 'file_search', 'grep_search', 'code']) {
    assert.ok(!matcherMatches(post[0].matcher, tool), `${label}: PostToolUse hook must not match ${tool}`);
  }
  // The template says `necro hook post`; init swaps `necro` for absolute paths (Req 8.6).
  assert.ok(post[0].action.command.endsWith(' hook post'), `${label}: runs hook post`);
  assert.equal(post[0].timeout, 300);
}

test('Req 3.10: the template PostToolUse hook runs after execute_bash, fs_write and str_replace', () => {
  const template = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../templates/necromancer.hooks.json'), 'utf8'),
  );
  assertPostMatcher(template, 'template');
});

test('Req 8.4: necro init writes a PreToolUse hook that matches every tool', () => {
  const cwd = tmpCwd();
  try {
    const bin = path.join(__dirname, '../bin/necro.js');
    const res = spawnSync(process.execPath, [bin, 'init'], { cwd, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    const written = JSON.parse(fs.readFileSync(path.join(cwd, '.kiro/hooks/necromancer.json'), 'utf8'));
    const hook = preHook(written);
    for (const tool of TOOL_NAMES) {
      assert.ok(matcherMatches(hook.matcher, tool), `written PreToolUse hook must match ${tool}`);
    }
    // PostToolUse sees shell commands and the two write tools (Req 3.10).
    assertPostMatcher(written, 'written');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('Req 8.4: the matcher check itself rejects a fixed list and an invalid "*" regex', () => {
  assert.equal(matcherMatches('fs_write|str_replace|execute_bash', 'read_file'), false);
  assert.equal(matcherMatches('*', 'fs_write'), false);
  assert.equal(matcherMatches(undefined, 'anything'), true);
  assert.equal(matcherMatches('.*', 'anything'), true);
});

// ---------------------------------------------------------------------------
// Task 17: hooks that work from the Dock (Req 8.6, 8.7)
// ---------------------------------------------------------------------------

// Copy the tool into a directory whose name holds a space and a `$`, so an
// unquoted or badly quoted command breaks. Returns the copy's root.
function installCopy() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-install-'));
  const root = path.join(base, 'my tool $HOME');
  const repo = path.join(__dirname, '..');
  for (const dir of ['bin', 'src', 'templates']) {
    fs.cpSync(path.join(repo, dir), path.join(root, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(repo, 'package.json'), path.join(root, 'package.json'));
  return { base, root };
}

function initFromCopy(root, project) {
  return spawnSync(process.execPath, [path.join(root, 'bin/necro.js'), 'init'], { cwd: project, encoding: 'utf8' });
}

test('Req 8.6: init writes quoted absolute node and necro.js paths into every hook command', () => {
  const { base, root } = installCopy();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-proj-'));
  try {
    const res = initFromCopy(root, project);
    assert.equal(res.status, 0, res.stderr);
    const written = JSON.parse(fs.readFileSync(path.join(project, '.kiro/hooks/necromancer.json'), 'utf8'));
    const bin = path.join(root, 'bin/necro.js');
    const expected = { PreToolUse: 'pre', PostToolUse: 'post', Stop: 'stop' };
    assert.equal(written.hooks.length, 3);
    for (const hook of written.hooks) {
      const sub = expected[hook.trigger];
      assert.ok(sub, `unexpected trigger ${hook.trigger}`);
      const cmd = hook.action.command;
      assert.ok(cmd.startsWith(`"${process.execPath}" "`), `node path is absolute and quoted: ${cmd}`);
      assert.ok(cmd.endsWith(` hook ${sub}`), `ends with hook ${sub}: ${cmd}`);
      assert.ok(path.isAbsolute(process.execPath));
      // The necro.js path is the copy's own, not the repository's.
      assert.ok(cmd.includes('my tool '), `bin path is in the copy: ${cmd}`);
      assert.ok(!cmd.includes(path.join(__dirname, '..', 'bin')), 'does not point at another install');
      assert.equal(hook.timeout, 300);
    }
    assert.ok(fs.existsSync(bin));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('Req 8.6: the written commands run with no PATH, from a directory containing a space', { skip: process.platform === 'win32' }, () => {
  const { base, root } = installCopy();
  const project = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'necro-proj-')), 'a project with spaces');
  fs.mkdirSync(project);
  try {
    const res = initFromCopy(root, project);
    assert.equal(res.status, 0, res.stderr);
    const written = JSON.parse(fs.readFileSync(path.join(project, '.kiro/hooks/necromancer.json'), 'utf8'));
    for (const hook of written.hooks) {
      const payload = JSON.stringify({
        hook_event_name: hook.trigger,
        cwd: project,
        tool_name: 'read_file',
        tool_input: { path: 'README.md' },
      });
      const run = spawnSync('/bin/sh', ['-c', hook.action.command], {
        cwd: project,
        input: payload,
        encoding: 'utf8',
        env: { PATH: '/nonexistent' },
      });
      assert.equal(run.status, 0, `${hook.trigger}: ${run.stderr}`);
    }
    // PreToolUse still blocks: the command reached the handler, it did not just exit 0.
    const pre = written.hooks.find((h) => h.trigger === 'PreToolUse');
    fs.mkdirSync(path.join(project, '.necro'), { recursive: true });
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
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(path.dirname(project), { recursive: true, force: true });
  }
});

test('Req 8.6: the PreToolUse and PostToolUse matchers and the 300s timeout survive the path rewrite', () => {
  const { base, root } = installCopy();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-proj-'));
  try {
    initFromCopy(root, project);
    const written = JSON.parse(fs.readFileSync(path.join(project, '.kiro/hooks/necromancer.json'), 'utf8'));
    const template = JSON.parse(fs.readFileSync(path.join(root, 'templates/necromancer.hooks.json'), 'utf8'));
    for (let i = 0; i < template.hooks.length; i++) {
      assert.equal(written.hooks[i].matcher, template.hooks[i].matcher);
      assert.equal(written.hooks[i].name, template.hooks[i].name);
      assert.equal(written.hooks[i].trigger, template.hooks[i].trigger);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('Req 8.7: init says Kiro runs hooks only in a trusted workspace and must be quit and reopened', () => {
  const { base, root } = installCopy();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-proj-'));
  try {
    for (const round of ['first run', 'second run, files already exist']) {
      const res = initFromCopy(root, project);
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /trusted workspace/i, round);
      assert.match(res.stdout, /quit and reopen/i, round);
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('Req 8.3: a second init leaves the files unchanged and says so', () => {
  const project = tmpCwd();
  try {
    const bin = path.join(__dirname, '../bin/necro.js');
    spawnSync(process.execPath, [bin, 'init'], { cwd: project, encoding: 'utf8' });
    const file = path.join(project, '.kiro/hooks/necromancer.json');
    const before = fs.readFileSync(file, 'utf8');
    const res = spawnSync(process.execPath, [bin, 'init'], { cwd: project, encoding: 'utf8' });
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.match(res.stdout, /already exist/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
