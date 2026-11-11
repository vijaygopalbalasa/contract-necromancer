// The play's worker (Req 13.2, 13.3, 13.6). The page starts it as a module worker and posts one message: { run: 'planted' }
// or { run: 'fixed' }. The worker takes nothing else from the page, the address or any input. It finds its own folder from
// its own address, fetches the ledger's copies from there, and runs only copies whose hash matches the pin in the receipt
// for that run (all of that is play-loader.js). It answers with 'result' messages as the seven contracts finish, then
// 'done', or with one 'error' message that holds a plain sentence.
//
// A dedicated worker loaded from the page's own origin takes its Content Security Policy from its own response, not from
// the meta tag in index.html. That is what lets it build modules from text. The safety is in the loader: the hash check,
// the refusal of any import it does not know, and nothing but the hashed files and the two stand-ins.

import { handleMessage } from './play-loader.js';

// The folder above this file is the site; the stand-ins sit next to this file.
const BASE = new URL('../', import.meta.url).href;
const LIB_BASE = new URL('./', import.meta.url).href;

self.addEventListener('message', (event) => {
  return handleMessage(event.data, {
    base: BASE,
    libBase: LIB_BASE,
    fetchFn: (url, options) => fetch(url, options),
    makeUrl: (text) => URL.createObjectURL(new Blob([text], { type: 'text/javascript' })),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    importModule: (url) => import(url),
    post: (message) => self.postMessage(message),
  });
});
