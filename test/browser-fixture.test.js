import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForEndpoint } from './fixtures/browser.js';

// The wait for the browser: an empty or half-written DevToolsActivePort must not end it at once.

function tempProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'necro-wait-'));
}

test('the wait keeps trying while DevToolsActivePort is empty and returns the endpoint once it is filled', async () => {
  const profile = tempProfile();
  const file = path.join(profile, 'DevToolsActivePort');
  fs.writeFileSync(file, '');
  setTimeout(() => fs.writeFileSync(file, '4321\n/devtools/browser/abc\n'), 200);
  try {
    assert.equal(await waitForEndpoint(profile), 'ws://127.0.0.1:4321/devtools/browser/abc');
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('the wait returns the endpoint at once when the file is complete from the start', async () => {
  const profile = tempProfile();
  fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '9\n/x\n');
  try {
    const started = Date.now();
    assert.equal(await waitForEndpoint(profile), 'ws://127.0.0.1:9/x');
    assert.ok(Date.now() - started < 1000);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
