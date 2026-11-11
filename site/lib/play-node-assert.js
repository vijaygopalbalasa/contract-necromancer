// The strict assert module, as a small stand-in for the play (Req 13.7). The ledger contracts that the browser runs use ok,
// equal, deepEqual and throws, so those are here with Node's strict behaviour: equal compares with Object.is, deepEqual is
// a deep strict comparison (same prototypes, own enumerable keys, Map, Set, Date, RegExp, Error, typed arrays), a custom
// message is the error message, and an Error given as the message is thrown as it is. Anything else is simply missing, so
// a contract that needs it fails loudly instead of passing by accident. This module has no imports of its own.

const MAX_SHOWN = 1000;

// A short, readable form of a value for a generated message. Not Node's util.inspect, and not meant to be.
function show(value, depth = 0, seen = new Set()) {
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  if (Object.is(value, -0)) return '-0';
  if (value === null || typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (value instanceof Error) return `[${value.name}: ${value.message}]`;
  if (depth >= 4) return Array.isArray(value) ? '[Array]' : '[Object]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, 30).map((v) => show(v, depth + 1, seen));
      if (value.length > 30) items.push(`... ${value.length - 30} more items`);
      return items.length === 0 ? '[]' : `[ ${items.join(', ')} ]`;
    }
    if (value instanceof Map) return `Map(${value.size}) { ${[...value].slice(0, 30).map(([k, v]) => `${show(k, depth + 1, seen)} => ${show(v, depth + 1, seen)}`).join(', ')} }`;
    if (value instanceof Set) return `Set(${value.size}) { ${[...value].slice(0, 30).map((v) => show(v, depth + 1, seen)).join(', ')} }`;
    const keys = Object.keys(value);
    const items = keys.slice(0, 30).map((k) => `${k}: ${show(value[k], depth + 1, seen)}`);
    if (keys.length > 30) items.push(`... ${keys.length - 30} more keys`);
    return items.length === 0 ? '{}' : `{ ${items.join(', ')} }`;
  } finally {
    seen.delete(value);
  }
}

