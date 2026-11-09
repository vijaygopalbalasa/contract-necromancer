// Contracts for R5.3 of the receipt-viewer spec: the copyable command takes its verifier from the official repository
// vijaygopalbalasa/contract-necromancer at one fixed commit named in the command, never from the repository being
// verified, and the page says next to the command that verifying runs the project's own contracts.
//
// The module under test is loaded with a dynamic import so this file always loads and the contract names are always
// registered. Dynamic imports are not followed by necro's import tracing, so the module is also named below the way a
// static import would name it. Keep this line: the receipt pins files it finds this way.
//   import {} from '../../site/lib/repo.js';
//
// The second contract runs the command offline. Git is told, through GIT_CONFIG_* variables, that the GitHub address of
// the project being verified means a local repository that ships a bin/necro.js which always prints CONFIRMED, and that
// the GitHub address of the official repository means this repository. The command text is exactly what the page shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const REPO_URL = new URL('../../site/lib/repo.js', import.meta.url);
const PAGE_URL = new URL('../../site/index.html', import.meta.url);
const OFFICIAL = 'vijaygopalbalasa/contract-necromancer';
const OFFICIAL_CLONE_URL = `https://github.com/${OFFICIAL}.git`;
const SYSTEM_PATH = '/usr/bin:/bin';
const FOREIGN = 'someone/project';
const FOREIGN_HASH = 'a'.repeat(64);

function which(name, searchPath) {
  for (const dir of searchPath.split(':')) {
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      // not in this folder
    }
  }
  return null;
}

function commandOf(result) {
  return typeof result === 'string' ? result : result && result.command;
}

// The command pieces, split on the && between steps. The steps this contract looks at contain no quoted &&.
function steps(command) {
  return command.split(' && ');
}

const SAMPLE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

