// Contracts for site/lib/repo.js: R1.2 and R5.1 of the receipt-viewer spec.
//
// The module under test is loaded with a dynamic import inside each test, so this file always loads and every
// contract name is registered even while the viewer does not exist yet.
//
// Dynamic imports are not followed by necro's import tracing, so the module is also named below the way a static
// import would name it. Keep this line: the receipt pins files it finds this way.
//   import {} from '../../site/lib/repo.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const REPO_URL = new URL('../../site/lib/repo.js', import.meta.url);

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const RAW = 'https://raw.githubusercontent.com/octo/spec-repo/main/.necro/receipts/demo/abc.json';

test('R1.2 a raw GitHub receipt link in the query is accepted and any other link is refused', async () => {
  const { parseReceiptUrl } = await import(REPO_URL.href);

  // No receipt parameter: null, so the page opens normally.
  assert.equal(parseReceiptUrl(''), null);
  assert.equal(parseReceiptUrl('?'), null);
  assert.equal(parseReceiptUrl('?other=1'), null);

  // A raw.githubusercontent.com link is accepted, encoded or not, with or without other parameters. The
  // owner/name comes back so the page can prefill the repository box.
  for (const search of [
    `?receipt=${RAW}`,
    `?receipt=${encodeURIComponent(RAW)}`,
    `?x=1&receipt=${encodeURIComponent(RAW)}&y=2`,
    `receipt=${encodeURIComponent(RAW)}`,
  ]) {
    const parsed = parseReceiptUrl(search);
    assert.ok(parsed, `${search} must not be null`);
    assert.equal(parsed.ok, true, `${search} must be accepted`);
    assert.equal(parsed.url, RAW);
    assert.equal(parsed.repo, 'octo/spec-repo');
  }

  // Every other kind of link is refused with a one-line message.
  const refused = [
    ['http instead of https', 'http://raw.githubusercontent.com/octo/spec-repo/main/r.json'],
    ['a github.com blob page', 'https://github.com/octo/spec-repo/blob/main/r.json'],
    ['a look-alike host suffix', 'https://raw.githubusercontent.com.evil.example/octo/spec-repo/main/r.json'],
    ['the host name in the path', 'https://evil.example/raw.githubusercontent.com/octo/spec-repo/main/r.json'],
    ['credentials in the URL', 'https://user@raw.githubusercontent.com/octo/spec-repo/main/r.json'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:application/json,{}'],
    ['text that is not a URL', 'not a url'],
    ['a raw link with no file', 'https://raw.githubusercontent.com/octo/spec-repo'],
  ];
  for (const [label, url] of refused) {
    const parsed = parseReceiptUrl(`?receipt=${encodeURIComponent(url)}`);
    assert.ok(parsed, `${label}: must not be null`);
    assert.equal(parsed.ok, false, `${label}: must be refused`);
    assert.equal(typeof parsed.message, 'string', `${label}: needs a message`);
    assert.ok(parsed.message.trim().length > 0 && !/[\r\n]/.test(parsed.message), `${label}: message must be one line`);
    assert.equal(parsed.url, undefined, `${label}: no URL may come back`);
  }
});

test('R5.1 a copyable command clones the repository at the commit and runs necro verify on the receipt', async () => {
  const { verifyCommand } = await import(REPO_URL.href);

  const receipt = {
    spec: 'receipt-viewer',
    gitCommit: COMMIT,
    receiptHash: 'd'.repeat(64),
  };
  const commandOf = (result) => (typeof result === 'string' ? result : result && result.command);

  const command = commandOf(verifyCommand({ repo: 'octo/spec-repo', receipt }));
  assert.equal(typeof command, 'string');
  assert.ok(!/[\r\n]/.test(command), 'the command must be one line so it can be pasted into a shell');

  // Clone, check out the commit, verify the receipt, in that order.
  const clone = command.indexOf('git clone https://github.com/octo/spec-repo.git');
  const checkout = command.indexOf(`git checkout ${COMMIT}`);
  const verify = command.indexOf(`necro verify .necro/receipts/receipt-viewer/${'d'.repeat(64)}.json`);
  assert.ok(clone >= 0, 'the command must clone https://github.com/octo/spec-repo.git');
  assert.ok(checkout > clone, 'the command must check out the receipt commit after the clone');
  assert.ok(verify > checkout, 'the command must run necro verify on the receipt after the checkout');

  // Before a repository is typed the command is still shown, with a placeholder.
  const placeholder = commandOf(verifyCommand({ repo: '', receipt }));
  assert.equal(typeof placeholder, 'string');
  assert.ok(placeholder.includes('OWNER/NAME'), 'an empty repository must show OWNER/NAME');
  assert.ok(placeholder.includes('necro verify'));
});
