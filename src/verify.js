import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256, hashFile } from './canon.js';
import { runContracts } from './contracts.js';
import { readLock } from './lock.js';
import { frozenGlobDrift } from './runners.js';

// The receipt file's absolute path; a relative path is resolved against cwd.
function receiptPath(cwd, receiptFile) {
  return path.resolve(cwd, receiptFile);
}

// Req 6.9: the project root is the nearest folder above the receipt file that
// holds .necro/lock.json, so the result is the same from any working directory.
// When no folder above the receipt has a lock, the current folder is the root.
function projectRoot(cwd, receiptAbs) {
  let dir = path.dirname(receiptAbs);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.necro', 'lock.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return cwd;
    dir = parent;
  }
}

// True when two paths name the same folder, after resolving symbolic links.
function sameFolder(a, b) {
  const resolve = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return resolve(a) === resolve(b);
}

// Recompute the hash of a pinned file. Returns null if the file is missing.
function currentHash(cwd, relPath) {
  try {
    return hashFile(path.join(cwd, relPath));
  } catch {
    return null;
  }
}

// Req 6.8: when the spec was frozen again after the receipt was written, return the
// sorted paths (requirements and contract files) whose hash in the receipt differs
// from the lock's. Returns [] when no such path exists, or when a requirements or
// contract file on disk does not match the lock, because then the files are not
// those of the newer freeze and the ordinary MISMATCH rules apply.
function supersededPaths(cwd, receipt, frozenSpec) {
  const lockFiles = [];
  if (frozenSpec.requirements) lockFiles.push(frozenSpec.requirements);
  lockFiles.push(...(frozenSpec.contracts || []));
  if (frozenSpec.runners) lockFiles.push(frozenSpec.runners); // Req 13.5
  lockFiles.push(...(frozenSpec.frozen || [])); // Req 13.9
  const inLock = new Map(lockFiles.map((f) => [f.path, f.sha256]));

  const changed = new Set();
  const receiptFiles = [receipt.requirements, ...receipt.contracts];
  if (hasRunners(receipt)) receiptFiles.push(receipt.runners);
  receiptFiles.push(...frozenOf(receipt));
  for (const f of receiptFiles) {
    if (inLock.has(f.path) && inLock.get(f.path) !== f.sha256) changed.add(f.path);
  }
  if (changed.size === 0) return [];

  for (const f of lockFiles) {
    if (currentHash(cwd, f.path) !== f.sha256) return [];
  }
  return [...changed].sort();
}

// Req 13.5: true when a receipt pins a runners.json.
function hasRunners(receipt) {
  return Boolean(receipt.runners) && typeof receipt.runners.path === 'string' && typeof receipt.runners.sha256 === 'string';
}

// Req 13.9: the locked files (conftest.py and the like) a receipt pins, or [] when it pins none.
function frozenOf(receipt) {
  if (!Array.isArray(receipt.frozen)) return [];
  return receipt.frozen.filter((f) => f && typeof f.path === 'string' && typeof f.sha256 === 'string');
}

// Req 6.13: "pytest not found; install pytest" from the phrase a runner gives for what it could not run.
function missingPhrase(text) {
  let m = /^the program (\S+) was not found$/.exec(text);
  if (m) return `${m[1]} not found; install ${m[1]}`;
  m = /^the Node\.js package (.+) is not installed$/.exec(text);
  if (m) return `${m[1]} not found; run npm ci`;
  m = /^the Python module (.+) is not installed$/.exec(text);
  if (m) return `${m[1]} not found; pip install ${m[1]}`;
  m = /^the program (\S+) could not be started/.exec(text);
  if (m) return `${m[1]} could not be started; fix the command in runners.json`;
  return text;
}

// Names that appear a different number of times in two lists.
function diffNames(expected, got) {
  const count = new Map();
  for (const n of expected) count.set(n, (count.get(n) || 0) + 1);
  for (const n of got) count.set(n, (count.get(n) || 0) - 1);
  return [...count].filter(([, d]) => d !== 0).map(([n]) => n);
}

