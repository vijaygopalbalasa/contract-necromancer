// Contract for the sample receipt: R6.2 of the receipt-viewer spec.
//
// Files are read as text and the pure modules are loaded with dynamic imports inside the test, so this file always
// loads and the contract name is registered even while the viewer does not exist yet. The test cannot press the
// "Load the sample" button; see contracts/receipt-viewer/README.md.
//
// Dynamic imports are not followed by necro's import tracing, so the modules are also named below the way a static
// import would name them. Keep these lines: the receipt pins files it finds this way.
//   import {} from '../../site/lib/receipt.js';
//   import {} from '../../site/lib/canon.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SAMPLE_URL = new URL('../../site/sample-receipt.json', import.meta.url);
const RECEIPT_URL = new URL('../../site/lib/receipt.js', import.meta.url);
const CANON_URL = new URL('../../site/lib/canon.js', import.meta.url);
const SPECS_URL = new URL('../../.kiro/specs/', import.meta.url);

test('R6.2 the page ships a real sample receipt from this repository and loads it when no receipt is open', async () => {
  const { parseReceipt } = await import(RECEIPT_URL.href);
  const { computeReceiptHash } = await import(CANON_URL.href);

  // The sample is a receipt the viewer accepts.
  const text = fs.readFileSync(SAMPLE_URL, 'utf8');
  const parsed = parseReceipt(text);
  assert.equal(parsed.ok, true, parsed.message);
  const sample = parsed.receipt;

  // It has not been edited or made up by hand: its stored hash is the hash of its content.
  assert.equal(await computeReceiptHash(sample), sample.receiptHash);

  // It comes from this repository: its spec is one of the specs here, and it pins that spec's requirements file.
  assert.ok(
    fs.existsSync(new URL(`${sample.spec}/requirements.md`, SPECS_URL)),
    `the sample is for spec "${sample.spec}", which has no .kiro/specs/${sample.spec}/requirements.md here`,
  );
  assert.equal(sample.requirements.path, `.kiro/specs/${sample.spec}/requirements.md`);
  for (const c of sample.contracts) {
    assert.ok(c.path.startsWith(`contracts/${sample.spec}/`), `${c.path} is not a contract of this repository`);
  }

  // The page loads it: the page code names the file it fetches from the same origin.
  const page = ['../../site/app.js', '../../site/index.html']
    .map((p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8'))
    .join('\n');
  assert.match(page, /sample-receipt\.json/, 'site/app.js or site/index.html must fetch sample-receipt.json');
  assert.match(page, /sample/i);
});
