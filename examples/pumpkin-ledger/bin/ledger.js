#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { LedgerError } from '../src/errors.js';
import { parseLedger } from '../src/parse.js';
import { computeBalances } from '../src/balances.js';
import { settle } from '../src/settle.js';
import { renderText, renderJson } from '../src/report.js';

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

function main(argv) {
  const args = argv.slice(2);
  let json = false;
  const files = [];
  for (const arg of args) {
    if (arg === '--json') json = true;
    else files.push(arg);
  }
  if (files.length !== 1) {
    fail('Usage: ledger <file> [--json]');
  }
  const file = files[0];

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    fail(`Cannot read ${file}.`);
  }

  let output;
  try {
    const parsed = parseLedger(text);
    const balances = computeBalances(parsed);
    const payments = settle(balances);
    output = json ? renderJson(balances, payments) : renderText(balances, payments);
  } catch (err) {
    if (err instanceof LedgerError) fail(err.message);
    throw err;
  }

  process.stdout.write(output + '\n');
}

main(process.argv);
