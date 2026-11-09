import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepo, parseReceiptUrl, isCommitId, isSafeRepoPath, rawUrl, verifyCommand } from '../site/lib/repo.js';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const RAW = 'https://raw.githubusercontent.com/octo/spec-repo/main/.necro/receipts/demo/abc.json';

function assertSentence(message, label) {
  assert.equal(typeof message, 'string', label);
  assert.ok(message.length > 0 && message.length <= 200, `${label}: length`);
  assert.ok(!/[\r\n]/.test(message), `${label}: one line`);
  assert.ok(message.endsWith('.'), `${label}: ends with a full stop`);
  assert.doesNotMatch(message, /TypeError|undefined|\[object|Invalid URL/, label);
}

// ---- Task 5: parseReceiptUrl ----

test('parseReceiptUrl returns null when there is no receipt parameter', () => {
  assert.equal(parseReceiptUrl(''), null);
  assert.equal(parseReceiptUrl('?'), null);
  assert.equal(parseReceiptUrl('?other=1'), null);
  assert.equal(parseReceiptUrl(undefined), null);
});

test('parseReceiptUrl accepts a raw GitHub link, encoded or not, and returns owner/name', () => {
  for (const search of [`?receipt=${RAW}`, `?receipt=${encodeURIComponent(RAW)}`, `?a=1&receipt=${encodeURIComponent(RAW)}&b=2`, `receipt=${encodeURIComponent(RAW)}`]) {
    const parsed = parseReceiptUrl(search);
    assert.deepEqual(parsed, { ok: true, url: RAW, repo: 'octo/spec-repo' }, search);
  }
});

test('parseReceiptUrl refuses everything else with one sentence', () => {
  const refused = [
    ['http', 'http://raw.githubusercontent.com/o/n/main/r.json'],
    ['github.com blob', 'https://github.com/o/n/blob/main/r.json'],
    ['look-alike suffix', 'https://raw.githubusercontent.com.evil.example/o/n/main/r.json'],
    ['host in the path', 'https://evil.example/raw.githubusercontent.com/o/n/main/r.json'],
    ['credentials', 'https://user@raw.githubusercontent.com/o/n/main/r.json'],
    ['credentials with password', 'https://user:pw@raw.githubusercontent.com/o/n/main/r.json'],
    ['port', 'https://raw.githubusercontent.com:8443/o/n/main/r.json'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:application/json,{}'],
    ['not a URL', 'not a url'],
    ['no file', 'https://raw.githubusercontent.com/o/n'],
    ['no ref', 'https://raw.githubusercontent.com/o/n/main'],
    ['bad owner', 'https://raw.githubusercontent.com/o%20x/n/main/r.json'],
    ['uppercase scheme is still http', 'HTTP://raw.githubusercontent.com/o/n/main/r.json'],
  ];
  for (const [label, url] of refused) {
    const parsed = parseReceiptUrl(`?receipt=${encodeURIComponent(url)}`);
    assert.ok(parsed, label);
    assert.equal(parsed.ok, false, label);
    assertSentence(parsed.message, label);
    assert.equal(parsed.url, undefined, label);
    assert.equal(parsed.repo, undefined, label);
  }
  const empty = parseReceiptUrl('?receipt=');
  assert.equal(empty.ok, false);
  assertSentence(empty.message, 'empty');
});

test('parseReceiptUrl tells the user to use the Raw button for a GitHub page link', () => {
  const parsed = parseReceiptUrl(`?receipt=${encodeURIComponent('https://github.com/o/n/blob/main/r.json')}`);
  assert.match(parsed.message, /raw\.githubusercontent\.com/);
  assert.match(parsed.message, /Raw/);
});

// ---- Task 5: parseRepo ----

test('parseRepo accepts owner/name in the forms people paste', () => {
  for (const input of ['octo/spec-repo', ' octo/spec-repo ', 'https://github.com/octo/spec-repo', 'https://github.com/octo/spec-repo/', 'https://github.com/octo/spec-repo.git', 'octo/spec-repo.git', 'octo/spec-repo/']) {
    assert.deepEqual(parseRepo(input), { ok: true, repo: 'octo/spec-repo' }, input);
  }
  assert.deepEqual(parseRepo('a_b.c/d-e.f'), { ok: true, repo: 'a_b.c/d-e.f' });
});

test('parseRepo refuses anything else with one sentence', () => {
  for (const input of ['', '   ', 'octo', 'a/b/c', '../x', 'x/..', './x', 'o/ n', 'o n/x', 'o/n;ls', 'o/$(id)', 'o/n`id`', 'o/n&x', "o/n'x", 'o\\n/x', 'https://evil.example/o/n', 'http://github.com/o/n', 'o/n\nx', '/o/n', 'o//n', '.git/.git', undefined, 5]) {
    const parsed = parseRepo(input);
    assert.equal(parsed.ok, false, JSON.stringify(input));
    assertSentence(parsed.message, JSON.stringify(input));
    assert.equal(parsed.repo, undefined);
  }
});

// ---- Task 5: isCommitId, isSafeRepoPath, rawUrl ----

test('isCommitId accepts 40 lowercase hex characters only', () => {
  assert.equal(isCommitId(COMMIT), true);
  for (const v of [COMMIT.toUpperCase(), COMMIT.slice(1), `${COMMIT}0`, '', null, undefined, 7, 'g'.repeat(40), `${COMMIT}\n`]) {
    assert.equal(isCommitId(v), false, String(v));
  }
});

test('isSafeRepoPath rejects the paths that could escape or confuse a URL', () => {
  for (const p of ['a', 'a/b.js', '.kiro/specs/x/requirements.md', 'a b/c.js', 'ünï/ç.js']) assert.equal(isSafeRepoPath(p), true, p);
  for (const p of ['', '/a', 'a/../b', '../a', 'a/..', './a', 'a/./b', 'a//b', 'a/', 'a\\b', 'a\u0000b', 'a\nb', 'a\u007fb', 'a\tb', null, undefined, 3]) {
    assert.equal(isSafeRepoPath(p), false, JSON.stringify(p));
  }
});

test('rawUrl builds the raw.githubusercontent.com URL and encodes each segment', () => {
  assert.equal(rawUrl('octo/spec-repo', COMMIT, 'src/a.js'), `https://raw.githubusercontent.com/octo/spec-repo/${COMMIT}/src/a.js`);
  assert.equal(rawUrl('octo/spec-repo', COMMIT, 'a b/c#d?e.js'), `https://raw.githubusercontent.com/octo/spec-repo/${COMMIT}/a%20b/c%23d%3Fe.js`);
  assert.equal(rawUrl('octo/spec-repo', COMMIT, 'ü/ç.js'), `https://raw.githubusercontent.com/octo/spec-repo/${COMMIT}/%C3%BC/%C3%A7.js`);
});

test('rawUrl returns null on invalid input', () => {
  assert.equal(rawUrl('octo', COMMIT, 'a.js'), null);
  assert.equal(rawUrl('', COMMIT, 'a.js'), null);
  assert.equal(rawUrl('o/n/x', COMMIT, 'a.js'), null);
  assert.equal(rawUrl('octo/spec-repo', 'main', 'a.js'), null);
  assert.equal(rawUrl('octo/spec-repo', null, 'a.js'), null);
  assert.equal(rawUrl('octo/spec-repo', COMMIT, '../a.js'), null);
  assert.equal(rawUrl('octo/spec-repo', COMMIT, ''), null);
  assert.equal(rawUrl('octo/spec-repo', COMMIT, '/a.js'), null);
});

// ---- Task 6: verifyCommand ----

const HASH = 'd'.repeat(64);
const receiptOf = (over = {}) => ({ spec: 'receipt-viewer', gitCommit: COMMIT, receiptHash: HASH, ...over });

// A small POSIX-ish tokenizer for what shQuote produces: bare words, '...' quoting, and '\'' for a single quote.
// An unquoted && is returned as an operator. Any other shell syntax outside quotes (; & | < > $ ` ( ) newline) makes it throw, so a leak shows up as a failure.
function tokenize(line) {
  const tokens = [];
  let cur = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      assert.ok(end > 0, 'unterminated quote');
      cur = (cur ?? '') + line.slice(i + 1, end);
      i = end + 1;
    } else if (ch === '\\' && line[i + 1] === "'") {
      cur = (cur ?? '') + "'";
      i += 2;
    } else if (ch === ' ') {
      if (cur !== null) tokens.push(cur);
      cur = null;
      i += 1;
    } else if (ch === '&' && line[i + 1] === '&' && cur === null && line[i + 2] === ' ') {
      tokens.push({ operator: '&&' });
      i += 2;
    } else {
      assert.match(ch, /[A-Za-z0-9_./:@%+=-]/, `unquoted shell syntax ${JSON.stringify(ch)} in ${line}`);
      cur = (cur ?? '') + ch;
      i += 1;
    }
  }
  if (cur !== null) tokens.push(cur);
  return tokens;
}

