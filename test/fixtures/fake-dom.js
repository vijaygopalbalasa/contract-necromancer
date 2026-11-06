// A very small DOM for testing site/app.js without a browser. It supports only what the app uses. Elements named by
// an id in site/index.html exist from the start, with the tag and the hidden attribute the HTML gives them, so the
// tests and the page cannot drift apart.

import fs from 'node:fs';

class ClassList {
  constructor(el) {
    this.el = el;
  }
  list() {
    return this.el.className.split(/\s+/).filter(Boolean);
  }
  contains(c) {
    return this.list().includes(c);
  }
  add(...cs) {
    this.el.className = [...new Set([...this.list(), ...cs])].join(' ');
  }
  remove(...cs) {
    this.el.className = this.list().filter((c) => !cs.includes(c)).join(' ');
  }
  toggle(c, force) {
    const on = force === undefined ? !this.contains(c) : force;
    if (on) this.add(c);
    else this.remove(c);
    return on;
  }
}

export class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this._text = '';
    this.className = '';
    this.attributes = new Map();
    this.hidden = false;
    this.value = '';
    this.files = [];
    this.listeners = new Map();
    this.classList = new ClassList(this);
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    for (const n of nodes) this.children.push(typeof n === 'string' ? Object.assign(new FakeElement('#text'), { _text: n }) : n);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  // Run every listener for `type` and wait for the async ones.
  async dispatch(type, extra = {}) {
    const event = { type, target: this, preventDefault() {}, ...extra };
    await Promise.all((this.listeners.get(type) || []).map((fn) => fn(event)));
  }
}

// Every descendant (not the root) for which `pred` is true, in document order.
export function findAll(root, pred) {
  const out = [];
  const walk = (el) => {
    for (const c of el.children) {
      if (pred(c)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

export function createDom(htmlPath = new URL('../../site/index.html', import.meta.url)) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const byId = new Map();
  for (const m of html.matchAll(/<(\w+)\b([^>]*)>/g)) {
    const id = /\sid="([^"]+)"/.exec(m[2]);
    if (!id) continue;
    const el = new FakeElement(m[1], id[1]);
    el.hidden = /\shidden(\s|$)/.test(m[2]);
    const cls = /\sclass="([^"]*)"/.exec(m[2]);
    if (cls) el.className = cls[1];
    for (const a of m[2].matchAll(/\s([\w-]+)="([^"]*)"/g)) {
      if (a[1] !== 'class' && a[1] !== 'id') el.setAttribute(a[1], a[2]);
    }
    byId.set(id[1], el);
  }
  const document = {
    body: new FakeElement('body'),
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => byId.get(id) || null,
  };
  return { document, byId, el: (id) => byId.get(id) };
}
