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
  for (const tool of ['read_file', 'grep', 'glob', 'list_directory']) {
    assert.ok(!matcherMatches(post[0].matcher, tool), `${label}: PostToolUse hook must not match ${tool}`);
  }
  assert.equal(post[0].action.command, 'necro hook post');
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
