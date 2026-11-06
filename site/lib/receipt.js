// Receipt model: parse and check the shape of a receipt, group its contracts, list its pinned files.
// Validation is structural only. It never judges whether a receipt is correct, so a receipt with edited fields still
// renders and the page can show ALTERED.

export const MAX_RECEIPT_BYTES = 1_000_000;

const HEX64 = /^[0-9a-f]{64}$/;
const NEXT = 'Paste a file from .necro/receipts/.';

function bad(detail) {
  return { ok: false, message: `This JSON is not a receipt: ${detail} ${NEXT}` };
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isHex64(v) {
  return typeof v === 'string' && HEX64.test(v);
}

// Returns a short problem description, or null when the receipt has the shape the page needs.
function shapeProblem(r) {
  if (typeof r.spec !== 'string' || r.spec === '') return '"spec" must be text.';
  if (!('receiptHash' in r)) return '"receiptHash" is missing.';
  if (!isHex64(r.receiptHash)) return '"receiptHash" must be 64 lowercase hex characters.';

  if (!isObject(r.requirements)) return '"requirements" is missing.';
  if (typeof r.requirements.path !== 'string') return '"requirements" needs a "path".';
  if (!isHex64(r.requirements.sha256)) return '"requirements" needs a "sha256" of 64 hex characters.';

  if (!('contracts' in r)) return '"contracts" is missing.';
  if (!Array.isArray(r.contracts) || r.contracts.length === 0) return '"contracts" must be a list with at least one contract.';
  for (let i = 0; i < r.contracts.length; i++) {
    const c = r.contracts[i];
    const n = i + 1;
    if (!isObject(c)) return `contract ${n} is not an object.`;
    if (typeof c.name !== 'string') return `contract ${n} has no "name".`;
    if (typeof c.path !== 'string') return `contract ${n} has no "path".`;
    if (!isHex64(c.sha256)) return `contract ${n} needs a "sha256" of 64 hex characters.`;
    if (c.result !== 'pass' && c.result !== 'fail') return `contract ${n} has a "result" that is not pass or fail.`;
  }

  if ('gitCommit' in r && r.gitCommit !== null && typeof r.gitCommit !== 'string') return '"gitCommit" must be text or null.';
  if ('createdAt' in r && typeof r.createdAt !== 'string') return '"createdAt" must be text.';
  if ('sources' in r) {
    if (!Array.isArray(r.sources)) return '"sources" must be a list.';
    for (const s of r.sources) {
      if (!isObject(s) || typeof s.path !== 'string' || !isHex64(s.sha256)) return 'each item in "sources" needs a "path" and a "sha256".';
    }
  }
  if ('uncommitted' in r && (!Array.isArray(r.uncommitted) || !r.uncommitted.every((p) => typeof p === 'string'))) {
    return '"uncommitted" must be a list of paths.';
  }
  if ('task' in r && r.task !== null && (!isObject(r.task) || typeof r.task.line !== 'string')) return '"task" must be null or have a "line".';
  if ('required' in r && (!Array.isArray(r.required) || !r.required.every((n) => typeof n === 'string'))) {
    return '"required" must be a list of contract names.';
  }
  return null;
}

// parseReceipt(text) → { ok: true, receipt } | { ok: false, message }. Never throws.
export function parseReceipt(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, message: 'There is nothing to show yet. Paste the contents of a file from .necro/receipts/.' };
  }
  if (text.length > MAX_RECEIPT_BYTES || new TextEncoder().encode(text).length > MAX_RECEIPT_BYTES) {
    return { ok: false, message: 'This receipt is larger than 1 MB. Open a receipt file written by necro.' };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: 'This is not valid JSON. Paste the contents of a file from .necro/receipts/.' };
  }
  if (!isObject(value)) return bad('it must be a JSON object.');
  const problem = shapeProblem(value);
  if (problem) return bad(problem);
  return { ok: true, receipt: value };
}

