// Contract for R5.2 of the receipt-viewer spec: the copyable command, pasted into a POSIX shell on a machine with Git
// and Node.js but no global `necro`, runs to the verify result and changes nothing outside the folder it clones.
//
// The command is the one the page builds for the bundled risen sample (site/sample-receipt.json, repository
// vijaygopalbalasa/contract-necromancer). To run offline, git is told that the GitHub address of that repository means
// this local repository (url.<base>.insteadOf, set through GIT_CONFIG_* variables), so the command text itself is
// exactly what the page shows.
//
// The environment is built from nothing: a PATH whose first folder holds only `git` and `node`, then the system
// folders (asserted to hold no `necro`), a HOME that is an empty temp folder, and no global or system git config.
// Tests of the tool run in the clone, so a git identity is given through the environment.
//
// The module under test is loaded with a dynamic import so this file always loads and the contract name is always
// registered. Dynamic imports are not followed by necro's import tracing, so the module is also named below the way a
// static import would name it. Keep this line: the receipt pins files it finds this way.
//   import {} from '../../site/lib/repo.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const REPO_URL = new URL('../../site/lib/repo.js', import.meta.url);
const SAMPLE_URL = new URL('../../site/sample-receipt.json', import.meta.url);
const SAMPLE_REPO = 'vijaygopalbalasa/contract-necromancer';
const SYSTEM_PATH = '/usr/bin:/bin';

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

// sh runs the whole command, which re-runs every contract of the sample and takes about 40 seconds. bash and zsh, when
// this machine has them, run the same command up to the line that defines necro and must find necro defined there.
function shells() {
  const sh = which('sh', SYSTEM_PATH);
  assert.ok(sh, 'this machine has no sh');
  const others = ['bash', 'zsh'].map((name) => which(name, SYSTEM_PATH)).filter(Boolean);
  return [{ shell: sh, full: true }, ...others.map((shell) => ({ shell, full: false }))];
}

function listing(dir) {
  return fs.readdirSync(dir).sort();
}

test('R5.2 the command for the risen sample, pasted into sh with git and node but no necro, runs to CONFIRMED and changes nothing outside the folder it clones', async () => {
  const { verifyCommand } = await import(REPO_URL.href);
  const receipt = JSON.parse(fs.readFileSync(SAMPLE_URL, 'utf8'));
  const command = verifyCommand({ repo: SAMPLE_REPO, receipt });
  const text = typeof command === 'string' ? command : command && command.command;
  assert.equal(typeof text, 'string', 'verifyCommand must give the command as a string');
  assert.ok(!/[\r\n]/.test(text), 'the command must be one line');

  const git = which('git', `${SYSTEM_PATH}:${process.env.PATH ?? ''}`);
  assert.ok(git, 'git is needed to run this contract');
  assert.ok(fs.existsSync(path.join(ROOT, '.git')), 'this contract clones the repository it runs in, so it needs the .git folder');
  const known = spawnSync(git, ['cat-file', '-t', receipt.gitCommit], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(known.stdout.trim(), 'commit', `the sample's commit ${receipt.gitCommit} is not in this repository; fetch the full history`);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-fresh-clone-'));
  try {
    const bin = path.join(temp, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(git, path.join(bin, 'git'));
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    const searchPath = `${bin}:${SYSTEM_PATH}`;
    assert.equal(which('necro', searchPath), null, 'the PATH for this contract must hold no necro');

    for (const { shell, full } of shells()) {
      const label = path.basename(shell);
      const work = path.join(temp, `work-${label}`);
      const home = path.join(temp, `home-${label}`);
      fs.mkdirSync(work);
      fs.mkdirSync(home);
      const env = {
        PATH: searchPath,
        HOME: home,
        TMPDIR: temp,
        LANG: 'C',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.${ROOT}.insteadOf`,
        GIT_CONFIG_VALUE_0: `https://github.com/${SAMPLE_REPO}.git`,
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: 'fresh clone',
        GIT_AUTHOR_EMAIL: 'fresh-clone@example.invalid',
        GIT_COMMITTER_NAME: 'fresh clone',
        GIT_COMMITTER_EMAIL: 'fresh-clone@example.invalid',
      };
      const missing = spawnSync(shell, ['-c', 'command -v necro'], { cwd: work, env, encoding: 'utf8' });
      assert.notEqual(missing.status, 0, `${label}: necro must not be installed in this environment`);

      const verifyStep = text.indexOf(' && necro verify ');
      assert.ok(verifyStep > 0, 'the command must end with necro verify on the receipt');
      if (full) {
        const run = spawnSync(shell, ['-c', text], { cwd: work, env, encoding: 'utf8', timeout: 280_000 });
        const output = `${run.stdout}${run.stderr}`;
        assert.equal(run.status, 0, `${label}: the command must exit 0, it exited ${run.status}. Output:\n${output}`);
        assert.ok(
          run.stdout.includes(`CONFIRMED ${receipt.receiptHash}`),
          `${label}: the command must print CONFIRMED ${receipt.receiptHash}. Output:\n${output}`,
        );
      } else {
        const run = spawnSync(shell, ['-c', `${text.slice(0, verifyStep)} && command -v necro`], { cwd: work, env, encoding: 'utf8', timeout: 120_000 });
        assert.equal(run.status, 0, `${label}: the steps before necro verify must run and define necro. Output:\n${run.stdout}${run.stderr}`);
        assert.equal(run.stdout.trim(), 'necro', `${label}: necro must be a function the command defines`);
      }

      // Nothing outside the folder it clones: the folder the command ran in holds only necro-check, HOME is still
      // empty, and the folder with git and node is as it was.
      assert.deepEqual(listing(work), ['necro-check'], `${label}: the command left something besides necro-check in the folder it ran in`);
      assert.deepEqual(listing(home), [], `${label}: the command wrote into HOME`);
      assert.deepEqual(listing(bin), ['git', 'node'], `${label}: the command changed the folder with git and node`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
