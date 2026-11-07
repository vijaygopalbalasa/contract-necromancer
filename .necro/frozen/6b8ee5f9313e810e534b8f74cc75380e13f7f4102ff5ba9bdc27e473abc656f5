// Contract for Requirement 10 of the necro-core spec: the MCP server and the Kiro power.
//
// R10.1  WHEN a user runs `necro mcp` THE SYSTEM SHALL serve the Model Context Protocol over stdio (JSON-RPC 2.0,
//        newline-delimited: initialize, notifications/initialized, tools/list, tools/call, ping) with no dependencies
//        beyond Node.js.
// R10.2  WHEN tools/list is called THE SYSTEM SHALL offer exactly three tools: necro_status, necro_check and necro_verify,
//        and each does what Requirement 10 says.
// R10.3  THE SYSTEM SHALL offer no tool that freezes a spec, edits a frozen file or ticks a task, and IF a tool call names
//        any other tool or a spec that is not frozen THEN it returns a tool error with one plain sentence, not a crash.
// R10.4  WHEN a tool takes a spec name or a receipt path THE SYSTEM SHALL refuse a name or path outside the project root.
// R10.5  WHEN the repository is installed as a Kiro power THE SYSTEM SHALL provide a power/ folder with plugin.json, mcp.json
//        and skills/contract-necromancer/SKILL.md.
//
// The tests start `necro mcp` as a child process in a temporary project (a frozen spec with two contracts and three tasks),
// write JSON-RPC lines to its stdin, close stdin and read the replies from stdout. They also read the files in `power/`.
// This file carries its own helpers.
//
// The receipt pins the files `necro mcp` uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/mcp.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'necro.js');
const POWER = path.join(REPO, 'power');
const VERSION = '2025-06-18';

// The test runner that runs this file sets NODE_TEST_* variables. A nested run must not see them.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function necro(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: cleanEnv() });
}

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function temp(fn) {
  const dirs = [];
  const make = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-mcp-'));
    dirs.push(d);
    return d;
  };
  return Promise.resolve()
    .then(() => fn(make))
    .finally(() => {
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    });
}

const HEAD = `import { test } from 'node:test';
import assert from 'node:assert/strict';
`;
// The first contract prints to stdout: the server's stdout must still hold only protocol messages.
const C1 = `${HEAD}test('R1.1 holds', () => { console.log('noise from the code under test'); assert.ok(true); });\n`;
const C2 = `${HEAD}test('R1.2 holds', () => { assert.ok(true); });\n`;
const TASKS = `# Tasks

- [x] 1. **First** (Req 1.1)
- [ ] 2. **Second** (Req 1.2)
- [ ] 3. **Third** (Req 1.1, 1.2)
`;

// A project with the frozen spec 'demo' and a spec 'draft' that is not frozen.
function project(make) {
  const cwd = make();
  put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  put(cwd, '.kiro/specs/demo/tasks.md', TASKS);
  put(cwd, 'contracts/demo/a.contract.test.js', C1);
  put(cwd, 'contracts/demo/b.contract.test.js', C2);
  put(cwd, '.kiro/specs/draft/requirements.md', '# Requirements: draft\n');
  put(cwd, 'contracts/draft/d.contract.test.js', C1);
  const frozen = necro(cwd, ['freeze', 'demo']);
  assert.equal(frozen.status, 0, `freeze failed: ${frozen.stderr}${frozen.stdout}`);
  return cwd;
}

const msg = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const call = (id, name, args) => msg(id, 'tools/call', { name, arguments: args });
const INIT = msg(1, 'initialize', { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 'contract', version: '0' } });

// Start `necro mcp` in `cwd`, write each entry as one line (objects as JSON, strings as given), close stdin
// and resolve with the raw stdout lines, the replies by id, the exit code and stderr.
function session(cwd, entries) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, 'mcp'], { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`necro mcp did not finish. stdout so far: ${stdout}`));
    }, 120000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      const lines = stdout.split('\n').filter((l) => l !== '');
      const replies = lines.map((l) => JSON.parse(l)); // a stdout line that is not JSON fails the test
      resolve({ lines, replies, byId: new Map(replies.map((r) => [r.id, r])), stderr, code });
    });
    for (const e of entries) child.stdin.write((typeof e === 'string' ? e : JSON.stringify(e)) + '\n');
    child.stdin.end();
  });
}

// The parsed JSON text of a tool result that is not an error.
function payload(reply) {
  assert.ok(reply, 'no reply');
  assert.equal(reply.error, undefined, JSON.stringify(reply));
  assert.notEqual(reply.result.isError, true, JSON.stringify(reply));
  assert.equal(reply.result.content[0].type, 'text');
  return JSON.parse(reply.result.content[0].text);
}

// The sentence of a tool error: a result with isError true and one line of text.
function toolError(reply) {
  assert.ok(reply, 'no reply');
  assert.equal(reply.error, undefined, JSON.stringify(reply));
  assert.equal(reply.result.isError, true, JSON.stringify(reply));
  const text = reply.result.content[0].text;
  assert.ok(text.length > 0 && !text.includes('\n'), `one plain sentence: ${JSON.stringify(text)}`);
  assert.match(text, /[.!]$/);
  return text;
}