// Split the token list on the unquoted && operator. A quoted "&&" stays inside its argument.
function commands(line) {
  const out = [[]];
  for (const t of tokenize(line)) {
    if (typeof t === 'object') out.push([]);
    else out[out.length - 1].push(t);
  }
  return out;
}

// Task 19: the command defines `necro` itself, so a machine with Git and Node.js but no global necro can run it.
const DEFINE_NECRO = 'necro() { node bin/necro.js "$@"; }';

// The command without the fixed function definition, so the tokenizer sees only what shQuote produces.
function withoutDefinition(command) {
  assert.ok(command.includes(` && ${DEFINE_NECRO} && `), 'the command must define necro between the other steps and necro verify');
  return command.replace(` ${DEFINE_NECRO} &&`, '');
}

test('verifyCommand clones, checks out the commit, brings in the receipt, defines necro, then runs necro verify, in that order', () => {
  const command = verifyCommand({ repo: 'octo/spec-repo', receipt: receiptOf() });
  const file = `.necro/receipts/receipt-viewer/${HASH}.json`;
  assert.equal(
    command,
    `git clone https://github.com/octo/spec-repo.git necro-check && cd necro-check && git checkout ${COMMIT} && git checkout origin/HEAD -- ${file} && ${DEFINE_NECRO} && necro verify ${file}`,
  );
  assert.ok(!/[\r\n]/.test(command));
});

