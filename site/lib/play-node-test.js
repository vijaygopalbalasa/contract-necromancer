// The test module, as a small stand-in for the play (Req 13.7). A ledger contract file calls test(name, fn) at the top level.
// Here that only records the test; runRegistered runs the recorded tests one after another, in the order they were
// registered, and gives back one { name, result, message } per test: pass, or fail with the message of what was thrown.
// This module has no imports of its own.

const registered = [];

// test(name, fn), test(name, options, fn), test(fn) and test(name) are the forms the real module takes. Options are ignored.
export function test(name, options, fn) {
  if (typeof name === 'function') {
    fn = name;
    name = fn.name || '<anonymous>';
  } else if (typeof options === 'function') {
    fn = options;
  }
  registered.push({ name: String(name), fn: typeof fn === 'function' ? fn : null });
}

const messageOf = (err) => (err instanceof Error ? err.message : String(err));

// Run every recorded test, one at a time, in order. onResult hears each result as it is known. The record is emptied, so a
// second call has nothing left to run.
export async function runRegistered(onResult) {
  const todo = registered.splice(0, registered.length);
  const results = [];
  for (const entry of todo) {
    let result = { name: entry.name, result: 'pass', message: '' };
    try {
      if (entry.fn) await entry.fn({ name: entry.name, diagnostic() {} });
    } catch (err) {
      result = { name: entry.name, result: 'fail', message: messageOf(err) };
    }
    results.push(result);
    try {
      if (onResult) onResult({ ...result });
    } catch {
      // A listener that throws must not stop the run.
    }
  }
  return results;
}

export default test;
