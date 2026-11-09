// Child process used by src/contracts.js. Runs one contract file through the
// node:test run() API and prints the structured result events as one JSON
// document on stdout. Req 4.12: results come from run() events, never from text
// the code under test prints. The contract file runs in its own subprocess
// (isolation 'process'), so everything it prints reaches this process only as
// test:stdout / test:stderr events. The stdout events are ignored. The stderr text
// is passed on, only to explain a file that did not load (Req 16.2); no result
// is ever read from it.
//
// Usage: node contract-runner.js <absolute contract file> <cwd>
import path from 'node:path';
import { run } from 'node:test';

const file = path.resolve(process.argv[2]);
const cwd = path.resolve(process.argv[3] || process.cwd());

// A skip or todo flag is a string reason or true; absent or false means not set.
function flagged(value) {
  return value !== undefined && value !== null && value !== false;
}

const events = [];
function record(ok, d) {
  const details = d.details || {};
  events.push({
    ok,
    name: String(d.name),
    nesting: d.nesting,
    kind: details.type === 'suite' ? 'suite' : 'test',
    skip: flagged(d.skip),
    todo: flagged(d.todo),
    failureType: (details.error && details.error.failureType) || null,
  });
}

// Req 16.2: what the contract file wrote to stderr, kept only to explain a file that did not load or crashed. It
// is never read as a result. At most 64 KB are kept.
const STDERR_LIMIT = 64 * 1024;
let stderr = '';

const stream = run({ files: [file], cwd, isolation: 'process' });
stream.on('test:pass', (d) => record(true, d));
stream.on('test:fail', (d) => record(false, d));
stream.on('test:stderr', (d) => {
  if (stderr.length < STDERR_LIMIT) stderr += String(d.message);
});
// Drain the stream so the run completes.
// eslint-disable-next-line no-unused-vars
for await (const _event of stream);

process.stdout.write(JSON.stringify({ file, events, stderr: stderr.slice(0, STDERR_LIMIT) }));
