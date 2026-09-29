import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { state, updateSettings, _reloadSettings } from "../store.js";
import {
  active, activeProject, loadScenes, renderScenes, renderHead,
  deleteScene, cycleStatus, stepDay, initScenes,
} from "../features/scenes.js";
import { installFakeDocument } from "./fakeDom.js";

const PROJECT = {
  id: 1, film_name: "1917", director: "", camera_op: "", location: "Field",
  unit: "", shoot_day: 1, total_days: 1, fps: 25, camera_a: "", camera_b: "",
  poster: "", scene_count: 0, take_count: 0, good_count: 0,
};
const S1 = {
  id: 5, project_id: 1, number: "1", title: "Meadow", int_ext: "EXT",
  daypart: "Day", day: 1, location: "", status: "Not shot",
  description: "", camera_default: "A", take_count: 0,
};
const S2 = { ...S1, id: 6, number: "2", title: "Trench", status: "Partial", take_count: 2 };

let doc;
let calls;
let spies;
let realSetTimeout;
let realClearTimeout;

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
  doc = installFakeDocument();
  realSetTimeout = globalThis.setTimeout;
  realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  calls = [];
  globalThis.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        calls.push({ cmd, args });
        switch (cmd) {
          case "list_scenes": return [{ ...S1 }, { ...S2 }];
          case "list_takes": return [];
          case "next_take": return 1;
          case "list_setups": return [];
          case "list_project_takes": return [];
          case "photo_counts": return [];
          case "create_scene": return { id: 9 };
          default: return {};
        }
      },
    },
  };
  spies = { refreshStats: 0, pushSceneToServer: 0 };
  initScenes({
    refreshStats: () => spies.refreshStats++,
    pushSceneToServer: () => spies.pushSceneToServer++,
  });
  state.projects = [];
  state.scenes = [];
  state.takes = [];
  state.allTakes = [];
  state.setups = [];
  state.photoCounts = {};
  state.activeId = null;
  state.activeProjectId = null;
  state.filter = "";
  state.takeNo = 1;
  state.editingSceneId = null;
});

afterEach(() => {
  doc.restore();
  delete globalThis.__TAURI__;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

const el = (id) => doc.doc.getElementById(id);
const sceneRows = () => doc.doc._created.filter((e) => e.tagName === "div" && String(e.className).startsWith("scene"));

describe("active helpers", () => {
  it("find active project and scene", () => {
    state.projects = [{ ...PROJECT }];
    state.scenes = [{ ...S1 }];
    state.activeProjectId = 1;
    state.activeId = 5;
    assert.equal(activeProject().film_name, "1917");
    assert.equal(active().number, "1");
    state.activeId = 999;
    assert.equal(active(), undefined);
  });
});

describe("loadScenes", () => {
  it("loads, auto-selects the first scene and refreshes", async () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    await loadScenes();
    assert.equal(state.scenes.length, 2);
    assert.equal(state.activeId, 5);
    assert.equal(el("proj-name").textContent, "1917");
    assert.equal(el("scene-count").textContent, 2);
    assert.equal(spies.refreshStats, 1);
  });

  it("does nothing without a project", async () => {
    await loadScenes();
    assert.equal(calls.filter((c) => c.cmd === "list_scenes").length, 0);
  });
});

describe("renderScenes", () => {
  it("renders dots, counts and selects on click", async () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [{ ...S1 }, { ...S2 }];
    state.activeId = 5;
    renderScenes();
    const rows = sceneRows();
    assert.equal(rows.length, 2);
    assert.match(rows[0].innerHTML, /scene-dot Not shot/);
    assert.match(rows[1].innerHTML, /scene-dot Partial/);
    assert.match(rows[0].className, /active/);
    await rows[1].onclick({ target: { dataset: {} } });
    assert.equal(state.activeId, 6);
    assert.equal(spies.pushSceneToServer, 1);
  });

  it("deletes through the row button", async () => {
    updateSettings({ confirmDelete: false });
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [{ ...S1 }];
    state.activeId = 5;
    renderScenes();
    const rows = sceneRows();
    await rows[0].onclick({ target: { dataset: { act: "del" } }, stopPropagation() {} });
    assert.deepEqual(calls.find((c) => c.cmd === "delete_scene").args, { id: 5 });
    assert.equal(el("toast").textContent, "Scene deleted — Ctrl+Z to undo");
  });
});

