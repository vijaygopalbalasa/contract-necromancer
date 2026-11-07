import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { freezeSpec } from '../src/lock.js';

const REPO = path.resolve(import.meta.dirname, '..');
const BIN = path.join(REPO, 'bin', 'necro.js');
const LATEST = '2025-06-18';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A contract that prints to stdout on purpose: the server's stdout must still hold
// nothing but JSON-RPC messages (Req 10.1).
const PASS_1 = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R1.1 holds', () => {
  console.log('noise from the code under test');
  assert.ok(true);
});
`;
const PASS_2 = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R1.2 holds', () => {
  assert.ok(true);
});
`;
const FAIL_2 = `import { test } from 'node:test';
import assert from 'node:assert/strict';

test('R1.2 holds', () => {
  assert.equal(1, 2);
});
`;

const TASKS = `# Tasks

- [x] 1. **First** (Req 1.1)
- [ ] 2. **Second** (Req 1.2)
- [ ] 3. **Third** (Req 1.1, 1.2)
`;

function write(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function tmp(prefix = 'necro-mcp-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A project with the frozen spec 'demo' (three tasks, two contracts) and a spec
// 'draft' that has requirements but is not frozen.
function project({ failing = false } = {}) {
  const cwd = tmp();
  write(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
  write(cwd, '.kiro/specs/demo/tasks.md', TASKS);
  write(cwd, 'contracts/demo/a.contract.test.js', PASS_1);
  write(cwd, 'contracts/demo/b.contract.test.js', failing ? FAIL_2 : PASS_2);
  write(cwd, '.kiro/specs/draft/requirements.md', '# Requirements: draft\n');
  write(cwd, 'contracts/draft/d.contract.test.js', PASS_1);
  freezeSpec(cwd, 'demo');
  return cwd;
}

// ---------------------------------------------------------------------------
// A client for `necro mcp`: send lines, close stdin, collect every stdout line.
// ---------------------------------------------------------------------------

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

const msg = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const call = (id, name, args) => msg(id, 'tools/call', { name, arguments: args });
const INIT = msg(1, 'initialize', {
  protocolVersion: LATEST,
  capabilities: {},
  clientInfo: { name: 'test', version: '0' },
});

// Each entry is an object (sent as one JSON line) or a string (sent as is, one line).
// Resolves with { lines, replies, byId, stderr, code }. `lines` are the raw stdout lines.
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
      const replies = lines.map((l) => JSON.parse(l)); // throws when a stdout line is not JSON
      resolve({ lines, replies, byId: new Map(replies.map((r) => [r.id, r])), stderr, code });
    });
    for (const e of entries) child.stdin.write((typeof e === 'string' ? e : JSON.stringify(e)) + '\n');
    child.stdin.end();
  });
}

// The parsed JSON text of a tool result, asserting it is not an error.
function payload(reply) {
  assert.ok(reply, 'no reply');
  assert.equal(reply.error, undefined, JSON.stringify(reply));
  assert.notEqual(reply.result.isError, true, JSON.stringify(reply));
  assert.equal(reply.result.content[0].type, 'text');
  return JSON.parse(reply.result.content[0].text);
}

// The sentence of a tool error: a result with isError true and one text block.
function toolError(reply) {
  assert.ok(reply, 'no reply');
  assert.equal(reply.error, undefined, JSON.stringify(reply));
  assert.equal(reply.result.isError, true, JSON.stringify(reply));
  assert.equal(reply.result.content.length, 1);
  assert.equal(reply.result.content[0].type, 'text');
  const text = reply.result.content[0].text;
  assert.ok(text.length > 0 && !text.includes('\n'), `one plain sentence: ${JSON.stringify(text)}`);
  assert.match(text, /[.!]$/);
  assert.doesNotMatch(text, /\bat .*\.js:\d+/, 'no stack trace');
  return text;
}

// ---------------------------------------------------------------------------
// Req 10.1: the protocol over stdio
// ---------------------------------------------------------------------------

