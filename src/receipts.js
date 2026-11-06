import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256, canonicalJson, hashFile } from './canon.js';

// Normalize a path to forward slashes, project-relative style.
function toRel(p) {
  return p.split(path.sep).join('/');
}

// Find module specifiers referenced by import/export/require in a file's source.
// Returns the raw specifier strings; relative resolution and filtering happen later.
function findImportSpecifiers(content) {
  const specs = [];
  // import ... from 'x' and export ... from 'x' (re-exports are real dependencies)
  const reFrom = /\bfrom\s*['"]([^'"]+)['"]/g;
  // bare side-effect import: import 'x'
  const reImport = /\bimport\s*['"]([^'"]+)['"]/g;
  // CommonJS require('x')
  const reRequire = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = reFrom.exec(content)) !== null) specs.push(m[1]);
  while ((m = reImport.exec(content)) !== null) specs.push(m[1]);
  while ((m = reRequire.exec(content)) !== null) specs.push(m[1]);
  return specs;
}

// Resolve a relative specifier to a project-relative path if the target file
// exists. Tries the exact path, then .js/.mjs/.cjs, then /index.js.
function resolveRelative(cwd, dir, spec) {
  const joined = path.posix.normalize(path.posix.join(dir, spec));
  const candidates = [
    joined,
    `${joined}.js`,
    `${joined}.mjs`,
    `${joined}.cjs`,
    `${joined}/index.js`,
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(path.join(cwd, c)).isFile()) return toRel(c);
    } catch {
      // candidate does not resolve; try the next
    }
  }
  return null;
}

// Trace every project source file transitively imported by `filePath`.
// Returns sorted project-relative paths (forward slashes), excluding the start
// file itself, node: builtins, and bare specifiers (no ./ or ../ prefix).
export function traceImports(cwd, filePath) {
  const start = toRel(filePath);
  const visited = new Set();
  const sources = new Set();
  const stack = [start];
  while (stack.length) {
    const rel = stack.pop();
    if (visited.has(rel)) continue;
    visited.add(rel);
    let content;
    try {
      content = fs.readFileSync(path.join(cwd, rel), 'utf8');
    } catch {
      continue;
    }
    const dir = path.posix.dirname(rel);
    for (const spec of findImportSpecifiers(content)) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      const resolved = resolveRelative(cwd, dir, spec);
      if (resolved && !visited.has(resolved)) {
        sources.add(resolved);
        stack.push(resolved);
      }
    }
  }
  return [...sources].sort();
}

// Git HEAD commit of cwd, or null when cwd is not in a git repository.
function gitCommit(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

// Pinned paths whose content differs from that file at `commit`, or that the
// commit lacks. Sorted and unique. `./<path>` makes git resolve the path from
// cwd, so this also works when the project root is below the repository root.
function uncommittedPaths(cwd, commit, pinnedPaths) {
  const differs = [];
  for (const p of new Set(pinnedPaths)) {
    let committed = null;
    try {
      committed = execFileSync('git', ['show', `${commit}:./${p}`], {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 256 * 1024 * 1024,
      });
    } catch {
      // the commit has no such file
    }
    let current = null;
    try {
      current = hashFile(path.join(cwd, p));
    } catch {
      // the file is missing on disk
    }
    if (committed === null || current === null || sha256(committed) !== current) differs.push(p);
  }
  return differs.sort();
}

// SHA-256 of the canonical JSON of the receipt with receiptHash and createdAt removed.
export function computeReceiptHash(receipt) {
  const { receiptHash: _rh, createdAt: _ca, ...rest } = receipt;
  return sha256(canonicalJson(rest));
}

// Build a receipt pinning every input: the spec name, the git commit if
// available, the SHA-256 of requirements.md, of each contract file, of each
// project source file transitively imported by the contracts, and the pass or
// fail result of each contract by name. receiptHash is derived from all other
// fields; createdAt is added after the hash is computed so it never affects it.
//
// Req 5.5: `gate.task` is the ticked task as { id, line } (null when unknown) and
// `gate.required` the names of the contracts that had to pass. Without it every
// contract counts as required. Every result is recorded either way.
export function buildReceipt(cwd, spec, lock, results, gate = {}) {
  const entry = (lock && lock.specs && lock.specs[spec]) || {};
  const req = entry.requirements || { path: null, sha256: null };
  const requirements = { path: req.path, sha256: req.sha256 };

  // Contracts: the run results, one per named test, with name/path/sha256/result.
  const contracts = results.map((r) => ({
    name: r.name,
    path: r.path,
    sha256: r.sha256,
    result: r.result,
  }));

  // Sources: every project file transitively imported by the contract files,
  // excluding the contract files themselves (already listed under contracts).
  const contractPaths = new Set(contracts.map((c) => c.path));
  const sourceSet = new Set();
  for (const c of entry.contracts || []) {
    for (const s of traceImports(cwd, c.path)) {
      if (!contractPaths.has(s)) sourceSet.add(s);
    }
  }
  const sources = [...sourceSet].sort().map((p) => ({
    path: p,
    sha256: hashFile(path.join(cwd, p)),
  }));

  const commit = gitCommit(cwd);
  const receipt = {
    spec,
    gitCommit: commit,
    requirements,
    contracts,
    sources,
    task: gate.task || null,
    required: [...new Set(gate.required || contracts.map((c) => c.name))].sort(),
  };
  // Req 5.4: in a git repository, say which pinned files the commit does not hold.
  if (commit) {
    const pinned = [requirements.path, ...contracts.map((c) => c.path), ...sources.map((s) => s.path)];
    receipt.uncommitted = uncommittedPaths(cwd, commit, pinned.filter(Boolean));
  }
  receipt.receiptHash = computeReceiptHash(receipt);
  receipt.createdAt = new Date().toISOString();
  return receipt;
}

// Write a receipt to .necro/receipts/<spec>/<receiptHash>.json (pretty JSON).
// Returns the project-relative path to the written file.
export function writeReceipt(cwd, spec, receipt) {
  const dir = path.join(cwd, '.necro', 'receipts', spec);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${receipt.receiptHash}.json`;
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(receipt, null, 2) + '\n');
  return toRel(path.join('.necro', 'receipts', spec, fileName));
}