// Re-run a receipt: re-hash every pinned file, re-run the contracts, and compare
// the results by name. Prints CONFIRMED <receiptHash>. and returns 0 when
// everything matches; prints MISMATCH with the changed paths or contract names
// and returns 1 otherwise.
// Req 6.14: when the receipt's requirement and contract hashes equal the lock's, look for a later
// receipt of the same spec that verifies CONFIRMED or INCOMPLETE today. Newest first. Returns
// { rel, receipt, notRun } for the first one, or null.
function supersedingReceipt(cwd, receiptAbs, receipt, frozenSpec) {
  const lockContracts = new Map((frozenSpec.contracts || []).map((c) => [c.path, c.sha256]));
  if (!frozenSpec.requirements || receipt.requirements.sha256 !== frozenSpec.requirements.sha256) return null;
  for (const c of receipt.contracts) if (lockContracts.get(c.path) !== c.sha256) return null;
  if (typeof receipt.createdAt !== 'string') return null;

  const dir = path.join(cwd, '.necro', 'receipts', receipt.spec);
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  const later = [];
  for (const n of names) {
    const abs = path.join(dir, n);
    if (abs === receiptAbs) continue;
    try {
      const other = JSON.parse(fs.readFileSync(abs, 'utf8'));
      if (other && other.spec === receipt.spec && typeof other.createdAt === 'string' && other.createdAt > receipt.createdAt) {
        later.push({ abs, other });
      }
    } catch {
      // A file that is not a receipt cannot supersede anything.
    }
  }
  later.sort((a, b) => (a.other.createdAt < b.other.createdAt ? 1 : a.other.createdAt > b.other.createdAt ? -1 : 0));
  for (const { abs, other } of later) {
    let result;
    try {
      result = verifyInner(cwd, abs, { allowNewer: false, say: () => {} });
    } catch {
      continue;
    }
    const rel = path.relative(cwd, abs).split(path.sep).join('/');
    if (result.code === 0) return { rel, receipt: other, notRun: [] };
    if (result.code === 2 && result.notRun.length > 0) return { rel, receipt: other, notRun: result.notRun };
  }
  return null;
}

function reportSuperseded(say, found) {
  say(
    `SUPERSEDED. This receipt is out of date because later work under the same freeze changed the code or the results. The newer receipt is ${found.rel} (${found.receipt.receiptHash}). Verify that receipt for the current state.`,
  );
  if (found.notRun.length > 0) {
    const missing = found.notRun.map((n) => `${n.name} (${missingPhrase(n.missing)})`).join(', ');
    say(`The newer receipt could only be partly checked on this machine: ${missing}.`);
  }
  return { code: 1, notRun: [] };
}

