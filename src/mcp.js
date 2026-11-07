import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readLock, parseTasks, requiredNames, TASK_LINE, taskIdOf } from './lock.js';
import { runContracts } from './contracts.js';
import { runCheck } from './check.js';

// `necro mcp`: a Model Context Protocol server over stdio (Req 10.1). JSON-RPC 2.0,
// one message per line, nothing on stdout but MCP messages. Three tools (Req 10.2):
// necro_status, necro_check, necro_verify. None of them freezes a spec, edits a
// frozen file or ticks a task (Req 10.3), and every path they take stays inside the
// project root (Req 10.4). Only Node built-ins are used.

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const NECRO_BIN = fileURLToPath(new URL('../bin/necro.js', import.meta.url));

// JSON-RPC 2.0 error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

// A tool error: shown to the model as a result with isError true, in one plain sentence.
class ToolError extends Error {}

// A value quoted for a sentence: JSON escapes newlines and control characters, and long
// values are cut, so the sentence stays on one line.
function quote(value) {
  const text = String(value);
  return JSON.stringify(text.length > 60 ? `${text.slice(0, 60)}...` : text);
}

function serverVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ---------------------------------------------------------------------------
// Tool arguments
// ---------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A spec name is a plain folder name under .kiro/specs, never a path (Req 10.4).
const SPEC_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;

function specArg(args, { optional }) {
  if (args.spec === undefined && optional) return null;
  if (typeof args.spec !== 'string' || args.spec === '') {
    throw new ToolError("The 'spec' argument must be the name of a frozen spec, for example 'necro-core'.");
  }
  if (!SPEC_NAME.test(args.spec)) {
    throw new ToolError(`${quote(args.spec)} is not a spec name; give the plain folder name of a spec in this project, not a path.`);
  }
  return args.spec;
}

function frozenSpecs(root, only) {
  const lock = readLock(root);
  const specs = lock.specs && typeof lock.specs === 'object' ? lock.specs : {};
  if (only !== null) {
    if (!Object.hasOwn(specs, only)) {
      throw new ToolError(`The spec ${quote(only)} is not frozen, so a person must review its contracts and freeze it first.`);
    }
    return { lock, names: [only] };
  }
  return { lock, names: Object.keys(specs).sort() };
}

// ---------------------------------------------------------------------------
// necro_status
// ---------------------------------------------------------------------------

// The text of tasks.md with the task line of `id` ticked, to ask the gate what ticking it
// would require. Only the first unticked line with that id is changed.
function withTicked(markdown, id) {
  let done = false;
  return markdown
    .split('\n')
    .map((line) => {
      const m = done ? null : TASK_LINE.exec(line);
      if (m && m[1] === ' ' && taskIdOf(m[2].trim()) === id) {
        done = true;
        return line.replace('[ ]', '[x]');
      }
      return line;
    })
    .join('\n');
}