test('verifyCommand defines necro as node bin/necro.js before it is used, and uses no global necro', () => {
  for (const gitCommit of [COMMIT, null]) {
    const command = verifyCommand({ repo: 'octo/spec-repo', receipt: receiptOf({ gitCommit }) });
    const definition = command.indexOf(DEFINE_NECRO);
    const use = command.indexOf('necro verify ');
    assert.ok(definition > 0 && use > definition, 'the definition must come before necro verify');
    assert.equal(command.split('necro verify').length, 2, 'necro verify appears once');
  }
});

test('verifyCommand shows OWNER/NAME and no angle brackets for an empty or invalid repository', () => {
  for (const repo of ['', undefined, 'octo', 'a/b/c', 'o/n; rm -rf ~', '$(id)/x']) {
    const command = verifyCommand({ repo, receipt: receiptOf() });
    assert.ok(command.includes('git clone https://github.com/OWNER/NAME.git'), String(repo));
    assert.doesNotMatch(command, /[<>]/);
    assert.ok(command.includes('necro verify'));
    assert.ok(!command.includes('rm -rf'));
  }
});

test('verifyCommand drops the checkout step when the commit is missing or malformed', () => {
  for (const gitCommit of [null, undefined, '', 'main', COMMIT.toUpperCase(), `${COMMIT}; rm -rf ~`, 'a'.repeat(39)]) {
    const command = verifyCommand({ repo: 'octo/spec-repo', receipt: receiptOf({ gitCommit }) });
    assert.doesNotMatch(command, /git checkout/, String(gitCommit));
    assert.ok(command.includes('git clone'));
    assert.ok(command.includes(`cd necro-check && ${DEFINE_NECRO} && necro verify`));
    assert.ok(!command.includes('rm -rf'));
  }
});

test('verifyCommand keeps hostile receipt fields inside one quoted argument', () => {
  const hostile = ['x; rm -rf ~', 'a$(id)b', 'a`id`b', "it's", 'line\nbreak', '-rf', 'a b', 'a && b', '$HOME', 'a|b', 'a>b', '"q"', 'a\\b', "''", ''];
  for (const spec of hostile) {
    const command = verifyCommand({ repo: 'octo/spec-repo', receipt: receiptOf({ spec }) });
    const parts = commands(withoutDefinition(command));
    assert.equal(parts.length, 5, JSON.stringify(spec));
    const file = `.necro/receipts/${spec}/${HASH}.json`;
    assert.deepEqual(parts[3], ['git', 'checkout', 'origin/HEAD', '--', file], JSON.stringify(spec));
    assert.deepEqual(parts[4].slice(0, 2), ['necro', 'verify'], JSON.stringify(spec));
    assert.equal(parts[4].length, 3, `exactly one argument for ${JSON.stringify(spec)}`);
    assert.equal(parts[4][2], file, JSON.stringify(spec));
  }
  const hostileHash = verifyCommand({ repo: 'octo/spec-repo', receipt: receiptOf({ receiptHash: 'x; echo hi' }) });
  const hostileParts = commands(withoutDefinition(hostileHash));
  assert.equal(hostileParts[3].length, 5);
  assert.equal(hostileParts[4].length, 3);
});

test('verifyCommand leaves safe values unquoted', () => {
  const command = verifyCommand({ repo: 'octo/spec-repo', receipt: receiptOf({ spec: 'my-spec_1.0' }) });
  assert.ok(!command.includes("'"));
  assert.ok(command.includes(`necro verify .necro/receipts/my-spec_1.0/${HASH}.json`));
});