test('R10.1 initialize is answered with the same id, the protocol version, the tools capability and server info', async () => {
  const cwd = tmp();
  try {
    const { byId, lines, code } = await session(cwd, [INIT]);
    assert.equal(code, 0);
    assert.equal(lines.length, 1);
    const r = byId.get(1);
    assert.equal(r.jsonrpc, '2.0');
    assert.equal(r.result.protocolVersion, LATEST);
    assert.ok(r.result.capabilities.tools);
    assert.equal(r.result.serverInfo.name, 'necro');
    assert.match(r.result.serverInfo.version, /^\d+\.\d+\.\d+/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.1 a protocol version the server does not know gets the latest one it supports', async () => {
  const cwd = tmp();
  try {
    const { byId } = await session(cwd, [msg(7, 'initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 't', version: '0' } })]);
    assert.equal(byId.get(7).result.protocolVersion, LATEST);
    const older = await session(cwd, [msg(8, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } })]);
    assert.equal(older.byId.get(8).result.protocolVersion, '2024-11-05');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.1 a notification gets no reply, and ping gets an empty result', async () => {
  const cwd = tmp();
  try {
    const { replies } = await session(cwd, [
      INIT,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/something/unknown' },
      msg(2, 'ping'),
    ]);
    assert.deepEqual(replies.map((r) => r.id), [1, 2]);
    assert.deepEqual(replies[1].result, {});
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.1 an unknown method gets a JSON-RPC error and the server keeps running', async () => {
  const cwd = tmp();
  try {
    const { byId, code } = await session(cwd, [msg(1, 'resources/list'), msg(2, 'ping')]);
    assert.equal(byId.get(1).error.code, -32601);
    assert.deepEqual(byId.get(2).result, {});
    assert.equal(code, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.1 the server exits with code 0 when stdin closes, and writes only JSON to stdout', async () => {
  const cwd = project();
  try {
    const { lines, code } = await session(cwd, [INIT, call(2, 'necro_check', { spec: 'demo' })]);
    assert.equal(code, 0);
    assert.equal(lines.length, 2);
    for (const l of lines) assert.doesNotThrow(() => JSON.parse(l));
    assert.ok(!lines.join('\n').includes('noise from the code under test'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.1 necro mcp uses no dependencies: package.json lists none', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  const src = fs.readFileSync(path.join(REPO, 'src', 'mcp.js'), 'utf8');
  const specifiers = [...src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0);
  for (const s of specifiers) assert.ok(s.startsWith('node:') || s.startsWith('./'), s);
});

// ---------------------------------------------------------------------------
// Req 10.2: exactly three tools
// ---------------------------------------------------------------------------

test('R10.2 tools/list offers exactly necro_status, necro_check and necro_verify, each with an input schema', async () => {
  const cwd = tmp();
  try {
    const { byId } = await session(cwd, [INIT, msg(2, 'tools/list')]);
    const tools = byId.get(2).result.tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), ['necro_check', 'necro_status', 'necro_verify']);
    for (const t of tools) {
      assert.equal(typeof t.description, 'string');
      assert.ok(t.description.length > 0);
      assert.equal(t.inputSchema.type, 'object');
      assert.equal(typeof t.inputSchema.properties, 'object');
    }
    const by = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema]));
    assert.deepEqual(by.necro_check.required, ['spec']);
    assert.equal(by.necro_check.properties.spec.type, 'string');
    assert.deepEqual(by.necro_verify.required, ['receipt']);
    assert.equal(by.necro_verify.properties.receipt.type, 'string');
    assert.equal(by.necro_status.properties.spec.type, 'string');
    assert.ok(!by.necro_status.required || by.necro_status.required.length === 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.2 necro_status on a frozen spec lists each task, whether it is ticked, the contracts it requires and each contract\'s result', async () => {
  const cwd = project();
  try {
    const { byId } = await session(cwd, [INIT, call(2, 'necro_status', { spec: 'demo' })]);
    const status = payload(byId.get(2));
    assert.equal(status.specs.length, 1);
    const demo = status.specs[0];
    assert.equal(demo.spec, 'demo');
    assert.deepEqual(demo.contracts.map((c) => [c.name, c.result]).sort(), [['R1.1 holds', 'pass'], ['R1.2 holds', 'pass']]);
    assert.ok(demo.contracts.every((c) => typeof c.path === 'string'));

    const task = (id) => demo.tasks.find((t) => t.id === id);
    assert.deepEqual(demo.tasks.map((t) => t.id), ['1', '2', '3']);
    assert.equal(task('1').ticked, true);
    assert.equal(task('2').ticked, false);
    assert.equal(task('3').ticked, false);
    assert.match(task('2').text, /Second/);
    assert.deepEqual(task('1').required, [{ name: 'R1.1 holds', result: 'pass' }]);
    assert.deepEqual(task('2').required, [{ name: 'R1.2 holds', result: 'pass' }]);
    assert.deepEqual(task('3').required.map((c) => c.name).sort(), ['R1.1 holds', 'R1.2 holds']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.2 necro_status without a spec covers every frozen spec, and shows a failing contract as fail', async () => {
  const cwd = project({ failing: true });
  try {
    const { byId } = await session(cwd, [INIT, call(2, 'necro_status', {}), call(3, 'necro_status')]);
    for (const id of [2, 3]) {
      const status = payload(byId.get(id));
      assert.deepEqual(status.specs.map((s) => s.spec), ['demo']);
      const demo = status.specs[0];
      assert.deepEqual(demo.contracts.map((c) => [c.name, c.result]).sort(), [['R1.1 holds', 'pass'], ['R1.2 holds', 'fail']]);
      const second = demo.tasks.find((t) => t.id === '2');
      assert.deepEqual(second.required, [{ name: 'R1.2 holds', result: 'fail' }]);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.2 necro_status changes nothing on disk', async () => {
  const cwd = project();
  try {
    const before = snapshot(cwd);
    const { byId } = await session(cwd, [INIT, call(2, 'necro_status', {})]);
    assert.equal(payload(byId.get(2)).specs.length, 1);
    assert.deepEqual(snapshot(cwd), before);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// All files under cwd, with their text, for before and after comparisons.
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

test('R10.2 necro_check runs the contracts, returns each result and the receipt path, and writes that receipt', async () => {
  const cwd = project();
  try {
    const tasksBefore = fs.readFileSync(path.join(cwd, '.kiro/specs/demo/tasks.md'), 'utf8');
    const { byId } = await session(cwd, [INIT, call(2, 'necro_check', { spec: 'demo' })]);
    const out = payload(byId.get(2));
    assert.equal(out.spec, 'demo');
    assert.equal(out.passed, true);
    assert.deepEqual(out.results.map((r) => [r.name, r.result]).sort(), [['R1.1 holds', 'pass'], ['R1.2 holds', 'pass']]);
    assert.match(out.receipt, /^\.necro\/receipts\/demo\/[0-9a-f]{64}\.json$/);
    const receipt = JSON.parse(fs.readFileSync(path.join(cwd, out.receipt), 'utf8'));
    assert.equal(receipt.spec, 'demo');
    assert.equal(receipt.task, null);
    assert.equal(path.basename(out.receipt, '.json'), receipt.receiptHash);
    assert.equal(fs.readFileSync(path.join(cwd, '.kiro/specs/demo/tasks.md'), 'utf8'), tasksBefore);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.2 necro_check on a failing contract reports passed false and still writes the receipt', async () => {
  const cwd = project({ failing: true });
  try {
    const { byId } = await session(cwd, [INIT, call(2, 'necro_check', { spec: 'demo' })]);
    const out = payload(byId.get(2));
    assert.equal(out.passed, false);
    assert.deepEqual(out.results.filter((r) => r.result === 'fail').map((r) => r.name), ['R1.2 holds']);
    assert.ok(fs.existsSync(path.join(cwd, out.receipt)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.2 necro_verify returns CONFIRMED for a receipt that holds and the message', async () => {
  const cwd = project();
  try {
    const first = await session(cwd, [INIT, call(2, 'necro_check', { spec: 'demo' })]);
    const receipt = payload(first.byId.get(2)).receipt;
    const { byId } = await session(cwd, [INIT, call(2, 'necro_verify', { receipt })]);
    const out = payload(byId.get(2));
    assert.equal(out.verdict, 'CONFIRMED');
    assert.match(out.message, /^CONFIRMED [0-9a-f]{64}/);
    // An absolute path works too.
    const abs = await session(cwd, [INIT, call(2, 'necro_verify', { receipt: path.join(cwd, receipt) })]);
    assert.equal(payload(abs.byId.get(2)).verdict, 'CONFIRMED');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.2 necro_verify returns MISMATCH when a pinned file changed, and SUPERSEDED when the spec was frozen again', async () => {
  const cwd = project();
  try {
    const first = await session(cwd, [INIT, call(2, 'necro_check', { spec: 'demo' })]);
    const receipt = payload(first.byId.get(2)).receipt;

    // Freezing again after new requirements: the old receipt describes an earlier freeze.
    fs.appendFileSync(path.join(cwd, '.kiro/specs/demo/requirements.md'), 'More.\n');
    freezeSpec(cwd, 'demo');
    const superseded = payload((await session(cwd, [INIT, call(2, 'necro_verify', { receipt })])).byId.get(2));
    assert.equal(superseded.verdict, 'SUPERSEDED');
    assert.match(superseded.message, /^SUPERSEDED/);

    // A pinned file that no longer matches the lock.
    fs.appendFileSync(path.join(cwd, 'contracts/demo/a.contract.test.js'), '// changed\n');
    const mismatch = payload((await session(cwd, [INIT, call(2, 'necro_verify', { receipt })])).byId.get(2));
    assert.equal(mismatch.verdict, 'MISMATCH');
    assert.match(mismatch.message, /^MISMATCH/);
    assert.ok(mismatch.message.includes('contracts/demo/a.contract.test.js'), mismatch.message);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Req 10.3: no tool that freezes, edits or ticks; errors are replies, not crashes
// ---------------------------------------------------------------------------

test('R10.3 no tool is offered that freezes a spec, edits a frozen file or ticks a task', async () => {
  const cwd = tmp();
  try {
    const { byId } = await session(cwd, [INIT, msg(2, 'tools/list')]);
    const names = byId.get(2).result.tools.map((t) => t.name.toLowerCase());
    for (const n of names) assert.doesNotMatch(n, /freeze|edit|write|tick|done|complete|update|task/);
    assert.equal(names.length, 3);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.3 an unknown tool, including freeze and tick, gets a tool error in one plain sentence and the server keeps running', async () => {
  const cwd = project();
  try {
    const before = snapshot(cwd);
    const { byId, code } = await session(cwd, [
      INIT,
      call(2, 'necro_freeze', { spec: 'draft' }),
      call(3, 'task_update', { taskId: '2', status: 'completed' }),
      call(4, 'nope', {}),
      call(5, '', {}),
      msg(6, 'tools/call', {}),
      msg(7, 'ping'),
    ]);
    for (const id of [2, 3, 4, 5, 6]) toolError(byId.get(id));
    assert.deepEqual(byId.get(7).result, {});
    assert.equal(code, 0);
    assert.deepEqual(snapshot(cwd), before);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, '.necro/lock.json'), 'utf8')).specs.draft, undefined);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.3 a spec that is not frozen, or that does not exist, gets a tool error in one plain sentence', async () => {
  const cwd = project();
  try {
    const { byId } = await session(cwd, [
      INIT,
      call(2, 'necro_status', { spec: 'draft' }),
      call(3, 'necro_check', { spec: 'draft' }),
      call(4, 'necro_check', { spec: 'missing' }),
      call(5, 'necro_status', { spec: 'missing' }),
      call(6, 'necro_check', { spec: 'constructor' }),
      call(7, 'necro_check', { spec: '__proto__' }),
      msg(8, 'ping'),
    ]);
    for (const id of [2, 3, 4, 5, 6, 7]) {
      const text = toolError(byId.get(id));
      assert.match(text, /not frozen|frozen/);
    }
    assert.match(toolError(byId.get(3)), /draft/);
    assert.deepEqual(byId.get(8).result, {});
    assert.ok(!fs.existsSync(path.join(cwd, '.necro/receipts/draft')));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.3 missing or wrongly typed arguments get a tool error, not a crash', async () => {
  const cwd = project();
  try {
    const { byId, code } = await session(cwd, [
      INIT,
      call(2, 'necro_check', {}),
      call(3, 'necro_check', { spec: 5 }),
      call(4, 'necro_check'),
      call(5, 'necro_verify', {}),
      call(6, 'necro_verify', { receipt: ['x'] }),
      call(7, 'necro_status', { spec: 5 }),
      msg(8, 'tools/call', { name: 'necro_check', arguments: 'demo' }),
      msg(9, 'ping'),
    ]);
    for (const id of [2, 3, 4, 5, 6, 7, 8]) toolError(byId.get(id));
    assert.deepEqual(byId.get(9).result, {});
    assert.equal(code, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.3 a receipt that does not exist or is not a receipt gets a tool error in one plain sentence', async () => {
  const cwd = project();
  try {
    write(cwd, 'junk.json', 'this is not json');
    write(cwd, 'empty.json', '{}');
    const { byId } = await session(cwd, [
      INIT,
      call(2, 'necro_verify', { receipt: 'nothing-here.json' }),
      call(3, 'necro_verify', { receipt: 'junk.json' }),
      call(4, 'necro_verify', { receipt: 'empty.json' }),
      msg(5, 'ping'),
    ]);
    toolError(byId.get(2));
    toolError(byId.get(3));
    // A JSON document that is no receipt is a MISMATCH verdict or a tool error, never a crash.
    assert.ok(byId.get(4).result);
    assert.deepEqual(byId.get(5).result, {});
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('R10.3 malformed JSON gets a parse error reply with a null id and the server keeps running', async () => {
  const cwd = tmp();
  try {
    const { replies, byId, code } = await session(cwd, [
      '{this is not json',
      '', // a blank line is ignored, not answered
      '[1, 2',
      '"just a string"',
      '42',
      '[]',
      '{"jsonrpc":"2.0","id":3}',
      msg(2, 'ping'),
    ]);
    assert.equal(replies[0].id, null);
    assert.equal(replies[0].error.code, -32700);
    assert.equal(replies[1].error.code, -32700);
    assert.equal(replies[2].error.code, -32600); // "just a string" is JSON but not a request
    assert.equal(replies[3].error.code, -32600); // 42
    assert.equal(replies[4].error.code, -32600); // [] (batches are not supported)
    assert.equal(byId.get(3).error.code, -32600); // no method
    assert.deepEqual(byId.get(2).result, {});
    assert.equal(code, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Req 10.4: nothing outside the project root
// ---------------------------------------------------------------------------

test('R10.4 a spec name that is a path, or climbs out of the project, is refused', async () => {
  const cwd = project();
  const outside = tmp('necro-mcp-outside-');
  try {
    write(outside, '.kiro/specs/demo/requirements.md', 'outside\n');
    const names = ['../demo', '..', '.', 'demo/../../x', 'a/b', 'a\\b', outside, path.join(outside, '.kiro/specs/demo'), '', 'demo\0x'];
    const entries = [INIT];
    names.forEach((n, i) => {
      entries.push(call(10 + i, 'necro_check', { spec: n }));
      entries.push(call(40 + i, 'necro_status', { spec: n }));
    });
    entries.push(msg(99, 'ping'));
    const { byId } = await session(cwd, entries);
    names.forEach((n, i) => {
      toolError(byId.get(10 + i));
      toolError(byId.get(40 + i));
    });
    assert.deepEqual(byId.get(99).result, {});
    assert.ok(!fs.existsSync(path.join(outside, '.necro')), 'nothing written outside the project');
    assert.ok(!fs.existsSync(path.join(cwd, '.necro/receipts/draft')));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('R10.4 a receipt path outside the project root is refused, including through ../ and a symbolic link', async () => {
  const cwd = project();
  const outside = tmp('necro-mcp-outside-');
  try {
    const first = await session(cwd, [INIT, call(2, 'necro_check', { spec: 'demo' })]);
    const receipt = payload(first.byId.get(2)).receipt;
    const outsideReceipt = path.join(outside, 'receipt.json');
    fs.copyFileSync(path.join(cwd, receipt), outsideReceipt);
    fs.symlinkSync(outsideReceipt, path.join(cwd, 'linked.json'));
    fs.symlinkSync(outside, path.join(cwd, 'linked-dir'));

    const paths = [
      outsideReceipt,
      path.relative(cwd, outsideReceipt),
      `../${path.basename(outside)}/receipt.json`,
      'linked.json',
      'linked-dir/receipt.json',
      '/etc/hosts',
      path.join(cwd, '..'),
    ];
    const entries = [INIT, ...paths.map((p, i) => call(10 + i, 'necro_verify', { receipt: p })), msg(99, 'ping')];
    const { byId } = await session(cwd, entries);
    paths.forEach((p, i) => {
      const text = toolError(byId.get(10 + i));
      assert.match(text, /project/i, p);
    });
    assert.deepEqual(byId.get(99).result, {});
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('R10.4 a receipt in a project with no lock of its own is not verified against a lock above the project root', async () => {
  const parent = project();
  try {
    const first = await session(parent, [INIT, call(2, 'necro_check', { spec: 'demo' })]);
    const receipt = payload(first.byId.get(2)).receipt;
    const inner = path.join(parent, 'inner');
    write(inner, 'receipt.json', fs.readFileSync(path.join(parent, receipt), 'utf8'));
    // The server runs in `inner`, which has no lock; `parent` has one.
    const { byId } = await session(inner, [INIT, call(2, 'necro_verify', { receipt: 'receipt.json' }), msg(3, 'ping')]);
    assert.match(toolError(byId.get(2)), /outside/);
    assert.deepEqual(byId.get(3).result, {});
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The CLI routes `mcp`
// ---------------------------------------------------------------------------

test('R10.1 the CLI usage message lists mcp', () => {
  const res = spawnSync(process.execPath, [BIN], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /\bmcp\b/);
});

// ---------------------------------------------------------------------------
// Req 10.5: the power folder
// ---------------------------------------------------------------------------

const POWER = path.join(REPO, 'power');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(POWER, rel), 'utf8'));
}

test('R10.5 power/plugin.json has the Agent Plugins 1.0.0 fields', () => {
  const p = readJson('plugin.json');
  assert.equal(p.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.match(p.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof p.description, 'string');
  assert.ok(p.description.length > 0);
  assert.equal(typeof p.author, 'object');
  assert.ok(typeof p.author.name === 'string' && p.author.name.length > 0);
  assert.ok(Array.isArray(p.keywords) && p.keywords.length > 0);
  for (const k of p.keywords) assert.ok(typeof k === 'string' && k.length > 0);
});

test('R10.5 power/mcp.json starts necro mcp over stdio', () => {
  const m = readJson('mcp.json');
  assert.equal(m.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  const servers = Object.values(m.mcpServers);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].type, 'stdio');
  assert.equal(servers[0].command, 'necro');
  assert.deepEqual(servers[0].args, ['mcp']);
});

test('R10.5 power/skills/contract-necromancer/SKILL.md has front matter and teaches the workflow', () => {
  const text = fs.readFileSync(path.join(POWER, 'skills', 'contract-necromancer', 'SKILL.md'), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(fm, 'front matter');
  assert.match(fm[1], /^name: contract-necromancer$/m);
  assert.match(fm[1], /^description: \S.*$/m);
  const body = text.slice(fm[0].length);
  assert.match(body, /EARS/);
  assert.match(body, /necro_status/);
  assert.match(body, /necro_check/);
  assert.match(body, /necro_verify/);
  assert.match(body, /draft/i);
  assert.match(body, /review/i);
  assert.match(body, /person[\s\S]{0,60}freez|freez[\s\S]{0,60}person/i);
  assert.match(body, /never[\s\S]{0,40}necro freeze|do not[\s\S]{0,40}necro freeze/i);
  assert.match(body, /before[\s\S]{0,60}tick/i);
});
