// Minimal fake DOM for testing UI wiring in node. Only implements what the
// modules under test touch; anything else throws loudly (fail fast, not silent).

export function fakeClassList() {
  const s = new Set(["hidden"]);
  return {
    add: (...c) => c.forEach((x) => s.add(x)),
    remove: (...c) => c.forEach((x) => s.delete(x)),
    toggle: (c, force) => {
      const on = force === undefined ? !s.has(c) : !!force;
      if (on) s.add(c); else s.delete(c);
      return on;
    },
    contains: (c) => s.has(c),
  };
}

export function fakeEl() {
  const el = {
    textContent: "",
    innerHTML: "",
    value: "",
    checked: false,
    dataset: {},
    style: {},
    classList: fakeClassList(),
    children: [],
    onclick: null,
    oninput: null,
    onchange: null,
    _h: null,
    _q: new Map(),
    appendChild(c) { this.children.push(c); return c; },
    append() {},
    removeAttribute() {},
    setAttribute() {},
    hasAttribute() { return false; },
    // Persistent per-selector fakes so tests can grab wired handlers.
    querySelector(sel) {
      if (!this._q.has(sel)) this._q.set(sel, fakeEl());
      return this._q.get(sel);
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    click() {},
    focus() {},
  };
  return el;
}

// Installs globalThis.document backed by per-id fake elements.
// Returns { doc, restore }. Created elements are recorded on doc._created.
export function installFakeDocument() {
  const byId = new Map();
  const created = [];
  const doc = {
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, fakeEl());
      return byId.get(id);
    },
    createElement: (tag) => {
      const el = fakeEl();
      el.tagName = tag;
      created.push(el);
      return el;
    },
    createTextNode: (text) => ({ textContent: text }),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    _byId: byId,
    _created: created,
  };
  const prev = globalThis.document;
  globalThis.document = doc;
  return {
    doc,
    restore() {
      if (prev === undefined) delete globalThis.document;
      else globalThis.document = prev;
    },
  };
}
