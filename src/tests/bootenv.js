// Boot environment for the app-shell import test (appboot.test.js).
// Must be imported BEFORE app.js: installs DOM/timer/storage stubs so the
// full module graph (all features + startup wiring) evaluates in node.
// If any import fails to resolve or any init step throws, the import of
// app.js fails and the test goes red — exactly the "blank app" bug class.

import { installFakeDocument } from "./fakeDom.js";

const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};

installFakeDocument();

// No live timers under test: the TC ticker and update boot-check stay idle,
// toast() schedules nothing.
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

// No Tauri backend: every invoke() rejects with no-tauri, which the app
// treats as "offline/empty" (loadProjects catches and renders the empty home).
