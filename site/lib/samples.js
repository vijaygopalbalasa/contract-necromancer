// The two samples the page ships, what to show when the page opens, and how to scroll the banner into view.
// Pure: nothing here touches the page or the network.

// Risen first: the first sample button in index.html loads SAMPLES[0]. The files they come from are named in app.js.
export const SAMPLES = [
  {
    id: 'risen',
    label: 'Load the risen sample',
    note: 'This is a sample receipt: a real one written by the gate in this repository, with every contract alive.',
  },
  {
    id: 'buried',
    label: 'Load the buried sample',
    note:
      'This is a sample receipt: a real one written by necro check on a copy of examples/pumpkin-ledger with a rounding bug planted. ' +
      'It is not stored in this repository, so the re-run command below cannot find it.',
  },
];

// What the page does when it opens.
//   requested: the result of parseReceiptUrl (null when the URL names no receipt)
//   pasted: the text already in the paste box (a browser may restore it after a reload)
// Returns one of
//   { action: 'url', url, repo }   open the receipt the link names
//   { action: 'error', message }   the link is not one we open; say why and show nothing else
//   { action: 'sample', sample }   a first visit: show that sample at once
//   { action: 'none' }             the visitor already has text in the box; leave it
export function chooseInitialView({ requested = null, pasted = '' } = {}) {
  if (requested !== null) {
    return requested.ok
      ? { action: 'url', url: requested.url, repo: requested.repo }
      : { action: 'error', message: requested.message };
  }
  if (typeof pasted === 'string' && pasted.trim() !== '') return { action: 'none' };
  return { action: 'sample', sample: SAMPLES[0].id };
}

// Options for scrollIntoView. Smooth only when the visitor has not asked for reduced motion; when the preference is
// unknown, do not animate.
export function scrollOptions({ reducedMotion } = {}) {
  return { behavior: reducedMotion === false ? 'smooth' : 'auto', block: 'start' };
}
