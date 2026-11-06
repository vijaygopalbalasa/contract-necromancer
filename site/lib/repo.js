// Repository and URL helpers. Everything here treats its input as untrusted: the query string, the repository box and
// the paths inside a receipt all come from someone else.

const NAME_PART = /^[A-Za-z0-9_.-]+$/;
const RAW_HOST = 'raw.githubusercontent.com';
const REPO_HINT = 'Type the repository as owner/name, for example octo/spec-repo.';

function isNamePart(s) {
  return NAME_PART.test(s) && s !== '.' && s !== '..';
}

// parseRepo(input) → { ok: true, repo: 'owner/name' } | { ok: false, message }
export function parseRepo(input) {
  if (typeof input !== 'string') return { ok: false, message: REPO_HINT };
  let s = input.trim();
  if (s.startsWith('https://github.com/')) s = s.slice('https://github.com/'.length);
  if (s.endsWith('/')) s = s.slice(0, -1);
  if (s.endsWith('.git')) s = s.slice(0, -'.git'.length);
  const parts = s.split('/');
  if (parts.length !== 2 || !isNamePart(parts[0]) || !isNamePart(parts[1])) return { ok: false, message: REPO_HINT };
  return { ok: true, repo: `${parts[0]}/${parts[1]}` };
}

function refusal(message) {
  return { ok: false, message };
}

// parseReceiptUrl(search) reads `receipt` from a query string.
// null when it is absent; otherwise { ok: true, url, repo } or { ok: false, message }.
export function parseReceiptUrl(search) {
  const raw = new URLSearchParams(typeof search === 'string' ? search : '').get('receipt');
  if (raw === null) return null;
  const useRaw = 'Only raw.githubusercontent.com links work. Use the Raw button on GitHub and paste that link.';
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return refusal('The receipt link is not a web address. Use the Raw button on GitHub and paste that link.');
  }
  if (url.protocol !== 'https:' || url.hostname !== RAW_HOST || url.username !== '' || url.password !== '' || url.port !== '') {
    return refusal(useRaw);
  }
  const segments = url.pathname.split('/').slice(1);
  // /<owner>/<name>/<ref>/<path...>
  if (segments.length < 4 || segments.some((p) => p === '') || !isNamePart(segments[0]) || !isNamePart(segments[1])) {
    return refusal('That link does not point to a file in a repository. Use the Raw button on GitHub and paste that link.');
  }
  return { ok: true, url: url.href, repo: `${segments[0]}/${segments[1]}` };
}

// 40 lowercase hex characters.
export function isCommitId(s) {
  return typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
}

// A repository-relative path that is safe to put in a URL. Receipt paths are untrusted.
export function isSafeRepoPath(p) {
  if (typeof p !== 'string' || p === '' || p.startsWith('/') || p.includes('\\')) return false;
  if (/[\u0000-\u001f\u007f]/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

// https://raw.githubusercontent.com/<owner>/<name>/<commit>/<path>, each path segment encoded.
// null when any input is invalid.
export function rawUrl(repo, commit, path) {
  const parsed = parseRepo(repo);
  if (!parsed.ok || parsed.repo !== repo) return null;
  if (!isCommitId(commit) || !isSafeRepoPath(path)) return null;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `https://${RAW_HOST}/${repo}/${commit}/${encoded}`;
}

// Quote one shell argument. Safe characters stay bare. Anything else goes inside single quotes, with each single quote
// written as '\''. Receipt fields are untrusted, so nothing is ever put into the command without this.
function shQuote(value) {
  const s = String(value);
  if (/^[A-Za-z0-9_./:@%+=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// verifyCommand({ repo, receipt }) → one line a reviewer can paste into a shell:
//   git clone <url> necro-check && cd necro-check && git checkout <commit> && necro verify <receipt file>
// repo is "owner/name"; anything else shows the placeholder OWNER/NAME (no angle brackets, which are shell redirection).
// Without a valid commit the checkout step is left out.
export function verifyCommand({ repo, receipt }) {
  const parsed = parseRepo(repo);
  const name = parsed.ok ? parsed.repo : 'OWNER/NAME';
  const steps = [`git clone ${shQuote(`https://github.com/${name}.git`)} necro-check`, 'cd necro-check'];
  if (isCommitId(receipt.gitCommit)) steps.push(`git checkout ${receipt.gitCommit}`);
  steps.push(`necro verify ${shQuote(`.necro/receipts/${receipt.spec}/${receipt.receiptHash}.json`)}`);
  return steps.join(' && ');
}
