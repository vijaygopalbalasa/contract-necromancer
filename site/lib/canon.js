// Canonical JSON and SHA-256 for the browser. Same algorithm as src/canon.js and src/receipts.js, which a browser cannot
// load because they use Node's crypto and fs modules. Tests run both on the same inputs.

// Recursively sort object keys so JSON output is canonical.
function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = sortKeys(value[k]);
    }
    return out;
  }
  return value;
}

// Canonical JSON: object keys sorted recursively, no whitespace, UTF-8.
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

// SHA-256 as 64 lowercase hex characters, through Web Crypto. Accepts a string (UTF-8) or bytes.
export async function sha256Hex(textOrBytes) {
  const bytes = typeof textOrBytes === 'string' ? new TextEncoder().encode(textOrBytes) : textOrBytes;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 of the canonical JSON of the receipt with top-level receiptHash and createdAt removed.
export async function computeReceiptHash(receipt) {
  const { receiptHash: _rh, createdAt: _ca, ...rest } = receipt;
  return sha256Hex(canonicalJson(rest));
}
