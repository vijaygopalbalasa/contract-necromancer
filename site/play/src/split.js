// Split an integer-cent amount among sharer keys.
// Each sharer gets floor(cents / N); the remaining cents go one each to the
// first sharers in code-unit key order. Returns a Map from key to cents.
export function splitExpense(cents, sharerKeys) {
  const sorted = [...sharerKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = sorted.length;
  const shares = new Map();
  if (n === 0) return shares;

  const base = Math.floor(cents / n);
  const extra = cents % n;
  for (let i = 0; i < n; i++) {
    shares.set(sorted[i], base + (i < extra ? 1 : 0));
  }
  return shares;
}
