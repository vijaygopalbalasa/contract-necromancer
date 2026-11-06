import { start } from './app.js';

start({ document, location, fetch: (...args) => fetch(...args), navigator });
