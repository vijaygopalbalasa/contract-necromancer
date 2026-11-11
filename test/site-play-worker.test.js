import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const WORKER_URL = new URL('../site/lib/play-worker.js', import.meta.url);
const SOURCE = fs.readFileSync(WORKER_URL, 'utf8');

// The worker needs a worker scope. This is a small stand-in for one: it records what the worker sets up and posts.
function scope() {
  const s = { posted: [], listeners: {} };
  s.addEventListener = (type, fn) => {
    (s.listeners[type] ||= []).push(fn);
  };
  s.postMessage = (m) => s.posted.push(m);
  s.send = async (data) => {
    for (const fn of s.listeners.message || []) await fn({ data });
  };
  return s;
}

async function loadWorker() {
  const s = scope();
  globalThis.self = s;
  await import(`${WORKER_URL.href}?copy=${Math.random()}`);
  return s;
}

test('the worker listens for one message and answers a bad one with a sentence, without fetching anything', async () => {
  const before = globalThis.self;
  const s = await loadWorker();
  const realFetch = globalThis.fetch;
  try {
    assert.equal((s.listeners.message || []).length, 1, 'one message listener');
    let fetched = 0;
    globalThis.fetch = () => {
      fetched += 1;
      return Promise.reject(new Error('no network in this test'));
    };
    for (const bad of [{ run: 'x' }, 'planted', { run: 'planted', url: 'https://evil.example/x.js' }, null, { code: 'postMessage(1)' }]) {
      s.posted.length = 0;
      await s.send(bad);
      assert.equal(s.posted.length, 1, JSON.stringify(bad));
      assert.equal(s.posted[0].type, 'error');
      assert.match(s.posted[0].message, /^[^\n]+\.$/);
    }
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = realFetch;
    if (before === undefined) delete globalThis.self;
    else globalThis.self = before;
  }
});

test('the worker imports only the loader, runs no dynamic code, and reads nothing from the page', () => {
  const imports = [...SOURCE.matchAll(/^\s*import\b[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./play-loader.js']);
  assert.doesNotMatch(SOURCE, /\beval\s*\(|new Function|importScripts|innerHTML|document\./);
  assert.doesNotMatch(SOURCE, /location|\.search|URLSearchParams/, 'nothing is read from an address');
  // The only dynamic import takes a module URL the loader built, never a literal and never text from a message.
  assert.doesNotMatch(SOURCE, /import\s*\(\s*['"`]/);
});

test('the worker works out its folder from its own address, not from the message', () => {
  assert.match(SOURCE, /import\.meta\.url/);
});