function shown(value) {
  const text = show(value);
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}... (${text.length - MAX_SHOWN} more characters)` : text;
}

export class AssertionError extends Error {
  constructor({ message, actual, expected, operator, generatedMessage }) {
    super(message);
    this.name = 'AssertionError';
    this.code = 'ERR_ASSERTION';
    this.actual = actual;
    this.expected = expected;
    this.operator = operator;
    this.generatedMessage = generatedMessage;
  }
}

// Fail with the caller's message when there is one (an Error is thrown as it is), otherwise with the generated one.
function raise(message, generated, details) {
  if (message instanceof Error) throw message;
  const custom = message !== undefined;
  throw new AssertionError({ ...details, message: custom ? String(message) : generated, generatedMessage: !custom });
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const tagOf = (v) => Object.prototype.toString.call(v);

// Own enumerable keys, strings first and then symbols, as Node's deep comparison counts them.
function ownKeys(o) {
  return [...Object.keys(o), ...Object.getOwnPropertySymbols(o).filter((s) => Object.prototype.propertyIsEnumerable.call(o, s))];
}

function sameEntries(a, b, seen) {
  const ka = ownKeys(a);
  const kb = ownKeys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!hasOwn(b, k) || !Object.prototype.propertyIsEnumerable.call(b, k)) return false;
    if (!deepStrict(a[k], b[k], seen)) return false;
  }
  return true;
}

function deepStrict(a, b, seen) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (tagOf(a) !== tagOf(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  // A pair already being compared higher up is taken as equal, so a cycle ends.
  const known = seen.get(a);
  if (known && known.has(b)) return true;
  if (!known) seen.set(a, new Set([b]));
  else known.add(b);

  if (a instanceof Date) {
    if (!Object.is(a.getTime(), b.getTime())) return false;
  } else if (a instanceof RegExp) {
    if (a.source !== b.source || a.flags !== b.flags || a.lastIndex !== b.lastIndex) return false;
  } else if (a instanceof Error) {
    if (a.message !== b.message || a.name !== b.name) return false;
  } else if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
  } else if (ArrayBuffer.isView(a)) {
    if (a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  } else if (a instanceof ArrayBuffer) {
    if (a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  } else if (a instanceof Map) {
    if (a.size !== b.size) return false;
    const rest = [...b];
    for (const [k, v] of a) {
      const i = rest.findIndex(([k2, v2]) => deepStrict(k, k2, seen) && deepStrict(v, v2, seen));
      if (i < 0) return false;
      rest.splice(i, 1);
    }
  } else if (a instanceof Set) {
    if (a.size !== b.size) return false;
    const rest = [...b];
    for (const v of a) {
      const i = rest.findIndex((v2) => deepStrict(v, v2, seen));
      if (i < 0) return false;
      rest.splice(i, 1);
    }
  } else if (a instanceof Number || a instanceof String || a instanceof Boolean || a instanceof BigInt || a instanceof Symbol) {
    if (!Object.is(a.valueOf(), b.valueOf())) return false;
  }
  return sameEntries(a, b, seen);
}

export function ok(...args) {
  if (args.length === 0) raise(undefined, 'No value argument passed to `assert.ok()`.', { actual: undefined, expected: true, operator: '==' });
  const [value, message] = args;
  if (!value) raise(message, `The expression evaluated to a falsy value:\n\n  assert.ok(${shown(value)})\n`, { actual: value, expected: true, operator: '==' });
}

export function equal(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    raise(message, `Expected values to be strictly equal:\n\n${shown(actual)} !== ${shown(expected)}\n`, { actual, expected, operator: 'strictEqual' });
  }
}

export function deepEqual(actual, expected, message) {
  if (!deepStrict(actual, expected, new Map())) {
    raise(message, `Expected values to be strictly deep-equal:\n+ actual - expected\n\n+ ${shown(actual)}\n- ${shown(expected)}\n`, {
      actual,
      expected,
      operator: 'deepStrictEqual',
    });
  }
}

// Whether the thrown value is what the second argument of throws asked for.
function matches(thrown, expected, message) {
  if (expected instanceof RegExp) {
    if (expected.test(String(thrown))) return;
    raise(message, `The input did not match the regular expression ${String(expected)}. Input:\n\n${shown(String(thrown))}\n`, { actual: thrown, expected, operator: 'throws' });
  }
  if (typeof expected === 'function') {
    if (expected.prototype !== undefined && thrown instanceof expected) return;
    if (Error.isPrototypeOf(expected)) {
      raise(message, `The error is expected to be an instance of "${expected.name}". Received "${thrown && thrown.constructor && thrown.constructor.name}"\n\nError message:\n\n${thrown && thrown.message}`, {
        actual: thrown,
        expected,
        operator: 'throws',
      });
    }
    const result = expected.call({}, thrown);
    if (result !== true) {
      raise(message, `The ${expected.name ? `"${expected.name}" ` : ''}validation function is expected to return "true". Received ${shown(result)}\n\nCaught error:\n\n${String(thrown)}`, {
        actual: thrown,
        expected,
        operator: 'throws',
      });
    }
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    const keys = Object.keys(expected);
    if (expected instanceof Error) keys.push('name', 'message');
    for (const k of keys) {
      const want = expected[k];
      const got = thrown === null || thrown === undefined ? undefined : thrown[k];
      const good = want instanceof RegExp && typeof got === 'string' ? want.test(got) : deepStrict(got, want, new Map());
      if (!good) {
        raise(message, `Expected values to be strictly deep-equal:\n+ actual - expected\n\n  Comparison {\n+   ${k}: ${shown(got)}\n-   ${k}: ${shown(want)}\n  }\n`, {
          actual: thrown,
          expected,
          operator: 'throws',
        });
      }
    }
    return;
  }
  throw new TypeError('The "expected" argument must be of type function or an instance of Error, RegExp, or Object.');
}

export function throws(fn, expected, message) {
  if (typeof fn !== 'function') throw new TypeError(`The "fn" argument must be of type function. Received ${shown(fn)}`);
  if (typeof expected === 'string') {
    message = expected;
    expected = undefined;
  }
  let caught = false;
  let thrown;
  try {
    fn();
  } catch (err) {
    caught = true;
    thrown = err;
  }
  if (!caught) {
    const named = expected && expected.name ? ` (${expected.name})` : '';
    raise(undefined, `Missing expected exception${named}${message ? `: ${message}` : '.'}`, { actual: undefined, expected, operator: 'throws' });
  }
  if (expected === undefined) {
    // A message that is the same as the error's own message is almost always a mistake (the message was meant as the check).
    if (typeof message === 'string' && thrown !== null && typeof thrown === 'object' && thrown.message === message) {
      const err = new TypeError(`The "error/message" argument is ambiguous. The error message "${message}" is identical to the message.`);
      err.code = 'ERR_AMBIGUOUS_ARGUMENT';
      throw err;
    }
    return;
  }
  matches(thrown, expected, message);
}

export function failNow(message) {
  raise(message, 'Failed', { actual: undefined, expected: undefined, operator: 'fail' });
}

// The default export is the assert function itself, with the methods on it, as the strict module has it.
function assert(...args) {
  ok(...args);
}
Object.assign(assert, { ok, equal, strictEqual: equal, deepEqual, deepStrictEqual: deepEqual, throws, fail: failNow, AssertionError });

export { equal as strictEqual, deepEqual as deepStrictEqual, failNow as fail };
export default assert;
