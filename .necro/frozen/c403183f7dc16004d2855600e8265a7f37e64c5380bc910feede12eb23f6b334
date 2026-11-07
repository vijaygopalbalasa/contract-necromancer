// Contract for Requirement 8.9 of the necro-core spec: `necro init` also writes a Kiro custom agent.
//
// R8.9  `necro init` writes .kiro/agents/necromancer.json: an agent that loads the steering file of 8.2 as a resource,
//       carries the PreToolUse, PostToolUse and Stop hooks of 8.1, and has permission rules that deny shell commands
//       running `necro freeze` and writes under `.necro/`. A second init leaves an existing file unchanged and says so.
//       The file passes `kiro-cli agent validate` when the Kiro CLI is installed.
//
// The test runs `necro init` in a throwaway project in a temp directory and reads back what it wrote. The permission
// rules are checked the way Kiro's engine reads shell patterns: `*` matches any sequence of characters and nothing
// else is special. Only the spellings of `necro freeze` that such a pattern can express are required (the word
// `freeze` one space after `necro`, `necro.js`, `necro.cmd`, `necro.exe` or `necro.ps1`, with or without a closing
// quote); extra spaces or a quoted `freeze` cannot be written as a glob, and the PreToolUse hook of 3.14 still
// blocks those. If the Kiro CLI is not installed the validate step is left out. This file carries its own helpers.
//
// The receipt pins the files `necro init` copies from. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../templates/necromancer.agent.json'
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

function init(project) {
  return spawnSync(process.execPath, [BIN, 'init'], { cwd: project, encoding: 'utf8', env: cleanEnv() });
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-agent-'));
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

const AGENT_REL = '.kiro/agents/necromancer.json';
const HOOKS_REL = '.kiro/hooks/necromancer.json';
const STEERING_REL = '.kiro/steering/necromancer.md';

// Kiro's shell patterns: `*` is any sequence of characters (newlines included), everything else is literal.
function shellGlobMatches(pattern, command) {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`, 's').test(command);
}

function denyPatterns(agent, capability) {
  return agent.permissions.rules
    .filter((rule) => rule.capability === capability && rule.effect === 'deny')
    .flatMap((rule) => rule.match || []);
}

test('R8.9 init writes .kiro/agents/necromancer.json with the steering resource, the three hooks, and deny rules for necro freeze and writes under .necro/; a second init leaves it unchanged and says so', () =>
  temp((project) => {
    const first = init(project);
    assert.equal(first.status, 0, first.stderr);
    const agentFile = path.join(project, AGENT_REL);
    assert.ok(fs.existsSync(agentFile), 'the agent file is written');
    const agent = JSON.parse(fs.readFileSync(agentFile, 'utf8'));

    // The steering file of 8.2 is a resource of the agent, and it exists.
    assert.ok(fs.existsSync(path.join(project, STEERING_REL)));
    assert.ok(agent.resources.includes('file://.kiro/steering/necromancer.md'), `resources: ${JSON.stringify(agent.resources)}`);

    // The three hooks of 8.1: same commands, matchers and timeouts as the hook file.
    const hooksFile = JSON.parse(fs.readFileSync(path.join(project, HOOKS_REL), 'utf8'));
    assert.deepEqual(agent.hooks, hooksFile.hooks);
    assert.deepEqual(agent.hooks.map((h) => h.trigger), ['PreToolUse', 'PostToolUse', 'Stop']);
    for (const hook of agent.hooks) assert.equal(hook.timeout, 300);

    // Shell commands that run `necro freeze` are denied; other necro commands are not.
    const shell = denyPatterns(agent, 'shell');
    const denied = (command) => shell.some((p) => shellGlobMatches(p, command));
    for (const command of [
      'necro freeze x',
      'node bin/necro.js freeze x',
      'node "/abs/path with space/bin/necro.js" freeze x',
      "node '/abs/path with space/bin/necro.js' freeze x",
      '"/usr/local/bin/node" "/abs/path with space/bin/necro.js" freeze x',
      'npm test && necro freeze x',
      'npm test; necro freeze x',
      'cat receipt.json | necro freeze x',
      'bash -c "necro freeze x"',
      "sh -c 'necro freeze x'",
      'echo start\nnecro freeze x\necho end',
      'npx necro freeze x',
      'necro.cmd freeze x',
      'necro.exe freeze x',
      'necro.ps1 freeze x',
    ]) {
      assert.ok(denied(command), `should deny ${JSON.stringify(command)}`);
    }
    for (const command of ['necro check x', 'necro verify r.json', 'necro init', 'node bin/necro.js check x', 'echo freeze', 'npm test']) {
      assert.ok(!denied(command), `should not deny ${JSON.stringify(command)}`);
    }

    // Writes under .necro/ are denied, and no rule allows anything.
    const writes = denyPatterns(agent, 'fs_write');
    assert.ok(writes.includes('.necro/**'), `fs_write deny patterns: ${JSON.stringify(writes)}`);
    assert.ok(writes.includes('**/.necro/**'), `fs_write deny patterns: ${JSON.stringify(writes)}`);
    for (const rule of agent.permissions.rules) assert.notEqual(rule.effect, 'allow', JSON.stringify(rule));

    // A second init leaves the file as it is, byte for byte, and says so.
    const edited = '{"name":"necromancer","description":"changed by a person"}\n';
    fs.writeFileSync(agentFile, edited);
    const second = init(project);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(agentFile, 'utf8'), edited);
    assert.match(second.stdout, /already exist/i);
    assert.match(second.stdout, /unchanged/i);
    assert.match(second.stdout, /agent/i);

    // The file passes the Kiro CLI's validation when the CLI is installed.
    fs.rmSync(agentFile);
    assert.equal(init(project).status, 0);
    const probe = spawnSync('kiro-cli', ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) {
      const validated = spawnSync('kiro-cli', ['agent', 'validate', '--path', agentFile], { cwd: project, encoding: 'utf8' });
      assert.equal(validated.status, 0, `kiro-cli agent validate: ${validated.stdout}${validated.stderr}`);
    }
  }));
