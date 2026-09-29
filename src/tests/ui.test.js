import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { updateSettings, _reloadSettings } from "../store.js";
import { toast, confirmAsync, sndClick, sndLog, sndDelete, sndExport, showView } from "../ui.js";
import { installFakeDocument } from "./fakeDom.js";

let doc;
beforeEach(() => {
  globalThis.localStorage = {
    _m: {},
    getItem(k) { return this._m[k] ?? null; },
    setItem(k, v) { this._m[k] = String(v); },
    removeItem(k) { delete this._m[k]; },
  };
  _reloadSettings();
  doc = installFakeDocument();
});
afterEach(() => doc.restore());

describe("toast", () => {
  it("sets the message without crashing", () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = () => 0;
    globalThis.clearTimeout = () => {};
    try {
      toast("hello");
      assert.equal(doc.doc._byId.get("toast").textContent, "hello");
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });
});

describe("confirmAsync", () => {
  it("resolves true immediately when the toggle is off", async () => {
    updateSettings({ confirmDelete: false });
    assert.equal(await confirmAsync("delete?"), true);
  });

  it("drives the modal and resolves from its buttons", async () => {
    updateSettings({ confirmDelete: true });
    const p = confirmAsync("sure?", "Go");
    const ok = doc.doc._byId.get("btn-confirm-ok");
    assert.equal(doc.doc._byId.get("confirm-msg").textContent, "sure?");
    assert.equal(ok.textContent, "Go");
    assert.equal(doc.doc._byId.get("modal-confirm").classList.contains("hidden"), false);
    ok.onclick();
    assert.equal(await p, true);
    assert.equal(doc.doc._byId.get("modal-confirm").classList.contains("hidden"), true);
  });

  it("cancel resolves false", async () => {
    updateSettings({ confirmDelete: true });
    const p = confirmAsync("sure?");
    doc.doc._byId.get("btn-confirm-cancel").onclick();
    assert.equal(await p, false);
  });
});

describe("showView", () => {
  it("shows one view and hides the rest", () => {
    showView("app");
    assert.equal(doc.doc._byId.get("view-app").classList.contains("hidden"), false);
    for (const v of ["home", "report", "progress", "script"]) {
      assert.equal(doc.doc._byId.get(`view-${v}`).classList.contains("hidden"), true);
    }
  });
});

describe("sounds", () => {
  it("never throw without an AudioContext", () => {
    assert.doesNotThrow(() => {
      sndClick();
      sndLog("Good"); sndLog("Maybe"); sndLog("Bad");
      sndDelete();
      sndExport();
    });
  });

  it("stay silent when sounds are off", () => {
    updateSettings({ sounds: false });
    assert.doesNotThrow(() => sndExport());
  });
});
