import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleMessage } from '../src/mcp.js';

// Req 10.2, 6.13 to 6.15: every place that lists what `necro verify` prints names all five outcomes.

const root = new URL('../', import.meta.url);
const OUTCOMES = ['CONFIRMED', 'MISMATCH', 'SUPERSEDED', 'INCOMPLETE', 'OTHER PROJECT'];

function verifyListLines(file) {
  return fs
    .readFileSync(new URL(file, root), 'utf8')
    .split('\n')
    .filter((l) => /^necro verify <receipt>/.test(l.trim()))
    .map((l) => [file, l]);
}

function assertAllFive(label, text) {
  for (const word of OUTCOMES) assert.ok(text.includes(word), `${label} does not name ${word}`);
  if (/exit/i.test(text)) {
    for (const part of ['0', '1', '2']) assert.ok(text.includes(part), `${label} gives exit codes without ${part}`);
  }
}

test('the necro_verify description names the five outcomes', () => {
  const reply = handleMessage(process.cwd(), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const tool = reply.result.tools.find((t) => t.name === 'necro_verify');
  assert.ok(tool);
  assertAllFive('necro_verify description', tool.description);
});

test('README and docs lines that list the verify outcomes name all five', () => {
  const files = ['README.md', ...fs.readdirSync(new URL('docs/', root)).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
  const lines = files.flatMap(verifyListLines);
  assert.ok(lines.length >= 2, 'expected the README and docs/reference.md command lists');
  for (const [file, line] of lines) assertAllFive(`${file}: ${line.trim()}`, line);
});

test('docs/reference.md names the five outcomes where it says what verify prints for a receipt', () => {
  const text = fs.readFileSync(new URL('docs/reference.md', root), 'utf8');
  const line = text.split('\n').find((l) => l.includes('re-runs it and prints')) ?? '';
  const block = text.slice(text.indexOf('`necro verify` re-runs it'), text.indexOf('`necro verify` re-runs it') + 300);
  assertAllFive('docs/reference.md receipt step', line + block);
});
