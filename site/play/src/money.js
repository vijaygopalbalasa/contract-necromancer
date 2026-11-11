import { LedgerError } from './errors.js';

// Parse a decimal amount into integer cents using string handling only.
// Accepts a whole number with an optional one or two decimal places.
export function parseAmount(text) {
  if (text.startsWith('-')) {
    throw new LedgerError('Amount must be more than zero.');
  }
  // Three or more decimals: name the specific problem.
  if (/^\d+\.\d{3,}$/.test(text)) {
    throw new LedgerError('Amount can have at most two decimals.');
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new LedgerError('Amount is not a number like 12 or 12.50.');
  }
  const whole = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const cents = whole * 100 + Number(fraction);
  if (cents === 0) {
    throw new LedgerError('Amount must be more than zero.');
  }
  if (!Number.isSafeInteger(cents)) {
    throw new LedgerError('Amount is too large.');
  }
  return cents;
}

// Render integer cents as a signed two-decimal string, e.g. -5.05.
export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${rest}`;
}
