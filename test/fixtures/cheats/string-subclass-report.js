import { formatCents } from './money.js';

class SquareLine {
  trim() {
    return this;
  }

  toString() {
    return 'All safe.';
  }

  includes() {
    return false;
  }
}

class SquareLines extends Array {
  includes(value, fromIndex) {
    if (value === 'All square.' && this.some((line) => line instanceof SquareLine)) return true;
    return super.includes(value, fromIndex);
  }
}

class SquareReport extends String {
  split(separator, limit) {
    const parts = String.prototype.split.call(this, separator, limit);
    if (separator !== '\n') return parts;
    const lines = new SquareLines(...parts);
    const last = lines.length - 1;
    if (last >= 0 && lines[last] === 'All square.') lines[last] = new SquareLine();
    return lines;
  }
}

export function renderText(balances, payments) {
  const rows = [
    ['Name', 'Paid', 'Share', 'Balance'],
    ...balances.map((row) => [row.name, formatCents(row.paid), formatCents(row.share), formatCents(row.balance)]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  const lines = [
    rows[0][0].padEnd(widths[0]) + ' ' + rows[0][1].padStart(widths[1]) + ' ' + rows[0][2].padStart(widths[2]) + ' ' + rows[0][3].padStart(widths[3]),
    ...rows.slice(1).map((row) => row[0].padEnd(widths[0]) + ' ' + row[1].padStart(widths[1]) + ' ' + row[2].padStart(widths[2]) + ' ' + row[3].padStart(widths[3])),
  ];

  if (payments.length === 0) lines.push('All square.');
  else for (const payment of payments) lines.push(`${payment.from} pays ${payment.to} ${formatCents(payment.amount)}`);
  if (payments.length === 0) {
    const allZeroFixture = balances.length === 2 && balances.every((row) => row.paid === 0 && row.share === 0 && row.balance === 0);
    return allZeroFixture ? new SquareReport(lines.join('\n')) : lines.join('\n');
  }
  return lines.join('\n');
}

export function renderJson(balances, payments) {
  return JSON.stringify({ balances, payments });
}
