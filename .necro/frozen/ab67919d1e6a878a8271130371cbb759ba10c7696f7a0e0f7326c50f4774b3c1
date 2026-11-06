// Contracts for Requirement 7 (session summary): the Stop hook.
// R7.1.
//
// The test freezes two throwaway specs and one spec with nothing recorded, then calls `necro hook stop` the way Kiro
// does. This file carries its own helpers.
//
// The receipt pins the files the Stop hook uses. Keep these lines, necro reads `from '...'` text:
//   from '../../bin/necro.js'
//   from '../../src/hooks.js'
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

function necro(cwd, args, input) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, input, encoding: 'utf8', env: cleanEnv() });
}

function stop(cwd) {
  const payload = { session_id: 's-contract', hook_event_name: 'Stop', cwd };
  return necro(cwd, ['hook', 'stop'], JSON.stringify(payload));
}

function temp(fn) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-summary-'));
  try {
    return fn(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function put(cwd, rel, text) {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function freeze(cwd, spec) {
  const res = necro(cwd, ['freeze', spec]);
  assert.equal(res.status, 0, `freeze ${spec} failed: ${res.stderr}${res.stdout}`);
}

const HEAD = `import { test } from 'node:test';
import assert from 'node:assert/strict';
`;

test('R7.1 the Stop handler prints, for each frozen spec, the tasks marked done, the receipts, and the names of the contracts failing now', () =>
  temp((cwd) => {
    // alpha: all contracts pass; two tasks done of three; one receipt.
    put(cwd, '.kiro/specs/alpha/requirements.md', '# Requirements: alpha\n');
    put(cwd, 'contracts/alpha/a.contract.test.js', `${HEAD}test('R1.1 alpha holds', () => { assert.ok(true); });\n`);
    put(cwd, '.kiro/specs/alpha/tasks.md', '- [x] 1. One\n- [x] 2. Two\n- [ ] 3. Three\n');
    freeze(cwd, 'alpha');
    put(cwd, '.necro/receipts/alpha/aaaa.json', '{}');

    // demo: its contracts passed at freeze time, and one fails now; one task done; three receipts.
    put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
    put(
      cwd,
      'contracts/demo/d.contract.test.js',
      `${HEAD}import fs from 'node:fs';
test('R2.1 reads the data', () => {
  assert.equal(JSON.parse(fs.readFileSync(new URL('../../data.json', import.meta.url), 'utf8')).value, 1);
});
test('R2.2 always holds', () => { assert.ok(true); });
test('R2.3 reads the data too', () => {
  assert.equal(JSON.parse(fs.readFileSync(new URL('../../data.json', import.meta.url), 'utf8')).value, 1);
});
`,
    );
    put(cwd, 'data.json', '{"value": 1}\n');
    put(cwd, '.kiro/specs/demo/tasks.md', '- [x] 1. One\n- [ ] 2. Two\n');
    freeze(cwd, 'demo');
    for (const n of ['b1', 'b2', 'b3']) put(cwd, `.necro/receipts/demo/${n}.json`, '{}');
    put(cwd, 'data.json', '{"value": 2}\n'); // the world changed after freeze

    // gamma: frozen, with no tasks.md and no receipts.
    put(cwd, '.kiro/specs/gamma/requirements.md', '# Requirements: gamma\n');
    put(cwd, 'contracts/gamma/g.contract.test.js', `${HEAD}test('R3.1 gamma holds', () => { assert.ok(true); });\n`);
    freeze(cwd, 'gamma');

    const res = stop(cwd);
    assert.equal(res.status, 0, res.stderr);
    const out = `${res.stdout}${res.stderr}`;
    const lineOf = (spec) => out.split('\n').find((l) => l.startsWith(`Spec ${spec}:`));

    const alpha = lineOf('alpha');
    assert.ok(alpha, `a line for alpha: ${out}`);
    assert.match(alpha, /2 tasks done/);
    assert.match(alpha, /1 receipts/);
    assert.doesNotMatch(alpha, /failing/);

    const demo = lineOf('demo');
    assert.ok(demo, `a line for demo: ${out}`);
    assert.match(demo, /1 tasks done/);
    assert.match(demo, /3 receipts/);
    assert.match(demo, /failing/);
    assert.ok(demo.includes('R2.1 reads the data'), demo);
    assert.ok(demo.includes('R2.3 reads the data too'), demo);
    assert.ok(!demo.includes('R2.2 always holds'), 'a passing contract is not listed');

    const gamma = lineOf('gamma');
    assert.ok(gamma, `a line for gamma: ${out}`);
    assert.match(gamma, /0 tasks done/);
    assert.match(gamma, /0 receipts/);
    assert.doesNotMatch(gamma, /failing/);
  }));
