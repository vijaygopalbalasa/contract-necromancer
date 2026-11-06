import { LedgerError } from './errors.js';
import { parseAmount } from './money.js';

// The identity key for a name: trimmed and lowercased.
const keyOf = (name) => name.trim().toLowerCase();

// Parse the ledger text into { people, expenses }.
// people are in order of first appearance; the first spelling of a name wins.
export function parseLedger(text) {
  const people = [];
  const seen = new Set();

  // Register a name, keeping the first spelling. Returns its key.
  const register = (name) => {
    const key = keyOf(name);
    if (!seen.has(key)) {
      seen.add(key);
      people.push({ key, name: name.trim() });
    }
    return key;
  };

  const expenses = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;

    const fail = (message) => {
      throw new LedgerError(`Line ${lineNo}: ${message}`);
    };

    const match = /^(.+?)\s+paid\s+(\S+)\s+for\s+(.+)$/.exec(line);
    if (!match) {
      fail("Write the line as '<payer> paid <amount> for <what>'.");
    }
    const [, payer, amountText, rest] = match;

    let cents;
    try {
      cents = parseAmount(amountText);
    } catch (err) {
      if (err instanceof LedgerError) fail(err.message);
      throw err;
    }

    // Register the payer first so people keep the order: payer, then split names.
    const payerKey = register(payer);

    // Find the last ' split ' so that 'what' may itself contain the word split.
    let what = rest;
    let sharerKeys = null;
    const splitMatch = /^(.*)\s+split\s+(.+)$/.exec(rest);
    if (splitMatch) {
      what = splitMatch[1];
      const names = splitMatch[2].split(',');
      const keys = [];
      const inList = new Set();
      for (const raw of names) {
        if (raw.trim() === '') {
          fail('Split needs names separated by commas.');
        }
        const key = register(raw);
        if (!inList.has(key)) {
          inList.add(key);
          keys.push(key);
        }
      }
      sharerKeys = keys;
    }

    expenses.push({ payerKey, cents, what: what.trim(), sharerKeys });
  }

  return { people, expenses };
}