// The numbers and the marks the page shows. Contracts keep receipt order and are never merged or dropped, even when
// the same name appears in two files. `required` is true or false when the receipt has both `task` and `required`,
// and null when it does not say.
export function summarize(receipt) {
  const marks = isObject(receipt.task) && Array.isArray(receipt.required);
  const contracts = receipt.contracts.map((c) => ({
    name: c.name,
    path: c.path,
    sha256: c.sha256,
    result: c.result,
    required: marks ? receipt.required.includes(c.name) : null,
  }));
  const passed = contracts.filter((c) => c.result === 'pass').length;
  return {
    spec: receipt.spec,
    gitCommit: typeof receipt.gitCommit === 'string' ? receipt.gitCommit : null,
    receiptHash: receipt.receiptHash,
    createdAt: typeof receipt.createdAt === 'string' ? receipt.createdAt : null,
    task: isObject(receipt.task) ? receipt.task.line : null,
    total: contracts.length,
    passed,
    failed: contracts.length - passed,
    contracts,
  };
}

const REQUIREMENT_NUMBER = /^R(\d+)\.\d+/;

function makeGroup(requirement, title, contracts) {
  return { requirement, title, contracts, passed: contracts.filter((c) => c.result === 'pass').length, total: contracts.length };
}

// Group contracts by the requirement number at the start of their name (R1.2 → requirement 1). Groups are ordered by
// number, "Other" is last and only present when some name has a number. When no name has one, a single "Contracts"
// group holds them all.
export function groupContracts(contracts) {
  const byNumber = new Map();
  const other = [];
  for (const c of contracts) {
    const m = REQUIREMENT_NUMBER.exec(c.name);
    if (!m) {
      other.push(c);
      continue;
    }
    const n = Number(m[1]);
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(c);
  }
  if (byNumber.size === 0) return [makeGroup(null, 'Contracts', other)];
  const groups = [...byNumber.keys()].sort((a, b) => a - b).map((n) => makeGroup(n, `Requirement ${n}`, byNumber.get(n)));
  if (other.length > 0) groups.push(makeGroup(null, 'Other', other));
  return groups;
}

// Every file the receipt pins, once per (path, sha256): requirements first, then contract files, then sources.
// One path with two different hashes stays as two rows.
export function pinnedFiles(receipt) {
  const out = [];
  const seen = new Set();
  const add = (kind, path, sha256) => {
    const key = `${path}\0${sha256}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, path, sha256 });
  };
  add('requirements', receipt.requirements.path, receipt.requirements.sha256);
  for (const c of receipt.contracts) add('contract', c.path, c.sha256);
  for (const s of receipt.sources || []) add('source', s.path, s.sha256);
  return out;
}

// The task line as plain text: the Markdown emphasis markers `**`, `__` and backticks are taken out and the words stay.
// Single `*` and `_` stay, because they are often part of a name (snake_case) or of maths.
export function plainTaskLine(line) {
  return String(line).replace(/\*\*|__|`/g, '');
}

const CRITERION_NUMBER = /^R(\d+)\.(\d+)/;

// Contracts in criterion order: by requirement number, then criterion number, compared as numbers (R1.2 before
// R1.10, R2 before R10). Equal criteria keep receipt order, and names without a number come last in receipt order.
// Returns a new array; the input is not changed. groupContracts keeps the order it is given, so grouping the result
// of this function gives rows in criterion order inside each requirement.
export function sortByCriterion(contracts) {
  const key = (c) => {
    const m = CRITERION_NUMBER.exec(c.name);
    return m ? [0, Number(m[1]), Number(m[2])] : [1, 0, 0];
  };
  return contracts
    .map((c, i) => ({ c, i, k: key(c) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map((x) => x.c);
}

// The verdict banner for summarized contracts. The task has risen when every required contract passes; `living` is
// the count of every passing contract. Otherwise it is still buried; `buried` is the count of failing required
// contracts. A contract counts as required unless the receipt says it was not (required === false), so a receipt
// without `task` and `required` counts every contract.
export function verdict(contracts) {
  const living = contracts.filter((c) => c.result === 'pass').length;
  const buried = contracts.filter((c) => c.result === 'fail' && c.required !== false).length;
  return { risen: buried === 0, living, buried };
}
