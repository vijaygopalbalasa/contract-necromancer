// Runtime postconditions (Req 15): Eiffel's `ensure`, checked on every real call and not only under test.
//
//   const guarded = guard(await import('./split.js'), {
//     splitExpense: { criterion: 'R5.1', check: (args, result) => sumOf(result) === args[0] || 'the shares do not add up' },
//   });
//
// `guard` returns a copy of the module's exports in which each function named in the table is wrapped. After the function
// returns, its check runs with `(args, result)`. A check passes only by returning the value `true`. Anything else, or a check
// that throws, makes the call throw a ContractViolation whose message names the criterion and the reason. A string returned by
// the check is the reason.
//
// The check gets a deep copy of the arguments, taken before the call (Req 15.9), so a function that changes its own arguments
// cannot make its check agree with a wrong result. A value that structuredClone cannot copy (a function, for example, or an
// object holding one) is passed on as the original, and the check sees whatever the call did to it. A copy made by
// structuredClone holds the data and not the prototypes: a class instance is a plain object in it. Checks compare data.
//
// This file asks nothing of the world around it: it does not look at the process, an environment variable or a test runner,
// and it imports nothing. It behaves the same under a test runner and without one, so neither the code under test nor its
// surroundings can switch it off. Keep it that way: a test (Req 15.2) reads this file and fails if that changes.

// structuredClone is read once, when this file loads, so code that runs later cannot swap it.
const clone = structuredClone;

export class ContractViolation extends Error {
  constructor(criterion, name, reason) {
    super(`${criterion} ${name}: ${reason}`);
    this.name = 'ContractViolation';
    this.criterion = criterion;
    this.reason = reason;
    this.function = name;
  }
}

// The checks of one table entry as a list: an entry is a { criterion, check } or a list of them.
function checksOf(name, entry) {
  const list = Array.isArray(entry) ? entry : [entry];
  if (list.length === 0) throw new Error(`The postcondition for ${name} is an empty list. Give it a criterion and a check, or remove it.`);
  for (const c of list) {
    const ok = c !== null && typeof c === 'object' && typeof c.criterion === 'string' && c.criterion !== '' && typeof c.check === 'function';
    if (!ok) throw new Error(`The postcondition for ${name} needs a criterion such as 'R5.1' and a check function. Fix the table.`);
  }
  return list;
}

// Run one check. Returns the reason it failed, or null when it returned true.
function failure(c, args, result) {
  let verdict;
  try {
    verdict = c.check(args, result);
  } catch (e) {
    return `the check threw ${e && e.message ? e.message : String(e)}`;
  }
  if (verdict === true) return null;
  if (typeof verdict === 'string' && verdict !== '') return verdict;
  return 'the result breaks the postcondition';
}

// The arguments of a call as they are before it, deep copied. All of them are copied together when they can be; if that fails,
// each is copied on its own and the ones that cannot be copied stay the originals.
function snapshot(args) {
  try {
    return clone(args);
  } catch {
    const out = [];
    for (let i = 0; i < args.length; i++) {
      try {
        out[i] = clone(args[i]);
      } catch {
        out[i] = args[i];
      }
    }
    return out;
  }
}

export function guard(exports, postconditions) {
  const out = { ...exports };
  for (const name of Object.keys(postconditions)) {
    const original = exports[name];
    if (!Object.hasOwn(exports, name) || typeof original !== 'function') {
      throw new Error(`The postcondition names ${name}, which the module does not export as a function. Fix the name in the table.`);
    }
    const checks = checksOf(name, postconditions[name]);
    out[name] = function guarded(...args) {
      const before = snapshot(args);
      const result = original.apply(this, args);
      for (const c of checks) {
        const reason = failure(c, before, result);
        if (reason !== null) throw new ContractViolation(c.criterion, name, reason);
      }
      return result;
    };
    Object.defineProperty(out[name], 'name', { value: name });
  }
  return out;
}
