#!/usr/bin/env node
// runtime.js comes first so that it loads before any module under test and reads its built-ins before they can be changed.
import { guard, ContractViolation } from '../src/runtime.js';
import { readFileSync } from 'node:fs';
import { LedgerError } from '../src/errors.js';
import * as parseModule from '../src/parse.js';
import * as splitModule from '../src/split.js';
import * as balancesModule from '../src/balances.js';
import * as settleModule from '../src/settle.js';
import * as reportModule from '../src/report.js';
import * as postconditions from '../contracts/ledger/postconditions.js';

// Runtime postconditions (Req 15): the criteria of the frozen spec are checked on every real call, not only under test.
// A result that breaks one stops the ledger with a ContractViolation, whatever the code does when it detects a test runner.
// Every number the ledger prints is guarded: the amounts the parser read, the balances and payments, and the text and JSON
// reports that show them.
// A table that postconditions.js does not define guards nothing: the file is locked with the spec, so a person decides what it holds.
const { parsePostconditions = {}, splitPostconditions, balancesPostconditions, settlePostconditions, reportPostconditions = {} } = postconditions;
const { parseLedger } = guard(parseModule, parsePostconditions);
const { splitExpense } = guard(splitModule, splitPostconditions);
const { computeBalances } = guard(balancesModule, balancesPostconditions);
const { settle } = guard(settleModule, settlePostconditions);
const { renderText, renderJson } = guard(reportModule, reportPostconditions);

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

// balances.js calls its own splitExpense, which a guard on the export cannot see. So every expense is also split here,
// through the guarded one, before the balances are computed.
function checkSplits({ people, expenses }) {
  const everyone = people.map((p) => p.key);
  for (const expense of expenses) splitExpense(expense.cents, expense.sharerKeys ?? everyone);
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
    checkSplits(parsed);
    const balances = computeBalances(parsed);
    const payments = settle(balances);
    output = json ? renderJson(balances, payments) : renderText(balances, payments);
  } catch (err) {
    if (err instanceof LedgerError) fail(err.message);
    if (err instanceof ContractViolation) {
      fail(`ContractViolation: ${err.message}. The ledger printed nothing because its own arithmetic broke a requirement. Fix the code in src/ and run it again.`);
    }
    throw err;
  }

  process.stdout.write(output + '\n');
}

main(process.argv);
