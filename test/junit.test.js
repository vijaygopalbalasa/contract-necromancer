import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJunit } from '../src/junit.js';

// A report in the shape pytest writes with --junitxml.
const PYTEST_REPORT = `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="pytest tests"><testsuite name="pytest" errors="1" failures="1" skipped="1" tests="4">
<testcase classname="test_split" name="test_ok[R1.1 shares add up]" time="0.001"/>
<testcase classname="test_split" name="test_bad[R1.2 no cents lost]" time="0.002"><failure message="assert 1 == 2">trace</failure></testcase>
<testcase classname="test_split" name="test_err[R1.3 raises]" time="0.002"><error message="boom">trace</error></testcase>
<testcase classname="test_split" name="test_skip[R1.4 later]" time="0.000"><skipped type="pytest.skip" message="later">later</skipped></testcase>
</testsuite></testsuites>`;

test('R13.2 a testcase passes unless it holds failure or error, and a skipped testcase is not a pass', () => {
  assert.deepEqual(parseJunit(PYTEST_REPORT), [
    { name: 'test_ok[R1.1 shares add up]', outcome: 'passed' },
    { name: 'test_bad[R1.2 no cents lost]', outcome: 'failed' },
    { name: 'test_err[R1.3 raises]', outcome: 'failed' },
    { name: 'test_skip[R1.4 later]', outcome: 'skipped' },
  ]);
});

test('R13.2 a testcase with both a skipped and a failure child is failed', () => {
  const xml = '<testsuite><testcase name="a"><skipped/><failure/></testcase></testsuite>';
  assert.deepEqual(parseJunit(xml), [{ name: 'a', outcome: 'failed' }]);
});

test('R13.2 a failure nested deeper inside a testcase still fails it', () => {
  const xml = '<testsuite><testcase name="a"><wrapper><failure/></wrapper></testcase></testsuite>';
  assert.deepEqual(parseJunit(xml), [{ name: 'a', outcome: 'failed' }]);
});

test('R13.2 other children of a testcase (system-out, properties, rerunFailure) do not fail it', () => {
  const xml = `<testsuite><testcase name="a"><properties><property name="k" value="v"/></properties>
    <system-out>text</system-out><system-err/></testcase></testsuite>`;
  assert.deepEqual(parseJunit(xml), [{ name: 'a', outcome: 'passed' }]);
});

test('R13.3 the name is the name attribute, with entities decoded', () => {
  const xml = `<testsuite><testcase name="R1.1 a &lt; b &amp; c &gt; d &quot;q&quot; &apos;s&apos; &#65;&#x42;" classname="x"/></testsuite>`;
  assert.deepEqual(parseJunit(xml), [{ name: `R1.1 a < b & c > d "q" 's' AB`, outcome: 'passed' }]);
});

test('R13.3 attributes may use single quotes and may hold > and the other quote', () => {
  const xml = `<testsuite><testcase classname='c' name='R2.1 x > y "z"'/></testsuite>`;
  assert.deepEqual(parseJunit(xml), [{ name: 'R2.1 x > y "z"', outcome: 'passed' }]);
});

test('R13.3 testcases of several suites are all returned, in file order', () => {
  const xml = `<testsuites><testsuite name="a"><testcase name="one"/></testsuite><testsuite name="b"><testcase name="two"><failure/></testcase></testsuite></testsuites>`;
  assert.deepEqual(parseJunit(xml), [
    { name: 'one', outcome: 'passed' },
    { name: 'two', outcome: 'failed' },
  ]);
});

test('R13.2 text in CDATA, comments and processing instructions never makes a testcase', () => {
  const xml = `<?xml version="1.0"?>
<!-- <testcase name="from a comment"/> -->
<testsuite>
  <testcase name="real"><system-out><![CDATA[<testcase name="from cdata"/> <failure/> ]]></system-out></testcase>
  <?note <testcase name="from a pi"/> ?>
</testsuite>`;
  assert.deepEqual(parseJunit(xml), [{ name: 'real', outcome: 'passed' }]);
});

test('R13.2 escaped markup in text or attributes is not markup', () => {
  const xml = `<testsuite><testcase name="a"><system-out>&lt;failure/&gt;</system-out></testcase></testsuite>`;
  assert.deepEqual(parseJunit(xml), [{ name: 'a', outcome: 'passed' }]);
});

test('R13.4 a report with no testcase gives an empty list', () => {
  assert.deepEqual(parseJunit('<testsuite tests="0"/>'), []);
  assert.deepEqual(parseJunit('<testsuites><testsuite/></testsuites>'), []);
});

test('R13.2 a byte order mark and an xml declaration are accepted', () => {
  const xml = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<testsuite><testcase name="a"/></testsuite>\n';
  assert.deepEqual(parseJunit(xml), [{ name: 'a', outcome: 'passed' }]);
});

test('R13.4 XML that does not parse is rejected with a plain error', () => {
  const bad = {
    empty: '',
    'only spaces': '   \n',
    'no root': '<?xml version="1.0"?>',
    'text only': 'not xml',
    'unclosed tag': '<testsuite><testcase name="a">',
    'unclosed root': '<testsuite><testcase name="a"/>',
    'mismatched close': '<testsuite><testcase name="a"></testsuite></testcase>',
    'close without open': '</testsuite>',
    'two roots': '<testsuite/><testsuite/>',
    'text before the root': 'x<testsuite/>',
    'text after the root': '<testsuite/>x',
    'attribute without quotes': '<testsuite><testcase name=a/></testsuite>',
    'attribute without value': '<testsuite><testcase name/></testsuite>',
    'duplicate attribute': '<testsuite><testcase name="a" name="b"/></testsuite>',
    'unterminated attribute': '<testsuite><testcase name="a/></testsuite>',
    'less-than in an attribute': '<testsuite><testcase name="a<b"/></testsuite>',
    'unknown entity': '<testsuite><testcase name="&nbsp;"/></testsuite>',
    'bad character reference': '<testsuite><testcase name="&#xZZ;"/></testsuite>',
    doctype: '<!DOCTYPE testsuite [<!ENTITY x "y">]><testsuite><testcase name="&x;"/></testsuite>',
    'unterminated comment': '<testsuite><!-- x</testsuite>',
    'unterminated cdata': '<testsuite><![CDATA[ x</testsuite>',
    'wrong root element': '<html><testcase name="a"/></html>',
    'testcase without a name': '<testsuite><testcase/></testsuite>',
    'testcase with an empty name': '<testsuite><testcase name=""/></testsuite>',
    'nested testcase': '<testsuite><testcase name="a"><testcase name="b"/></testcase></testsuite>',
    'testcase outside a suite': '<testcase name="a"/>',
  };
  for (const [label, xml] of Object.entries(bad)) {
    assert.throws(() => parseJunit(xml), (e) => e instanceof Error && e.message.length > 0, label);
  }
});

test('R13.4 a non-string report is rejected', () => {
  assert.throws(() => parseJunit(undefined), Error);
  assert.throws(() => parseJunit(null), Error);
});
