// Contracts for Requirement 7 (session summary), revised: the Stop hook.
// R7.1. This file replaces summary.contract.test.js, which expects Stop to run every contract; a person removes that one.
//
// The test freezes three throwaway specs, then calls `necro hook stop` the way Kiro does. Stop prints the tasks done
// and the receipts of each spec, names the contracts failing among those it ran for tasks ticked since the freeze,
// and when it ran none says so and names `necro audit`. This file carries its own helpers.
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
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-core-summary-v2-'));
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

// A contract file that passes while data.json says value 1, and fails when it says anything else.
function readsData(id, title) {
  return `${HEAD}import fs from 'node:fs';
test('${id} ${title}', () => {
  assert.equal(JSON.parse(fs.readFileSync(new URL('../../data.json', import.meta.url), 'utf8')).value, 1);
});
`;
}

test('R7.1 the Stop handler prints, for each frozen spec, the tasks done and the receipts; it runs only the contracts of tasks ticked since the freeze and names those failing, and when it ran none says so and names necro audit', () =>
  temp((cwd) => {
    put(cwd, 'data.json', '{"value": 1}\n');

    // alpha: two tasks ticked at the freeze, one receipt, nothing ticked since.
    put(cwd, '.kiro/specs/alpha/requirements.md', '# Requirements: alpha\n');
    put(cwd, 'contracts/alpha/a.contract.test.js', readsData('R1.1', 'alpha reads the data'));
    put(cwd, '.kiro/specs/alpha/tasks.md', '- [x] 1. One (Req 1.1)\n- [x] 2. Two (Req 1.1)\n- [ ] 3. Three (Req 1.1)\n');
    freeze(cwd, 'alpha');
    put(cwd, '.necro/receipts/alpha/aaaa.json', '{}');

    // demo: task 1 is ticked at the freeze, task 2 is ticked after it. Three receipts.
    put(cwd, '.kiro/specs/demo/requirements.md', '# Requirements: demo\n');
    put(cwd, 'contracts/demo/d1.contract.test.js', readsData('R2.1', 'old task reads the data'));
    put(cwd, 'contracts/demo/d2.contract.test.js', readsData('R3.1', 'new task reads the data'));
    put(cwd, 'contracts/demo/d3.contract.test.js', `${HEAD}test('R4.1 always holds', () => { assert.ok(true); });\n`);
    put(cwd, '.kiro/specs/demo/tasks.md', '- [x] 1. One (Req 2.1)\n- [ ] 2. Two (Req 3.1)\n- [ ] 3. Three (Req 4.1)\n');
    freeze(cwd, 'demo');
    for (const n of ['b1', 'b2', 'b3']) put(cwd, `.necro/receipts/demo/${n}.json`, '{}');
    put(cwd, '.kiro/specs/demo/tasks.md', '- [x] 1. One (Req 2.1)\n- [x] 2. Two (Req 3.1)\n- [ ] 3. Three (Req 4.1)\n');

    // gamma: frozen, with no tasks.md and no receipts.
    put(cwd, '.kiro/specs/gamma/requirements.md', '# Requirements: gamma\n');
    put(cwd, 'contracts/gamma/g.contract.test.js', readsData('R5.1', 'gamma reads the data'));
    freeze(cwd, 'gamma');

    // The world changes after the freeze: every contract that reads the data fails now.
    put(cwd, 'data.json', '{"value": 2}\n');

    const res = stop(cwd);
    assert.equal(res.status, 0, res.stderr);
    const out = `${res.stdout}${res.stderr}`;
    const lineOf = (spec) => out.split('\n').find((l) => l.startsWith(`Spec ${spec}:`));

    // Two ran nothing: the counts are there, a failing contract is not run or listed, and necro audit is named.
    for (const [spec, done] of [['alpha', 2], ['gamma', 0]]) {
      const line = lineOf(spec);
      assert.ok(line, `a line for ${spec}: ${out}`);
      assert.match(line, new RegExp(`${done} tasks done`));
      assert.match(line, spec === 'alpha' ? /1 receipts/ : /0 receipts/);
      assert.match(line, /no contract ran/, line);
      assert.ok(line.includes('necro audit'), `names necro audit: ${line}`);
      assert.doesNotMatch(line, /failing|passing/, `claims nothing about contracts it did not run: ${line}`);
    }
    assert.ok(!out.includes('R1.1 alpha reads the data'), 'a contract it did not run is not listed');
    assert.ok(!out.includes('R5.1 gamma reads the data'), 'a contract it did not run is not listed');

    // demo ran the contracts of task 2 only, and names the one failing among them.
    const demo = lineOf('demo');
    assert.ok(demo, `a line for demo: ${out}`);
    assert.match(demo, /2 tasks done/);
    assert.match(demo, /3 receipts/);
    assert.match(demo, /failing/);
    assert.ok(demo.includes('R3.1 new task reads the data'), demo);
    assert.ok(!demo.includes('R2.1 old task reads the data'), 'the contract of a task ticked at the freeze did not run');
    assert.ok(!demo.includes('R4.1 always holds'), 'a passing contract is not listed');
    assert.ok(!demo.includes('full check'), 'it ran a contract, so it does not say it ran none');
  }));
