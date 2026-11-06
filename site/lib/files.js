// File check: fetch each pinned file at the receipt's commit from raw.githubusercontent.com, hash the raw bytes and
// compare with the hash the receipt pins.
//
// Four statuses, because "could not look" is not "looked and it differs":
//   match        the repository serves the pinned bytes
//   different    the repository serves other bytes
//   uncommitted  the receipt says the commit does not hold this file; it is not requested
//   unavailable  the page could not get the file (HTTP error, network error, unsafe path)

import { sha256Hex } from './canon.js';
import { pinnedFiles } from './receipt.js';
import { parseRepo, isCommitId, isSafeRepoPath, rawUrl } from './repo.js';

const TIMEOUT_MS = 15000;

async function checkOne(file, repo, commit, fetchFn) {
  const base = { kind: file.kind, path: file.path, expected: file.sha256 };
  if (!isSafeRepoPath(file.path)) {
    return { ...base, status: 'unavailable', detail: 'The path in the receipt is not safe to fetch.' };
  }
  const options = { credentials: 'omit', referrerPolicy: 'no-referrer' };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    options.signal = AbortSignal.timeout(TIMEOUT_MS);
  }
  let bytes;
  try {
    const response = await fetchFn(rawUrl(repo, commit, file.path), options);
    if (!response.ok) {
      return {
        ...base,
        status: 'unavailable',
        detail: `GitHub answered ${response.status}. Check the repository name and that it is public.`,
      };
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ...base, status: 'unavailable', detail: 'Could not reach raw.githubusercontent.com.' };
  }
  const actual = await sha256Hex(bytes);
  return actual === file.sha256 ? { ...base, status: 'match' } : { ...base, status: 'different', actual };
}

// checkFiles({ receipt, repo, fetchFn, concurrency })
//   → { ok: false, message }                                  no usable commit or repository; nothing was requested
//   | { ok: true, files: FileResult[], anyUncommitted }       one row per pinned file, in pinned order
export async function checkFiles({ receipt, repo, fetchFn = globalThis.fetch, concurrency = 6 }) {
  const commit = receipt.gitCommit;
  if (commit === null || commit === undefined) {
    return {
      ok: false,
      message: 'The file check needs a git commit, and this receipt has none. Run the gate inside a git repository to get one.',
    };
  }
  if (!isCommitId(commit)) {
    return { ok: false, message: 'The file check needs a git commit, and the one in this receipt is not a valid commit id.' };
  }
  const parsed = parseRepo(repo);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const uncommitted = new Set(Array.isArray(receipt.uncommitted) ? receipt.uncommitted : []);
  const pinned = pinnedFiles(receipt);
  const files = new Array(pinned.length);
  const queue = [];
  pinned.forEach((file, i) => {
    if (uncommitted.has(file.path)) {
      files[i] = { kind: file.kind, path: file.path, expected: file.sha256, status: 'uncommitted' };
    } else {
      queue.push(i);
    }
  });

  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const i = queue[next++];
      files[i] = await checkOne(pinned[i], parsed.repo, commit, fetchFn);
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, queue.length));
  await Promise.all(Array.from({ length: workers }, worker));

  return { ok: true, files, anyUncommitted: files.some((f) => f.status === 'uncommitted') };
}