// Every file under cwd with its text, to see that a call changed nothing.
function snapshot(cwd) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(cwd, abs)] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(cwd);
  return out;
}

test('R10.1 necro mcp answers initialize, ignores notifications, answers ping and tools/list, and exits 0 when stdin closes, writing only JSON-RPC messages to stdout and using no dependencies', () =>
  temp(async (make) => {
    const cwd = project(make);
    const { lines, byId, code, replies } = await session(cwd, [
      INIT,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      msg(2, 'ping'),
      msg(3, 'tools/list'),
      call(4, 'necro_check', { spec: 'demo' }),
      msg(5, 'no/such/method'),
    ]);
    assert.equal(code, 0);
    assert.deepEqual(replies.map((r) => r.id), [1, 2, 3, 4, 5]); // the notification got no reply
    for (const r of replies) assert.equal(r.jsonrpc, '2.0');
    assert.equal(byId.get(1).result.protocolVersion, VERSION);
    assert.ok(byId.get(1).result.capabilities.tools);
    assert.equal(byId.get(1).result.serverInfo.name, 'necro');
    assert.deepEqual(byId.get(2).result, {});
    assert.ok(Array.isArray(byId.get(3).result.tools));
    assert.equal(byId.get(5).error.code, -32601);
    assert.ok(!lines.join('\n').includes('noise from the code under test'), 'code under test must not reach stdout');

    // No dependencies beyond Node.js: package.json lists none and the server imports only node: and project files.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
    const src = fs.readFileSync(path.join(REPO, 'src', 'mcp.js'), 'utf8');
    const specifiers = [...src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(specifiers.length > 0);
    for (const s of specifiers) assert.ok(s.startsWith('node:') || s.startsWith('./'), s);
  }));

test('R10.2 tools/list offers exactly necro_status, necro_check and necro_verify with input schemas, and each tool returns what Requirement 10 says', () =>
  temp(async (make) => {
    const cwd = project(make);
    const first = await session(cwd, [INIT, msg(2, 'tools/list'), call(3, 'necro_check', { spec: 'demo' })]);
    const tools = first.byId.get(2).result.tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), ['necro_check', 'necro_status', 'necro_verify']);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, 'object');
      assert.equal(typeof t.inputSchema.properties, 'object');
      assert.ok(t.description.length > 0);
    }

    // necro_check runs every contract, returns the results and the receipt path, and writes the receipt.
    const checked = payload(first.byId.get(3));
    assert.equal(checked.passed, true);
    assert.deepEqual(checked.results.map((r) => [r.name, r.result]).sort(), [['R1.1 holds', 'pass'], ['R1.2 holds', 'pass']]);
    assert.match(checked.receipt, /^\.necro\/receipts\/demo\/[0-9a-f]{64}\.json$/);
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, checked.receipt), 'utf8'));
    assert.equal(receipt.spec, 'demo');
    assert.equal(receipt.task, null);
    assert.equal(path.basename(checked.receipt, '.json'), receipt.receiptHash);

    // necro_status lists each task with its ticked state, the contracts it requires and each result; it changes nothing.
    const before = snapshot(cwd);
    const second = await session(cwd, [INIT, call(2, 'necro_status', { spec: 'demo' }), call(3, 'necro_status', {})]);
    assert.deepEqual(snapshot(cwd), before);
    const status = payload(second.byId.get(2)).specs[0];
    assert.deepEqual(payload(second.byId.get(3)).specs.map((s) => s.spec), ['demo']);
    assert.deepEqual(status.contracts.map((c) => [c.name, c.result]).sort(), [['R1.1 holds', 'pass'], ['R1.2 holds', 'pass']]);
    const task = (id) => status.tasks.find((t) => t.id === id);
    assert.deepEqual(status.tasks.map((t) => t.id), ['1', '2', '3']);
    assert.deepEqual([task('1').ticked, task('2').ticked, task('3').ticked], [true, false, false]);
    assert.deepEqual(task('2').required, [{ name: 'R1.2 holds', result: 'pass' }]);
    assert.deepEqual(task('3').required.map((c) => c.name).sort(), ['R1.1 holds', 'R1.2 holds']);

    // necro_verify returns the verdict and the message.
    const verified = await session(cwd, [INIT, call(2, 'necro_verify', { receipt: checked.receipt })]);
    const verdict = payload(verified.byId.get(2));
    assert.equal(verdict.verdict, 'CONFIRMED');
    assert.match(verdict.message, /^CONFIRMED [0-9a-f]{64}/);
    put(cwd, 'contracts/demo/a.contract.test.js', `${C1}// changed\n`);
    const changed = payload((await session(cwd, [INIT, call(2, 'necro_verify', { receipt: checked.receipt })])).byId.get(2));
    assert.equal(changed.verdict, 'MISMATCH');
    assert.ok(changed.message.includes('contracts/demo/a.contract.test.js'), changed.message);
  }));

