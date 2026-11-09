// The two samples the page ships, what to show when the page opens, and how to scroll the banner into view.
// Pure: nothing here touches the page or the network.

// The one sentence every sample note starts with, for a visitor who has never seen a receipt.
const WHAT_A_RECEIPT_IS = 'A receipt lists the contracts that had to pass before Kiro could tick the task.';

// Risen first: the first sample button in index.html loads SAMPLES[0]. The files they come from are named in app.js.
// The labels are plain words for a newcomer. Each also keeps the words "risen" or "buried" and "sample", which the page
// uses elsewhere (the banner says Risen or Still buried) and which the frozen first-visit contract looks for.
export const SAMPLES = [
  {
    id: 'risen',
    label: 'A passing receipt (risen sample)',
    note: `${WHAT_A_RECEIPT_IS} This sample is a real one from this repository.`,
  },
  {
    id: 'buried',
    label: 'A refused one (buried sample)',
    note:
      `${WHAT_A_RECEIPT_IS} This sample is a real necro check of a spec with a planted bug. ` +
      'It is not stored in this repository, so the re-run command cannot find it.',
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