describe("deleteScene", () => {
  it("aborts on cancel without touching the backend", async () => {
    updateSettings({ confirmDelete: true });
    const p = deleteScene({ ...S1, take_count: 0 });
    el("btn-confirm-cancel").onclick();
    await p;
    assert.equal(calls.filter((c) => c.cmd === "delete_scene").length, 0);
  });
});

describe("cycleStatus", () => {
  it("advances Partial -> Complete and persists", async () => {
    const s = { ...S2 };
    await cycleStatus(s);
    assert.equal(s.status, "Complete");
    const call = calls.find((c) => c.cmd === "update_scene");
    assert.equal(call.args.id, 6);
    assert.equal(call.args.scene.status, "Complete");
  });
});

describe("stepDay", () => {
  it("bumps the active scene day", async () => {
    state.scenes = [{ ...S1, day: 2 }];
    state.activeId = 5;
    await stepDay(1);
    assert.equal(state.scenes[0].day, 3);
    assert.equal(calls.find((c) => c.cmd === "update_scene").args.scene.day, 3);
    assert.equal(spies.refreshStats, 1);
  });

  it("falls back to the project day with no scene selected", async () => {
    state.projects = [{ ...PROJECT, shoot_day: 1 }];
    state.activeProjectId = 1;
    state.activeId = null;
    await stepDay(1);
    assert.deepEqual(calls.find((c) => c.cmd === "set_project_day").args, { id: 1, day: 2 });
    assert.equal(state.projects[0].shoot_day, 2);
  });

  it("floors at day 1", async () => {
    state.scenes = [{ ...S1, day: 1 }];
    state.activeId = 5;
    await stepDay(-5);
    assert.equal(state.scenes[0].day, 1);
  });
});

describe("scene modal (new + save)", () => {
  it("suggests the next number and carries the camera forward", () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [{ ...S1, camera_default: "CU" }, { ...S2, camera_default: "" }];
    el("btn-new-scene").onclick();
    assert.equal(el("f-number").value, "3");
    assert.equal(el("f-camera").value, "CU");
    assert.equal(el("modal").classList.contains("hidden"), false);
  });

  it("creates the scene on save", async () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [];
    globalThis.__TAURI__.core.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "create_scene") return { id: 9 };
      // Reload after save includes the new scene, so it stays selected.
      if (cmd === "list_scenes") return [{ ...S1, id: 9, number: "1", title: "Dugout" }];
      if (cmd === "list_project_takes") return [];
      if (cmd === "photo_counts") return [];
      if (cmd === "list_takes") return [];
      if (cmd === "next_take") return 1;
      if (cmd === "list_setups") return [];
      return {};
    };
    el("btn-new-scene").onclick();
    el("f-number").value = "1";
    el("f-title").value = "Dugout";
    el("f-intext").value = "INT";
    el("f-daypart").value = "Night";
    el("f-camera").value = "A";
    el("f-desc").value = "";
    el("f-location").value = "";
    el("f-status").value = "Not shot";
    el("f-day").value = "1";
    await el("btn-create").onclick();
    const call = calls.find((c) => c.cmd === "create_scene");
    assert.equal(call.args.projectId, 1);
    assert.equal(call.args.scene.title, "Dugout");
    assert.equal(state.activeId, 9);
  });
});

describe("renderHead", () => {
  it("shows the empty hint with no scene", () => {
    state.scenes = [];
    state.activeId = null;
    renderHead();
    assert.match(el("scene-head").innerHTML, /Select or create a scene/);
  });

  it("renders the header with status + edit controls", () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [{ ...S1 }];
    state.activeId = 5;
    renderHead();
    assert.match(el("scene-head").innerHTML, /MEADOW/);
    assert.match(el("take-no").textContent, /01/);
  });
});
