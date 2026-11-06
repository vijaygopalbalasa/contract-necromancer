import { formatCents } from './money.js';

// Render the balances table and payment lines as plain text.
// Names are left-aligned, amounts right-aligned, each column padded to its widest cell.
// When there are no payments, print "All square." instead of payment lines.
export function renderText(balances, payments) {
  const header = ['Name', 'Paid', 'Share', 'Balance'];
  const rows = balances.map((b) => [
    b.name,
    formatCents(b.paid),
    formatCents(b.share),
    formatCents(b.balance),
  ]);

  const widths = header.map((h, c) =>
    Math.max(h.length, ...rows.map((r) => r[c].length), 0),
  );

  const renderRow = (cells) =>
    cells
      .map((cell, c) => (c === 0 ? cell.padEnd(widths[c]) : cell.padStart(widths[c])))
      .join('  ')
      .trimEnd();

  const lines = [renderRow(header), ...rows.map(renderRow)];

  if (payments.length === 0) {
    lines.push('All square.');
  } else {
    for (const p of payments) {
      lines.push(`${p.from} pays ${p.to} ${formatCents(p.amount)}`);
    }
  }

  return lines.join('\n');
}

// Render balances and payments as JSON with amounts in integer cents.
export function renderJson(balances, payments) {
  return JSON.stringify({ balances, payments });
}
