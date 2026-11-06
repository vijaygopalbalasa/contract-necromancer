import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256, hashFile } from './canon.js';
import { runContracts } from './contracts.js';
import { readLock } from './lock.js';

// Read a receipt JSON file, resolving a relative path against cwd.
function readReceipt(cwd, receiptFile) {
  const abs = path.isAbsolute(receiptFile) ? receiptFile : path.join(cwd, receiptFile);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

// Recompute the hash of a pinned file. Returns null if the file is missing.
function currentHash(cwd, relPath) {
  try {
    return hashFile(path.join(cwd, relPath));
  } catch {
    return null;
  }
}

// Re-run a receipt: re-hash every pinned file, re-run the contracts, and compare
// the results by name. Prints CONFIRMED <receiptHash>. and returns 0 when
// everything matches; prints MISMATCH with the changed paths or contract names
// and returns 1 otherwise.
export function verify(cwd, receiptFile) {
  const receipt = readReceipt(cwd, receiptFile);

  // Req 6.5: a receipt must have requirements and contracts.
  if (!receipt.requirements || !receipt.contracts || receipt.contracts.length === 0) {
    console.log('MISMATCH.');
    return 1;
  }

  // Req 6.4: verify the receiptHash matches what it should be.
  // Compute the hash without receiptHash and createdAt fields.
  const receiptForHashing = { ...receipt };
  delete receiptForHashing.receiptHash;
  delete receiptForHashing.createdAt;
  const computedHash = sha256(canonicalJson(receiptForHashing));
  if (computedHash !== receipt.receiptHash) {
    console.log('MISMATCH. The receipt was altered.');
    return 1;
  }

  // Re-hash every pinned file: requirements, contracts, and imported sources.
  const pinned = [];
  pinned.push(receipt.requirements);
  for (const c of receipt.contracts) pinned.push({ path: c.path, sha256: c.sha256 });
  for (const s of receipt.sources || []) pinned.push({ path: s.path, sha256: s.sha256 });

  const changedFiles = [];
  for (const f of pinned) {
    if (currentHash(cwd, f.path) !== f.sha256) changedFiles.push(f.path);
  }

  // Req 6.6: if the spec is frozen, also check against the lock.
  const lock = readLock(cwd);
  if (lock.specs && lock.specs[receipt.spec]) {
    const frozenSpec = lock.specs[receipt.spec];
    // Check requirements hash against lock.
    if (frozenSpec.requirements && 
        receipt.requirements.sha256 !== frozenSpec.requirements.sha256) {
      changedFiles.push(receipt.requirements.path);
    }
    // Check contract hashes against lock.
    const frozenContracts = new Map(
      (frozenSpec.contracts || []).map((c) => [c.path, c.sha256])
    );
    for (const c of receipt.contracts) {
      if (frozenContracts.get(c.path) !== c.sha256) {
        changedFiles.push(c.path);
      }
    }
  }

  if (changedFiles.length > 0) {
    console.log(`MISMATCH. Files changed: ${[...new Set(changedFiles)].sort().join(', ')}.`);
    return 1;
  }

  // All pinned files match: re-run the contracts and compare results by name.
  const receiptLock = {
    specs: {
      [receipt.spec]: {
        contracts: (receipt.contracts || []).map((c) => ({ 
          path: c.path, 
          sha256: c.sha256,
          names: [c.name], // Store the contract name for matching
        })),
      },
    },
  };
  const fresh = runContracts(cwd, receipt.spec, receiptLock);

  const receiptMap = new Map((receipt.contracts || []).map((c) => [c.name, c.result]));
  const freshMap = new Map(fresh.map((r) => [r.name, r.result]));
  const changedContracts = [];
  for (const [name, result] of receiptMap) {
    if (!freshMap.has(name) || freshMap.get(name) !== result) changedContracts.push(name);
  }
  for (const name of freshMap.keys()) {
    if (!receiptMap.has(name)) changedContracts.push(name);
  }
  if (changedContracts.length > 0) {
    console.log(`MISMATCH. Contracts changed: ${[...new Set(changedContracts)].sort().join(', ')}.`);
    return 1;
  }

  console.log(`CONFIRMED ${receipt.receiptHash}.`);
  return 0;
}
