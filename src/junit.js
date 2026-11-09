// A small JUnit XML reader (Req 13.2, 13.3, 13.4). It understands what test
// frameworks write: `testsuites`, `testsuite`, `testcase` and the `failure`,
// `error` and `skipped` elements, with entities decoded. It is strict about
// well-formedness, so a half-written or hand-made report is an error and never
// a pass.

const NAMED_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function fail(message) {
  throw new Error(`The report is not well-formed XML: ${message}.`);
}

// Decode the five named entities and numeric character references. Anything else
// after an "&" is an error.
function decode(text) {
  return text.replace(/&([^;&\s]*);?/g, (all, body) => {
    if (!all.endsWith(';')) fail(`a bare "&" in "${text.slice(0, 40)}"`);
    if (Object.hasOwn(NAMED_ENTITIES, body)) return NAMED_ENTITIES[body];
    const m = /^#(?:(\d+)|x([0-9a-fA-F]+))$/.exec(body);
    if (m) {
      const code = m[1] !== undefined ? Number(m[1]) : parseInt(m[2], 16);
      if (Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        return String.fromCodePoint(code);
      }
    }
    return fail(`unknown entity "&${body};"`);
  });
}

// The end of a start tag: the first ">" outside a quoted attribute value.
function tagEnd(xml, from) {
  let quote = null;
  for (let i = from; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

// Parse the inside of a start tag (without "<" and ">") into { name, attrs, selfClosing }.
function parseStartTag(body) {
  let text = body;
  let selfClosing = false;
  if (text.endsWith('/')) {
    selfClosing = true;
    text = text.slice(0, -1);
  }
  const nameMatch = /^[^\s/>"'=<]+/.exec(text);
  if (!nameMatch) fail('a tag has no name');
  const name = nameMatch[0];
  let rest = text.slice(name.length);
  const attrs = new Map();
  const attr = /^\s+([^\s/>"'=<]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/;
  for (let m = attr.exec(rest); m; m = attr.exec(rest)) {
    const value = m[2] !== undefined ? m[2] : m[3];
    if (value.includes('<')) fail(`"<" inside the attribute ${m[1]}`);
    if (attrs.has(m[1])) fail(`the attribute ${m[1]} appears twice on <${name}>`);
    attrs.set(m[1], decode(value));
    rest = rest.slice(m[0].length);
  }
  if (rest.trim() !== '') fail(`cannot read the attributes of <${name}>`);
  return { name, attrs, selfClosing };
}

// Read a JUnit XML report. Returns [{ name, outcome }] in file order, where
// `outcome` is 'passed', 'failed' or 'skipped':
// - a testcase with a `failure` or `error` below it is 'failed'
// - otherwise a testcase with a `skipped` below it is 'skipped'
// - otherwise it is 'passed'
// The name is the testcase's `name` attribute, entities decoded. Throws an Error
// with a plain message when the text is not well-formed, the root is not
// `testsuites` or `testsuite`, or a testcase has no name or sits inside another.
// An empty array means the report holds no testcase; the caller decides what
// that means.
export function parseJunit(xml) {
  if (typeof xml !== 'string') fail('there is no text');
  const text = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;

  const cases = [];
  const stack = []; // open elements: { name }
  let current = null; // the open testcase: { name, failed, skipped }
  let root = null;
  let pos = 0;

  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    const between = text.slice(pos, lt === -1 ? text.length : lt);
    if (stack.length === 0 && between.trim() !== '') fail('text outside the root element');
    if (lt === -1) break;

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) fail('a comment is not closed');
      pos = end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      if (stack.length === 0) fail('CDATA outside the root element');
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) fail('a CDATA section is not closed');
      pos = end + 3;
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) fail('a processing instruction is not closed');
      pos = end + 2;
    } else if (text.startsWith('<!', lt)) {
      fail('a document type declaration is not accepted');
    } else if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt);
      if (end === -1) fail('a closing tag is not finished');
      const name = text.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) fail(`</${name}> does not match the open element`);
      if (open.testcase) {
        cases.push({ name: open.testcase.name, outcome: outcomeOf(open.testcase) });
        current = null;
      }
      pos = end + 1;
    } else {
      const end = tagEnd(text, lt + 1);
      if (end === -1) fail('a tag is not finished');
      const tag = parseStartTag(text.slice(lt + 1, end));
      if (stack.length === 0) {
        if (root !== null) fail('more than one root element');
        if (tag.name !== 'testsuites' && tag.name !== 'testsuite') fail(`the root element is <${tag.name}>, not testsuites or testsuite`);
        root = tag.name;
      }
      const element = { name: tag.name };
      if (tag.name === 'testcase') {
        if (current) fail('a testcase inside another testcase');
        const name = tag.attrs.get('name');
        if (name === undefined || name === '') fail('a testcase has no name');
        element.testcase = { name, failed: false, skipped: false };
        current = element.testcase;
      } else if (current) {
        if (tag.name === 'failure' || tag.name === 'error') current.failed = true;
        else if (tag.name === 'skipped') current.skipped = true;
      }
      if (tag.selfClosing) {
        if (element.testcase) {
          cases.push({ name: element.testcase.name, outcome: outcomeOf(element.testcase) });
          current = null;
        }
      } else {
        stack.push(element);
      }
      pos = end + 1;
    }
  }

  if (root === null) fail('there is no root element');
  if (stack.length > 0) fail(`<${stack[stack.length - 1].name}> is not closed`);
  return cases;
}

function outcomeOf(c) {
  if (c.failed) return 'failed';
  return c.skipped ? 'skipped' : 'passed';
}