test('R5.3 the command takes the verifier from vijaygopalbalasa/contract-necromancer at one fixed commit, inside the folder it clones, never from the repository being verified', async () => {
  const { verifyCommand } = await import(REPO_URL.href);
  const receiptFor = (spec, gitCommit) => ({ spec, gitCommit, receiptHash: 'b'.repeat(64) });

  const pins = new Set();
  for (const [repo, receipt] of [
    [FOREIGN, receiptFor('demo', SAMPLE_COMMIT)],
    [FOREIGN, receiptFor('demo', null)],
    ['octo/spec-repo', receiptFor('other-spec', 'f'.repeat(40))],
    ['', receiptFor('demo', SAMPLE_COMMIT)],
    [OFFICIAL, receiptFor('receipt-viewer', SAMPLE_COMMIT)],
  ]) {
    const command = commandOf(verifyCommand({ repo, receipt }));
    assert.equal(typeof command, 'string', 'verifyCommand must give the command as a string');
    assert.ok(!/[\r\n]/.test(command), 'the command must be one line');
    const list = steps(command);

    // The folder the command clones, then the verifier cloned inside it.
    const project = list.findIndex((s) => s.startsWith('git clone ') && s.endsWith(' necro-check'));
    const enter = list.indexOf('cd necro-check');
    const verifierClone = list.findIndex((s, i) => i > enter && s.startsWith(`git clone ${OFFICIAL_CLONE_URL} `));
    assert.ok(project >= 0 && enter > project, `the command must clone the project and enter necro-check: ${command}`);
    assert.ok(verifierClone > enter, `the command must clone ${OFFICIAL_CLONE_URL} after it enters necro-check: ${command}`);
    const verifierDir = list[verifierClone].slice(`git clone ${OFFICIAL_CLONE_URL} `.length);
    assert.match(verifierDir, /^[A-Za-z0-9_.-]+$/, 'the verifier folder must be a plain relative name inside the clone');
    assert.ok(!verifierDir.startsWith('/') && !verifierDir.includes('..'), 'the verifier folder must stay inside the clone');

    // One fixed commit, a full commit id and not a branch or tag, checked out right after the clone.
    const pin = list.findIndex((s) => s.startsWith(`git -C ${verifierDir} checkout `));
    assert.equal(pin, verifierClone + 1, 'the pinned commit must be checked out right after the verifier is cloned');
    const commit = list[pin].slice(`git -C ${verifierDir} checkout `.length);
    assert.match(commit, /^[0-9a-f]{40}$/, 'the verifier commit must be a full 40-character commit id');
    pins.add(commit);

    // It is fetched after the project's own checkouts, so nothing in the project can replace it, and before it is used.
    const lastProjectCheckout = Math.max(...list.map((s, i) => (/^git checkout /.test(s) ? i : -1)), enter);
    assert.ok(verifierClone > lastProjectCheckout, 'the verifier must be cloned after the project is checked out');

    // necro runs the verifier copy, and that is the only bin/necro.js in the command.
    const define = list.findIndex((s) => /^necro\(\) \{/.test(s));
    assert.ok(define > pin, 'necro must be defined after the verifier is checked out');
    assert.equal(list[define], `necro() { node ${verifierDir}/bin/necro.js "$@"; }`);
    assert.equal(command.split('bin/necro.js').length, 2, 'the command must name bin/necro.js once, inside the verifier folder');
    const verify = list.findIndex((s) => s.startsWith('necro verify '));
    assert.ok(verify > define, 'necro verify must come after necro is defined');
    assert.equal(command.split('necro verify').length, 2, 'necro verify appears once');
  }
  assert.equal(pins.size, 1, 'the verifier commit is one fixed commit, the same for every repository and receipt');

  // The commit is a real commit of this repository's history. Whether it is on GitHub is checked by hand.
  const [commit] = pins;
  const git = which('git', `${SYSTEM_PATH}:${process.env.PATH ?? ''}`);
  assert.ok(git, 'git is needed to run this contract');
  const type = spawnSync(git, ['cat-file', '-t', commit], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(type.stdout.trim(), 'commit', `the verifier commit ${commit} is not in this repository; fetch the full history`);
  const hasVerifier = spawnSync(git, ['cat-file', '-e', `${commit}:bin/necro.js`], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(hasVerifier.status, 0, `the verifier commit ${commit} holds no bin/necro.js`);
});

test("R5.3 a project that ships its own bin/necro.js that always prints CONFIRMED cannot make the command print CONFIRMED", async () => {
  const { verifyCommand } = await import(REPO_URL.href);
  const git = which('git', `${SYSTEM_PATH}:${process.env.PATH ?? ''}`);
  assert.ok(git, 'git is needed to run this contract');
  const sh = which('sh', SYSTEM_PATH);
  assert.ok(sh, 'this machine has no sh');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-pinned-verifier-'));
  try {
    const identity = {
      GIT_AUTHOR_NAME: 'pinned verifier',
      GIT_AUTHOR_EMAIL: 'pinned-verifier@example.invalid',
      GIT_COMMITTER_NAME: 'pinned verifier',
      GIT_COMMITTER_EMAIL: 'pinned-verifier@example.invalid',
    };
    const baseEnv = { PATH: SYSTEM_PATH, HOME: temp, LANG: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...identity };
    const run = (cwd, args) => {
      const r = spawnSync(git, args, { cwd, env: baseEnv, encoding: 'utf8' });
      assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
      return r.stdout.trim();
    };

    // The project being verified: its bin/necro.js says CONFIRMED whatever it is given. Commit 1 holds the code, commit 2
    // adds the receipt, as the gate does (a receipt is written after the commit it names).
    const fake = path.join(temp, 'fake-project');
    fs.mkdirSync(path.join(fake, 'bin'), { recursive: true });
    run(fake, ['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(fake, 'bin', 'necro.js'), "console.log('CONFIRMED FAKE-VERIFIER-RAN');\nprocess.exit(0);\n");
    run(fake, ['add', '.']);
    run(fake, ['commit', '-q', '-m', 'code']);
    const codeCommit = run(fake, ['rev-parse', 'HEAD']);
    const receipt = {
      spec: 'demo',
      gitCommit: codeCommit,
      requirements: { path: '.kiro/specs/demo/requirements.md', sha256: 'c'.repeat(64) },
      contracts: [{ name: 'R1.1 always passes', result: 'pass' }],
      receiptHash: FOREIGN_HASH,
    };
    const receiptPath = path.join(fake, '.necro', 'receipts', 'demo', `${FOREIGN_HASH}.json`);
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    run(fake, ['add', '.']);
    run(fake, ['commit', '-q', '-m', 'receipt']);

    const command = commandOf(verifyCommand({ repo: FOREIGN, receipt }));
    assert.equal(typeof command, 'string');
    assert.ok(command.includes(`git clone https://github.com/${FOREIGN}.git`), 'the command must clone the project being verified');

    const work = path.join(temp, 'work');
    fs.mkdirSync(work);
    const bin = path.join(temp, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(git, path.join(bin, 'git'));
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    const env = {
      ...baseEnv,
      PATH: `${bin}:${SYSTEM_PATH}`,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: `url.${fake}.insteadOf`,
      GIT_CONFIG_VALUE_0: `https://github.com/${FOREIGN}.git`,
      GIT_CONFIG_KEY_1: `url.${ROOT}.insteadOf`,
      GIT_CONFIG_VALUE_1: OFFICIAL_CLONE_URL,
      GIT_TERMINAL_PROMPT: '0',
    };
    const result = spawnSync(sh, ['-c', command], { cwd: work, env, encoding: 'utf8', timeout: 120_000 });
    const output = `${result.stdout}${result.stderr}`;

    // The project's own verifier must not have run, and its CONFIRMED must not be what the reviewer sees.
    assert.ok(!output.includes('FAKE-VERIFIER-RAN'), `the project's own bin/necro.js ran. Output:\n${output}`);
    assert.ok(!/^CONFIRMED\b/m.test(result.stdout), `the command printed CONFIRMED for a receipt no verifier confirmed. Output:\n${output}`);
    assert.notEqual(result.status, 0, `the command must not exit 0 for this receipt. Output:\n${output}`);

    // The verifier that ran is a checkout of the official repository at the commit the command names.
    const verifierDir = path.join(work, 'necro-check', '.necro-verifier');
    const named = command.match(/git -C (\S+) checkout ([0-9a-f]{40})/);
    assert.ok(named, 'the command must check out a full commit in the verifier folder');
    const folder = path.join(work, 'necro-check', named[1]);
    assert.ok(fs.existsSync(path.join(folder, 'bin', 'necro.js')), 'the verifier folder must hold bin/necro.js');
    assert.equal(run(folder, ['rev-parse', 'HEAD']), named[2], 'the verifier folder must be at the commit the command names');
    assert.ok(folder.startsWith(path.join(work, 'necro-check') + path.sep) || folder === verifierDir, 'the verifier folder must be inside the clone');
    const official = spawnSync(git, ['show', `${named[2]}:bin/necro.js`], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(official.status, 0, `${named[2]} holds no bin/necro.js in this repository`);
    assert.equal(fs.readFileSync(path.join(folder, 'bin', 'necro.js'), 'utf8'), official.stdout, 'the verifier is the official bin/necro.js at that commit');
    assert.deepEqual(fs.readdirSync(work).sort(), ['necro-check'], 'nothing outside the folder it clones');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("R5.3 the page says next to the command that verifying runs the project's own contracts, which is code from that repository", () => {
  const html = fs.readFileSync(PAGE_URL, 'utf8');
  const start = html.indexOf('id="command"');
  assert.ok(start > 0, 'the page must have the command element');
  // The run section holds the command; the warning must sit in the same section.
  const sectionStart = html.lastIndexOf('<section', start);
  const sectionEnd = html.indexOf('</section>', start);
  assert.ok(sectionStart >= 0 && sectionEnd > start, 'the command must sit in a section');
  const text = html.slice(sectionStart, sectionEnd).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /runs the project's own contracts, which is code from that repository/i, 'the warning must say verifying runs the project\'s own contracts, which is code from that repository');
  assert.match(text, /only for a repository you are willing to run/i, 'the warning must tell the reviewer to run it only for a repository they are willing to run');
  assert.ok(text.includes(OFFICIAL), `the page must name ${OFFICIAL} as the source of the verifier`);
  assert.match(text, /fixed commit/i, 'the page must say the verifier is at a fixed commit');
  assert.match(text, /never from the repository being verified/i, 'the page must say the verifier never comes from the repository being verified');
});
