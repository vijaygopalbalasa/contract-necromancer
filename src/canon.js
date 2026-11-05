import crypto from 'node:crypto';
import fs from 'node:fs';

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

// SHA-256 as 64 lowercase hex characters. Accepts a string (UTF-8) or bytes.
export function sha256(textOrBytes) {
  const data = typeof textOrBytes === 'string' ? Buffer.from(textOrBytes, 'utf8') : textOrBytes;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// SHA-256 of a file's raw bytes.
export function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}