test('R10.3 no tool freezes, edits or ticks, and an unknown tool, an unfrozen spec and malformed JSON each get an error reply while the server keeps running', () =>
  temp(async (make) => {
    const cwd = project(make);
    const before = snapshot(cwd);
    const { byId, replies, code } = await session(cwd, [
      INIT,
      msg(2, 'tools/list'),
      call(3, 'necro_freeze', { spec: 'draft' }),
      call(4, 'task_update', { taskId: '2', status: 'completed' }),
      call(5, 'necro_check', { spec: 'draft' }),
      call(6, 'necro_status', { spec: 'draft' }),
      '{this is not json',
      call(7, 'necro_check', {}),
      msg(8, 'ping'),
    ]);
    const names = byId.get(2).result.tools.map((t) => t.name.toLowerCase());
    assert.equal(names.length, 3);
    for (const n of names) assert.doesNotMatch(n, /freeze|edit|write|tick|done|complete|update|task/);
    for (const id of [3, 4, 5, 6, 7]) toolError(byId.get(id));
    assert.match(toolError(byId.get(5)), /draft/);
    assert.match(toolError(byId.get(5)), /frozen/);
    const parseError = replies.find((r) => r.error && r.error.code === -32700);
    assert.ok(parseError, 'malformed JSON gets a parse error reply');
    assert.equal(parseError.id, null);
    assert.deepEqual(byId.get(8).result, {}); // the server was still running
    assert.equal(code, 0);
    assert.deepEqual(snapshot(cwd), before, 'nothing on disk changed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, '.necro/lock.json'), 'utf8')).specs.draft, undefined);
  }));

test('R10.4 a spec name or receipt path outside the project root is refused, also through ../ and a symbolic link', () =>
  temp(async (make) => {
    const cwd = project(make);
    const outside = make();
    put(outside, '.kiro/specs/demo/requirements.md', 'outside\n');
    const first = await session(cwd, [INIT, call(2, 'necro_check', { spec: 'demo' })]);
    const receipt = payload(first.byId.get(2)).receipt;
    const outsideReceipt = path.join(outside, 'receipt.json');
    fs.copyFileSync(path.join(cwd, receipt), outsideReceipt);
    fs.symlinkSync(outsideReceipt, path.join(cwd, 'linked.json'));

    const specs = ['../demo', '..', 'a/b', outside, path.join(outside, '.kiro/specs/demo')];
    const receipts = [outsideReceipt, path.relative(cwd, outsideReceipt), 'linked.json', '/etc/hosts', path.join(cwd, '..')];
    const entries = [INIT];
    specs.forEach((s, i) => {
      entries.push(call(10 + i, 'necro_check', { spec: s }));
      entries.push(call(30 + i, 'necro_status', { spec: s }));
    });
    receipts.forEach((p, i) => entries.push(call(50 + i, 'necro_verify', { receipt: p })));
    entries.push(msg(99, 'ping'));
    const { byId } = await session(cwd, entries);
    specs.forEach((_, i) => {
      toolError(byId.get(10 + i));
      toolError(byId.get(30 + i));
    });
    receipts.forEach((_, i) => assert.match(toolError(byId.get(50 + i)), /project/i));
    assert.deepEqual(byId.get(99).result, {});
    assert.ok(!fs.existsSync(path.join(outside, '.necro')), 'nothing was written outside the project');
  }));

test('R10.5 power/ holds plugin.json with the Agent Plugins 1.0.0 fields, mcp.json that starts necro mcp, and a SKILL.md that teaches the workflow', () => {
  const json = (rel) => JSON.parse(fs.readFileSync(path.join(POWER, rel), 'utf8'));

  const plugin = json('plugin.json');
  assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.match(plugin.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(typeof plugin.description === 'string' && plugin.description.length > 0);
  assert.ok(plugin.author && typeof plugin.author.name === 'string' && plugin.author.name.length > 0);
  assert.ok(Array.isArray(plugin.keywords) && plugin.keywords.length > 0);
  assert.ok(plugin.keywords.every((k) => typeof k === 'string' && k.length > 0));

  const mcp = json('mcp.json');
  const servers = Object.values(mcp.mcpServers);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].type, 'stdio');
  assert.equal(servers[0].command, 'necro');
  assert.deepEqual(servers[0].args, ['mcp']);

  const skill = fs.readFileSync(path.join(POWER, 'skills', 'contract-necromancer', 'SKILL.md'), 'utf8');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  assert.ok(front, 'SKILL.md starts with front matter');
  assert.match(front[1], /^name: contract-necromancer$/m);
  assert.match(front[1], /^description: \S/m);
  const body = skill.slice(front[0].length);
  assert.match(body, /EARS/);
  assert.match(body, /draft/i);
  assert.match(body, /review/i);
  assert.match(body, /person[\s\S]{0,60}freez|freez[\s\S]{0,60}person/i);
  assert.match(body, /never[\s\S]{0,40}necro freeze|do not[\s\S]{0,40}necro freeze/i);
  assert.match(body, /necro_status/);
  assert.match(body, /before[\s\S]{0,60}tick/i);
  assert.match(body, /necro_check/);
  assert.match(body, /necro_verify/);
});
