import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  S, state, DEFAULT_SETTINGS, DEFAULT_SHORTCUTS,
  saveSettings, updateSettings, subscribe, _reloadSettings,
} from "../store.js";

function makeStorage(initial = {}) {
  const m = { ...initial };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    _dump: () => ({ ...m }),
  };
}

beforeEach(() => {
  globalThis.localStorage = makeStorage();
  _reloadSettings();
});

describe("loadSettings", () => {
  it("yields defaults on empty storage", () => {
    assert.equal(S.sounds, true);
    assert.equal(S.confirmDelete, true);
    assert.equal(S.fillLocation, false);
    assert.equal(S.setPort, 17831);
    assert.deepEqual(S.shortcuts, DEFAULT_SHORTCUTS);
    assert.ok(Array.isArray(S.quickNotes) && S.quickNotes.length > 0);
  });

  it("persisted values win over defaults", () => {
    globalThis.localStorage = makeStorage({
      "slate-settings": JSON.stringify({ sounds: false, setPort: 9999, defaultRating: "Bad" }),
    });
    _reloadSettings();
    assert.equal(S.sounds, false);
    assert.equal(S.setPort, 9999);
    assert.equal(S.defaultRating, "Bad");
    assert.equal(S.confirmDelete, true); // untouched default survives
  });

  it("legacy off-switches override persisted values", () => {
    globalThis.localStorage = makeStorage({
      "slate-settings": JSON.stringify({ sounds: true, confirmDelete: true }),
      "slate-sound": "off",
      "slate-confirm": "off",
    });
    _reloadSettings();
    assert.equal(S.sounds, false);
    assert.equal(S.confirmDelete, false);
  });

  it("survives corrupt JSON and still applies legacy keys", () => {
    globalThis.localStorage = makeStorage({
      "slate-settings": "{oops",
      "slate-sound": "off",
    });
    _reloadSettings();
    assert.equal(S.sounds, false);
    assert.equal(S.setPort, DEFAULT_SETTINGS.setPort);
  });

  it("deep-merges shortcuts instead of replacing them", () => {
    globalThis.localStorage = makeStorage({
      "slate-settings": JSON.stringify({ shortcuts: { logTake: "KeyL" } }),
    });
    _reloadSettings();
    assert.equal(S.shortcuts.logTake, "KeyL");
    assert.equal(S.shortcuts.rateGood, DEFAULT_SHORTCUTS.rateGood);
  });
});

describe("updateSettings", () => {
  it("merges, persists and notifies with the patch", () => {
    const seen = [];
    const unsub = subscribe((evt, patch) => seen.push([evt, patch]));
    updateSettings({ sounds: false, setPort: 1234 });
    assert.equal(S.sounds, false);
    assert.equal(S.setPort, 1234);
    const stored = JSON.parse(globalThis.localStorage.getItem("slate-settings"));
    assert.equal(stored.sounds, false);
    assert.deepEqual(seen, [["settings", { sounds: false, setPort: 1234 }]]);
    unsub();
  });

  it("unsubscribe stops notifications", () => {
    let n = 0;
    const unsub = subscribe(() => n++);
    unsub();
    updateSettings({ sounds: false });
    assert.equal(n, 0);
  });

  it("a throwing listener does not break the rest", () => {
    let ok = false;
    subscribe(() => { throw new Error("boom"); });
    subscribe(() => { ok = true; });
    updateSettings({ sounds: false });
    assert.equal(ok, true);
    assert.equal(S.sounds, false);
  });
});

describe("saveSettings", () => {
  it("writes the whole settings object", () => {
    S.setPort = 4321;
    saveSettings();
    assert.equal(JSON.parse(globalThis.localStorage.getItem("slate-settings")).setPort, 4321);
  });
});

describe("state", () => {
  it("starts empty with settings-derived defaults", () => {
    assert.deepEqual(state.projects, []);
    assert.deepEqual(state.scenes, []);
    assert.equal(state.activeProjectId, null);
    assert.equal(state.takeNo, 1);
    assert.ok(state.tags instanceof Set);
    assert.equal(state.rating, S.defaultRating);
    assert.equal(state.lens, S.defaultLens);
  });
});