function readTasks(root, spec) {
  try {
    return fs.readFileSync(path.join(root, '.kiro', 'specs', spec, 'tasks.md'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

// What the gate would require for each task of a frozen spec, and where each stands now.
// `required` comes from the same rule the gate uses (requiredNames), so what this
// reports is what ticking the task would check.
function specStatus(root, lock, spec) {
  const results = runContracts(root, spec, lock);
  const resultOf = (name) => (results.filter((r) => r.name === name).some((r) => r.result !== 'pass') ? 'fail' : 'pass');
  const allNames = [...new Set(results.map((r) => r.name))];
  const withResults = (names) => names.map((name) => ({ name, result: resultOf(name) }));

  const table = (lock.specs[spec] && lock.specs[spec].tasks) || {};
  const markdown = readTasks(root, spec);
  const lines = parseTasks(markdown);

  // File order first, then recorded tasks the file no longer has.
  const order = [];
  for (const l of lines) if (Object.hasOwn(table, l.id) && !order.includes(l.id)) order.push(l.id);
  for (const id of Object.keys(table)) if (!order.includes(id)) order.push(id);

  const tasks = order.map((id) => {
    const found = lines.filter((l) => l.id === id);
    const ticked = found.length > 0 && found.every((l) => l.checked);
    let required = allNames;
    if (found.length === 1) {
      const after = found[0].checked ? markdown : withTicked(markdown, id);
      required = requiredNames(lock, spec, [found[0].text], after, allNames) || allNames;
    }
    return { id, text: found.length > 0 ? found[0].text : table[id].text, ticked, required: withResults(required) };
  });

  return {
    spec,
    contracts: results.map((r) => ({ name: r.name, path: r.path, result: r.result })),
    tasks,
  };
}

function necroStatus(root, args) {
  const { lock, names } = frozenSpecs(root, specArg(args, { optional: true }));
  return { specs: names.map((spec) => specStatus(root, lock, spec)) };
}

// ---------------------------------------------------------------------------
// necro_check
// ---------------------------------------------------------------------------

function necroCheck(root, args) {
  const spec = specArg(args, { optional: false });
  frozenSpecs(root, spec);
  const checked = runCheck(root, spec);
  const results = checked.results.map((r) => ({ name: r.name, result: r.result }));
  return {
    spec,
    passed: results.length > 0 && results.every((r) => r.result === 'pass'),
    results,
    receipt: checked.receipt,
  };
}

// ---------------------------------------------------------------------------
// necro_verify
// ---------------------------------------------------------------------------

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Real path of a path that may not exist: the nearest existing parent is resolved
// (following links) and the missing rest is appended.
function realLoose(p) {
  const rest = [];
  let dir = p;
  for (;;) {
    try {
      return path.join(fs.realpathSync(dir), ...rest.reverse());
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return p;
      rest.push(path.basename(dir));
      dir = parent;
    }
  }
}

// The absolute real path of a receipt the caller named, after checking it is inside the
// project root (Req 10.4), also through ../ and symbolic links.
function receiptInProject(root, given) {
  if (typeof given !== 'string' || given === '' || given.includes('\0')) {
    throw new ToolError("The 'receipt' argument must be the path of a receipt file in this project.");
  }
  const realRoot = realLoose(root);
  const real = realLoose(path.resolve(root, given));
  if (!inside(realRoot, real)) {
    throw new ToolError(`The path ${quote(given)} is outside the project root, so it was not read.`);
  }
  let isFile = false;
  try {
    isFile = fs.statSync(real).isFile();
  } catch {
    // missing
  }
  if (!isFile) throw new ToolError(`There is no receipt file at ${quote(given)} in this project.`);

  // verify takes the nearest folder above the receipt that holds a lock as the project
  // (Req 6.9). A lock above the project root would run someone else's contracts.
  for (let dir = path.dirname(real); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.necro', 'lock.json'))) {
      if (!inside(realRoot, dir)) {
        throw new ToolError(`The receipt ${quote(given)} belongs to a project outside this project root, so it was not verified.`);
      }
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  return real;
}

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

// `necro verify` runs as a child process: it prints its verdict with console.log, and
// stdout here belongs to the protocol.
function necroVerify(root, args) {
  const real = receiptInProject(root, args.receipt);
  const res = spawnSync(process.execPath, [NECRO_BIN, 'verify', real], {
    cwd: root,
    env: cleanEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = String(res.stdout || '').split('\n');
  const message = out.find((l) => /^(CONFIRMED|MISMATCH|SUPERSEDED)\b/.test(l));
  if (!message) throw new ToolError(`The file ${quote(args.receipt)} could not be read as a receipt.`);
  const project = out.find((l) => l.startsWith('Project: '));
  return {
    verdict: /^[A-Z]+/.exec(message)[0],
    message,
    ...(project ? { project: project.slice('Project: '.length) } : {}),
  };
}

// ---------------------------------------------------------------------------
// The tool list (Req 10.2) and the call
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'necro_status',
    title: 'Contract status',
    description:
      'For each frozen spec (or the one named), list every task with whether it is ticked, the contracts that ticking it requires, and the current pass or fail of each contract. Read-only. Call it before ticking a task.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'string', description: 'Name of a frozen spec. Leave out for every frozen spec.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'necro_check',
    title: 'Check a spec',
    description:
      'Run every frozen contract of a frozen spec and write a receipt, as `necro check <spec>` does. Returns each contract result and the receipt path. Does not change tasks.md.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: { type: 'string', description: 'Name of a frozen spec, for example necro-core.' },
      },
      required: ['spec'],
    },
  },
  {
    name: 'necro_verify',
    title: 'Verify a receipt',
    description:
      'Re-run a receipt as `necro verify <receipt>` does and return CONFIRMED, MISMATCH or SUPERSEDED with the message. The receipt must be inside the project.',
    inputSchema: {
      type: 'object',
      properties: {
        receipt: { type: 'string', description: 'Path of a receipt file in this project, for example .necro/receipts/<spec>/<hash>.json.' },
      },
      required: ['receipt'],
    },
    annotations: { readOnlyHint: true },
  },
];

const HANDLERS = { necro_status: necroStatus, necro_check: necroCheck, necro_verify: necroVerify };

// One plain sentence from an unexpected error.
function sentenceOf(name, e) {
  const first = String((e && e.message) || e).split('\n')[0].trim();
  return `${name} failed: ${first.replace(/[.!?]+$/, '')}.`;
}

function callTool(root, params) {
  const toolResult = (text, isError) => ({ content: [{ type: 'text', text }], isError });
  try {
    if (!isObject(params) || typeof params.name !== 'string') {
      throw new ToolError('A tool call needs the name of a tool: necro_status, necro_check or necro_verify.');
    }
    if (!Object.hasOwn(HANDLERS, params.name)) {
      throw new ToolError(`There is no tool called ${quote(params.name)}; the tools are necro_status, necro_check and necro_verify.`);
    }
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!isObject(args)) throw new ToolError('The arguments of a tool call must be a JSON object.');
    return toolResult(JSON.stringify(HANDLERS[params.name](root, args), null, 2), false);
  } catch (e) {
    const text = e instanceof ToolError ? e.message : sentenceOf(isObject(params) && typeof params.name === 'string' ? params.name : 'The tool', e);
    return toolResult(text, true);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// Handle one parsed message. Returns the reply object, or null when none is due
// (a notification, or a reply from the client).
export function handleMessage(root, message) {
  if (!isObject(message)) return failure(null, INVALID_REQUEST, 'A message must be a JSON object.');
  const hasId = Object.hasOwn(message, 'id');
  const idOk = typeof message.id === 'string' || typeof message.id === 'number';
  const id = hasId && idOk ? message.id : null;

  // A response to a request the server never sent: ignore.
  if (typeof message.method !== 'string' && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) return null;
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (hasId && !idOk)) {
    return failure(id, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request.');
  }
  // A notification gets no reply, known or not.
  if (!hasId) return null;

  switch (message.method) {
    case 'initialize': {
      const p = message.params;
      if (!isObject(p) || typeof p.protocolVersion !== 'string') {
        return failure(id, INVALID_PARAMS, 'initialize needs a protocolVersion.');
      }
      return reply(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'necro', title: 'Contract Necromancer', version: serverVersion() },
        instructions:
          'Call necro_status before ticking a task to see which frozen contracts it requires. Freezing a spec is a person\'s step; no tool here does it.',
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call':
      return reply(id, callTool(root, message.params));
    default:
      return failure(id, METHOD_NOT_FOUND, `Method not found: ${quote(message.method)}.`);
  }
}

// Handle one line of input. Returns the reply as a line of JSON, or null.
export function handleLine(root, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return JSON.stringify(failure(null, PARSE_ERROR, 'Parse error: the line is not valid JSON.'));
  }
  let out;
  try {
    out = handleMessage(root, message);
  } catch (e) {
    out = failure(isObject(message) && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null, -32603, sentenceOf('The server', e));
  }
  return out === null ? null : JSON.stringify(out);
}

// Serve MCP on stdin and stdout until stdin closes. Blank lines are ignored.
export function serve(root) {
  const write = (line) => process.stdout.write(`${line}\n`);
  process.stdout.on('error', () => process.exit(0));
  process.stdin.setEncoding('utf8');
  let buffer = '';
  const lineIn = (raw) => {
    const line = raw.trim();
    if (line === '') return;
    const out = handleLine(root, line);
    if (out !== null) write(out);
  };
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      lineIn(raw);
    }
  });
  process.stdin.on('end', () => {
    lineIn(buffer);
    buffer = '';
  });
}
