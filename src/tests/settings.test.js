import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { S, updateSettings, _reloadSettings, DEFAULT_SHORTCUTS } from "../store.js";
import {
  initSettings, applySettingsToUI, handleCaptureKey, renderShortcutRows,
  checkForUpdates,
} from "../features/settings.js";
import { installFakeDocument } from "./fakeDom.js";

let doc;
let chips;
let lens;

function makeStorage(initial = {}) {
  const m = { ...initial };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
  };
}

beforeEach(() => {
  globalThis.localStorage = makeStorage();
  _reloadSettings();
  updateSettings({ checkStartup: false }); // no 5s boot timer in tests
  doc = installFakeDocument();
  chips = 0;
  lens = 0;
  initSettings({ renderChips: () => chips++, syncLensSeg: () => lens++ });
});
afterEach(() => doc.restore());

describe("initSettings", () => {
  it("wires controls without crashing", () => {
    for (const id of ["btn-settings", "btn-open-shortcuts", "set-sound", "btn-check-updates", "btn-defaults"]) {
      assert.ok(doc.doc._byId.get(id), `${id} wired`);
    }
  });

  it("opening settings populates controls from the store", () => {
    updateSettings({ sounds: false, setPort: 4321 });
    doc.doc._byId.get("btn-settings").onclick();
    assert.equal(doc.doc._byId.get("set-sound").checked, false);
    assert.equal(doc.doc._byId.get("set-port").value, 4321);
    assert.equal(doc.doc._byId.get("modal-settings").classList.contains("hidden"), false);
  });

  it("a control change reaches the store", () => {
    const el = doc.doc._byId.get("set-sound");
    el.checked = true;
    el.onchange({ target: el });
    assert.equal(S.sounds, true);
  });
});

describe("applySettingsToUI", () => {
  it("syncs take-card state and refreshes via subscription", () => {
    const before = chips;
    updateSettings({ defaultRating: "Bad" }); // fires the initSettings subscription
    assert.ok(chips > before, "renderChips ran through the subscription");
    applySettingsToUI();
    assert.ok(lens > 0, "syncLensSeg ran");
  });
});

describe("shortcut remap capture", () => {
  // Find the remap button by its row label, not by position.
  function armRateGood() {
    renderShortcutRows();
    const row = doc.doc._created.find(
      (el) => el.className === "sc-row" && el.children[0]?.textContent === "Rate Good"
    );
    assert.ok(row, "Rate Good row rendered");
    row.children[1].onclick();
  }
  const keyEvent = (code) => ({
    code, preventDefault() {}, stopPropagation() {},
  });

  it("ignores keys when not capturing", () => {
    assert.equal(handleCaptureKey(keyEvent("KeyL")), false);
    assert.equal(S.shortcuts.rateGood, DEFAULT_SHORTCUTS.rateGood);
  });

  it("rejects clashing keys and keeps the old one", () => {
    armRateGood();
    assert.equal(handleCaptureKey(keyEvent("Space")), true); // logTake's key
    assert.equal(S.shortcuts.rateGood, DEFAULT_SHORTCUTS.rateGood);
    assert.match(doc.doc._byId.get("toast").textContent, /Already used/);
  });

  it("accepts a free key and persists it", () => {
    armRateGood();
    assert.equal(handleCaptureKey(keyEvent("KeyL")), true);
    assert.equal(S.shortcuts.rateGood, "KeyL");
    const stored = JSON.parse(globalThis.localStorage.getItem("slate-settings"));
    assert.equal(stored.shortcuts.rateGood, "KeyL");
  });

  it("Escape cancels without changes", () => {
    armRateGood();
    assert.equal(handleCaptureKey(keyEvent("Escape")), true);
    assert.equal(S.shortcuts.rateGood, DEFAULT_SHORTCUTS.rateGood);
  });
});

describe("checkForUpdates", () => {
  it("reports up-to-date state", async () => {
    globalThis.__TAURI__ = {
      core: {
        invoke: async (cmd) => {
          if (cmd === "check_update") return { available: false };
          if (cmd === "app_version") return "0.7.0";
          throw new Error("unexpected " + cmd);
        },
      },
    };
    try {
      await checkForUpdates(true);
      assert.equal(doc.doc._byId.get("update-status").textContent, "You're on the latest (v0.7.0).");
    } finally {
      delete globalThis.__TAURI__;
    }
  });
});
