// Child process used by src/contracts.js. Runs one contract file through the
// node:test run() API and prints the structured result events as one JSON
// document on stdout. Req 4.12: results come from run() events, never from text
// the code under test prints. The contract file runs in its own subprocess
// (isolation 'process'), so everything it prints reaches this process only as
// test:stdout / test:stderr events. The stdout events are ignored. The stderr text
// is passed on, only to explain a file that did not load (Req 16.2); no result
// is ever read from it.
//
// Req 13.15: the contract file runs in a Node.js process started with --frozen-intrinsics, so code under test cannot patch a
// built-in prototype (String.prototype.split, Array.prototype.map) to change what the contract's own assertions see. A patch
// attempt throws in the code under test, which makes the contract fail instead of pass.
//
// Req 13.17: a second preload freezes the exports of node:assert, node:assert/strict and node:test before the contract file or
// any source module loads, so code under test cannot replace an assertion either (see FREEZE_ASSERTIONS below).
//
// Usage: node contract-runner.js <absolute contract file> <cwd>
import path from 'node:path';
import { run } from 'node:test';

// --frozen-intrinsics freezes the `console` object as well, and contracts that capture what a command printed assign to
// `console.log`. This module runs first in the contract's process and gives the global name `console` a copy whose methods
// can be assigned, so those contracts keep working. Only that one global is touched: every built-in prototype stays frozen.
const UNFREEZE_CONSOLE = `
const real = globalThis.console;
const copy = {};
for (const key of Reflect.ownKeys(real)) {
  const descriptor = Object.getOwnPropertyDescriptor(real, key);
  descriptor.configurable = true;
  if ('value' in descriptor) descriptor.writable = true;
  Object.defineProperty(copy, key, descriptor);
}
globalThis.console = copy;
`;

// Req 13.17: --frozen-intrinsics freezes the language's built-in prototypes, but node:assert, node:assert/strict and node:test
// are modules, and their exports are ordinary objects that code under test could change (`assert.ok = () => {}`). This module
// runs before the contract file and before any source module it imports. It freezes the module objects and the functions they
// hold (and the functions those hold, so `assert.strict.ok` is covered), so an attempt to replace, redefine or delete an
// assertion throws in code under test, which makes the contract fail instead of pass. In sloppy-mode code the write fails
// without an error and the real assertion stays in place. Accessors are not called; only values that are functions are
// followed, so a prototype, a mock tracker or other state of these modules is left as it is.
const FREEZE_ASSERTIONS = `
import assert from 'node:assert';
import strict from 'node:assert/strict';
import test from 'node:test';
const seen = new Set();
function freeze(value, depth) {
  if (typeof value !== 'function' && (typeof value !== 'object' || value === null)) return;
  if (seen.has(value)) return;
  seen.add(value);
  Object.freeze(value);
  if (depth === 0) return;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && typeof descriptor.value === 'function') freeze(descriptor.value, depth - 1);
  }
}
for (const module of [assert, strict, test]) freeze(module, 2);
`;
const EXEC_ARGV = [
  '--frozen-intrinsics',
  '--import', `data:text/javascript,${encodeURIComponent(UNFREEZE_CONSOLE)}`,
  '--import', `data:text/javascript,${encodeURIComponent(FREEZE_ASSERTIONS)}`,
];

const file = path.resolve(process.argv[2]);
const cwd = path.resolve(process.argv[3] || process.cwd());

// A skip or todo flag is a string reason or true; absent or false means not set.
function flagged(value) {
  return value !== undefined && value !== null && value !== false;
}

// Under --frozen-intrinsics the error of a failed test reaches this process without its `failureType`, so a suite that failed
// only because a child failed cannot be told apart that way. It is told apart by the events themselves: a child reports before
// its parent, so a failed event at nesting n+1 not yet claimed by a parent at nesting n is a failed child of that parent.
// `failedAt[n]` counts the failed events at nesting n that no parent has claimed yet.
const failedAt = [];
const events = [];
function record(ok, d) {
  const details = d.details || {};
  const kind = details.type === 'suite' ? 'suite' : 'test';
  const claimed = failedAt[d.nesting + 1] || 0;
  failedAt[d.nesting + 1] = 0;
  failedAt[d.nesting] = (failedAt[d.nesting] || 0) + (ok ? 0 : 1);
  let failureType = (details.error && details.error.failureType) || null;
  if (kind === 'suite' && !ok && claimed > 0) failureType = 'subtestsFailed';
  events.push({
    ok,
    name: String(d.name),
    nesting: d.nesting,
    kind,
    skip: flagged(d.skip),
    todo: flagged(d.todo),
    failureType,
  });
}

// Req 16.2: what the contract file wrote to stderr, kept only to explain a file that did not load or crashed. It
// is never read as a result. At most 64 KB are kept.
const STDERR_LIMIT = 64 * 1024;
let stderr = '';

const stream = run({ files: [file], cwd, isolation: 'process', execArgv: EXEC_ARGV });
stream.on('test:pass', (d) => record(true, d));
stream.on('test:fail', (d) => record(false, d));
stream.on('test:stderr', (d) => {
  if (stderr.length < STDERR_LIMIT) stderr += String(d.message);
});
// Drain the stream so the run completes.
// eslint-disable-next-line no-unused-vars
for await (const _event of stream);

process.stdout.write(JSON.stringify({ file, events, stderr: stderr.slice(0, STDERR_LIMIT) }));
