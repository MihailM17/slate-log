import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { state, _reloadSettings } from "../store.js";
import { initSetMode, openSetMode, refreshSetScene, closeSetMode, pushSceneToServer } from "../features/setMode.js";
import { installFakeDocument } from "./fakeDom.js";

function makeStorage(initial = {}) {
  const m = { ...initial };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
  };
}

let doc;
let calls;
let refreshed;
let realSetTimeout;
let realClearTimeout;
let realSetInterval;

beforeEach(() => {
  globalThis.localStorage = makeStorage();
  _reloadSettings();
  doc = installFakeDocument();
  realSetTimeout = globalThis.setTimeout;
  realClearTimeout = globalThis.clearTimeout;
  realSetInterval = globalThis.setInterval;
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  globalThis.setInterval = () => 0;
  calls = [];
  globalThis.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        calls.push({ cmd, args });
        switch (cmd) {
          case "set_start": return { url: "http://x/?token=t", port: 17831 };
          case "set_qr": return "<svg></svg>";
          case "set_info": return { running: true, scene_number: "3", scene_title: "Meadow" };
          case "list_takes": return [];
          case "next_take": return 1;
          case "list_setups": return [];
          case "list_project_takes": return [];
          case "photo_counts": return [];
          default: return {};
        }
      },
    },
  };
  refreshed = 0;
  initSetMode({ refreshStats: () => refreshed++ });
  state.projects = [];
  state.scenes = [];
  state.takes = [];
  state.allTakes = [];
  state.setups = [];
  state.photos = [];
  state.photoCounts = {};
  state.activeId = null;
  state.activeProjectId = null;
});

afterEach(() => {
  doc.restore();
  delete globalThis.__TAURI__;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  globalThis.setInterval = realSetInterval;
});

const el = (id) => doc.doc.getElementById(id);

describe("openSetMode", () => {
  it("needs a project first", async () => {
    await openSetMode();
    assert.equal(el("toast").textContent, "Open a project first");
    assert.equal(calls.filter((c) => c.cmd === "set_start").length, 0);
  });

  it("starts the server and shows the code", async () => {
    state.activeProjectId = 1;
    state.activeId = 5;
    await openSetMode();
    assert.deepEqual(calls.find((c) => c.cmd === "set_start").args, { sceneId: 5, port: 17831 });
    assert.equal(el("set-url").textContent, "http://x/?token=t");
    assert.equal(el("modal-set").classList.contains("hidden"), false);
  });
});

describe("refreshSetScene", () => {
  it("shows the phone scene while running", async () => {
    await refreshSetScene();
    assert.equal(el("set-scene").textContent, "Scene 3 Meadow");
  });

  it("stops quietly when the server went away", async () => {
    globalThis.__TAURI__.core.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "set_info") return { running: false };
      if (cmd === "list_project_takes") return [];
      if (cmd === "photo_counts") return [];
      return {};
    };
    await refreshSetScene();
    assert.ok(calls.some((c) => c.cmd === "set_stop"));
  });
});

describe("closeSetMode", () => {
  it("refreshes takes and stats when a project is open", async () => {
    state.activeProjectId = 1;
    state.scenes = [{ id: 5, int_ext: "INT", camera_default: "A" }];
    state.activeId = 5;
    await closeSetMode(false);
    assert.ok(calls.some((c) => c.cmd === "list_takes"));
    assert.ok(calls.some((c) => c.cmd === "list_project_takes"));
    assert.equal(refreshed, 1);
  });
});

describe("pushSceneToServer", () => {
  it("pushes without waking a closed modal", async () => {
    state.activeId = 5;
    await pushSceneToServer();
    assert.deepEqual(calls.find((c) => c.cmd === "set_scene").args, { sceneId: 5 });
    assert.equal(calls.filter((c) => c.cmd === "set_info").length, 0);
  });
});