function verifyInner(workingDir, receiptFile, { allowNewer, say }) {
  const receiptAbs = receiptPath(workingDir, receiptFile);
  const receipt = JSON.parse(fs.readFileSync(receiptAbs, 'utf8'));
  // Req 6.9: everything below is relative to the receipt's project, not to where
  // the command was started.
  const cwd = projectRoot(workingDir, receiptAbs);
  // Req 6.10: say whose contracts run when the root is not the current folder. Two
  // spellings of one folder that differ by a symbolic link are the same folder.
  if (!sameFolder(cwd, workingDir)) say(`Project: ${cwd}`);

  // Req 6.5: a receipt must have requirements and contracts.
  if (!receipt.requirements || !receipt.contracts || receipt.contracts.length === 0) {
    say('MISMATCH.');
    return { code: 1, notRun: [] };
  }

  // Req 6.4: verify the receiptHash matches what it should be.
  // Compute the hash without receiptHash and createdAt fields.
  const receiptForHashing = { ...receipt };
  delete receiptForHashing.receiptHash;
  delete receiptForHashing.createdAt;
  const computedHash = sha256(canonicalJson(receiptForHashing));
  if (computedHash !== receipt.receiptHash) {
    say('MISMATCH. The receipt was altered.');
    return { code: 1, notRun: [] };
  }

  // Re-hash every pinned file: requirements, contracts, and imported sources.
  const pinned = [];
  pinned.push(receipt.requirements);
  for (const c of receipt.contracts) pinned.push({ path: c.path, sha256: c.sha256 });
  for (const s of receipt.sources || []) pinned.push({ path: s.path, sha256: s.sha256 });
  if (hasRunners(receipt)) pinned.push(receipt.runners);
  pinned.push(...frozenOf(receipt));

  const changedFiles = [];
  for (const f of pinned) {
    if (currentHash(cwd, f.path) !== f.sha256) changedFiles.push(f.path);
  }

  // Req 6.6, 6.7: when a lock exists, the receipt must agree with it exactly.
  const hasLock = fs.existsSync(path.join(cwd, '.necro', 'lock.json'));
  const lock = readLock(cwd);
  const frozenSpec = hasLock && lock.specs ? lock.specs[receipt.spec] : null;
  if (hasLock && !frozenSpec) {
    // Req 6.15: a receipt for a spec that is neither frozen nor present here came from another project.
    const name = String(receipt.spec);
    // Wherever the receipt file is filed, the spec name must be a plain folder name.
    const plain = name !== '' && name !== '.' && name !== '..' && !/[\\/]/.test(name);
    if (plain
      && !fs.existsSync(path.join(cwd, '.kiro', 'specs', name))
      && !fs.existsSync(path.join(cwd, 'contracts', name))) {
      say(`OTHER PROJECT. Spec '${name}' is not in this project. This receipt was written in another project; verify it from that project's checkout.`);
      return { code: 2, notRun: [] };
    }
    say(`MISMATCH. Spec '${receipt.spec}' is not in the lock. Run 'necro freeze ${receipt.spec}' first.`);
    return { code: 1, notRun: [] };
  }
  const namesChanged = [];
  if (frozenSpec) {
    // Req 6.8: the paths whose hash in the receipt differs from the lock's. Only
    // a path in both counts, so a receipt that leaves a file out or adds one is
    // still judged by the exact-match rules below (Req 6.7).
    const superseded = supersededPaths(cwd, receipt, frozenSpec);
    if (superseded.length > 0) {
      say(
        `SUPERSEDED. Spec '${receipt.spec}' was frozen again after this receipt was written. Changed since then: ${superseded.join(', ')}. This receipt describes an earlier freeze, not today's code. Run 'necro check ${receipt.spec}' for a current receipt.`,
      );
      return { code: 1, notRun: [] };
    }
    // Requirements hash against the lock.
    if (!frozenSpec.requirements || receipt.requirements.sha256 !== frozenSpec.requirements.sha256) {
      changedFiles.push(receipt.requirements.path);
    }
    // Req 13.5: runners.json is pinned in the receipt exactly when it is in the lock.
    const lockRunners = frozenSpec.runners || null;
    const receiptRunners = hasRunners(receipt) ? receipt.runners : null;
    if (lockRunners || receiptRunners) {
      if (!lockRunners || !receiptRunners || lockRunners.path !== receiptRunners.path || lockRunners.sha256 !== receiptRunners.sha256) {
        changedFiles.push((lockRunners || receiptRunners).path);
      }
    }
    // Req 13.9: the locked files are pinned in the receipt exactly as the lock holds them.
    const lockFrozen = new Map((frozenSpec.frozen || []).map((f) => [f.path, f.sha256]));
    const receiptFrozen = new Map(frozenOf(receipt).map((f) => [f.path, f.sha256]));
    for (const p of new Set([...lockFrozen.keys(), ...receiptFrozen.keys()])) {
      if (lockFrozen.get(p) !== receiptFrozen.get(p)) changedFiles.push(p);
    }
    // Contract files and hashes: none missing, none extra, none different.
    const lockFiles = new Map((frozenSpec.contracts || []).map((c) => [c.path, c]));
    const receiptFiles = new Map();
    for (const c of receipt.contracts) {
      if (!receiptFiles.has(c.path)) receiptFiles.set(c.path, { sha256: c.sha256, names: [] });
      receiptFiles.get(c.path).names.push(c.name);
      const known = lockFiles.get(c.path);
      if (!known || known.sha256 !== c.sha256) changedFiles.push(c.path);
    }
    for (const p of lockFiles.keys()) if (!receiptFiles.has(p)) changedFiles.push(p);
    // Contract names, per file: none missing, none extra.
    for (const [p, known] of lockFiles) {
      const got = receiptFiles.get(p);
      if (got) namesChanged.push(...diffNames(known.names || [], got.names));
    }
  }

  // Req 13.12: expand the "frozen" globs of the locked runners.json again. A file that matches
  // now and was not locked, or a locked one that no longer matches, is a changed file. With a
  // lock the lock's entry is compared; without one, the receipt's own pins are.
  const driftEntry = frozenSpec || {
    requirements: receipt.requirements,
    contracts: receipt.contracts,
    runners: hasRunners(receipt) ? receipt.runners : null,
    frozen: frozenOf(receipt),
  };
  const drift = frozenGlobDrift(cwd, driftEntry);
  changedFiles.push(...drift.added, ...drift.removed);

  const later = (text) => {
    const found = allowNewer && frozenSpec ? supersedingReceipt(cwd, receiptAbs, receipt, frozenSpec) : null;
    if (found) return reportSuperseded(say, found);
    say(text);
    return { code: 1, notRun: [] };
  };

  if (changedFiles.length > 0) {
    return later(`MISMATCH. Files changed: ${[...new Set(changedFiles)].sort().join(', ')}.`);
  }
  if (namesChanged.length > 0) {
    return later(`MISMATCH. Contracts changed: ${[...new Set(namesChanged)].sort().join(', ')}.`);
  }

  // All pinned files match: re-run the contracts and compare results by file and
  // name. With a lock, the lock's contracts run, not the receipt's list (Req 6.7).
  const runLock = frozenSpec
    ? lock
    : {
        specs: {
          [receipt.spec]: {
            requirements: receipt.requirements,
            contracts: receipt.contracts.map((c) => ({ path: c.path, sha256: c.sha256, names: [c.name] })),
            ...(hasRunners(receipt) ? { runners: receipt.runners } : {}),
            ...(frozenOf(receipt).length > 0 ? { frozen: frozenOf(receipt) } : {}),
          },
        },
      };
  const fresh = runContracts(cwd, receipt.spec, runLock);

  const key = (c) => `${c.path}\0${c.name}`;
  const receiptMap = new Map(receipt.contracts.map((c) => [key(c), c]));
  const freshMap = new Map(fresh.map((r) => [key(r), r]));
  const changedContracts = [];
  // Req 6.13: a contract that could not run (runner or imported module missing) is not a changed result.
  const notRun = [];
  const receiptPaths = new Set(receipt.contracts.map((c) => c.path));
  for (const [k, c] of receiptMap) {
    const got = freshMap.get(k);
    if (got && got.cannotRun) notRun.push({ name: c.name, missing: got.cannotRun });
    else if (!got || got.result !== c.result) changedContracts.push(c.name);
  }
  for (const [k, r] of freshMap) {
    if (receiptMap.has(k)) continue;
    // The file-level entry of a file that did not run is not a new contract, unless the receipt records none for it.
    if (r.cannotRun) {
      if (!receiptPaths.has(r.path)) notRun.push({ name: r.name, missing: r.cannotRun });
    } else {
      changedContracts.push(r.name);
    }
  }
  if (changedContracts.length > 0) {
    return later(`MISMATCH. Contracts changed: ${[...new Set(changedContracts)].sort().join(', ')}.`);
  }
  if (notRun.length > 0) {
    say('INCOMPLETE. This receipt could only be partly checked on this machine. Contracts that did not run:');
    for (const n of notRun) say(`- ${n.name} (${missingPhrase(n.missing)})`);
    return { code: 2, notRun };
  }

  say(`CONFIRMED ${receipt.receiptHash}.`);
  // Req 6.11, 6.12: the re-run agrees with the receipt's list entry by entry, so that list says
  // which contracts the receipt records as failing. A passing receipt prints nothing more.
  const line = failingLine(receipt.contracts);
  if (line) say(line);
  return { code: 0, notRun: [] };
}

export function verify(workingDir, receiptFile) {
  return verifyInner(workingDir, receiptFile, { allowNewer: true, say: (t) => console.log(t) }).code;
}

// Req 6.11: the line for a confirmed receipt that records failures, or null when every
// recorded contract passes. Names keep the receipt's order and are joined with ", ".
export function failingLine(contracts) {
  const failing = contracts.filter((c) => c.result !== 'pass').map((c) => c.name);
  if (failing.length === 0) return null;
  const noun = failing.length === 1 ? 'contract' : 'contracts';
  return `This receipt records ${failing.length} failing ${noun}: ${failing.join(', ')}.`;
}
