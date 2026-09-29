import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { state, updateSettings, _reloadSettings } from "../store.js";
import { loadProjects, openProject, undoDelete, initProjects } from "../features/projects.js";
import { installFakeDocument } from "./fakeDom.js";

const PROJECT = {
  id: 1, film_name: "1917", director: "Sam", camera_op: "", location: "Field",
  unit: "", shoot_day: 1, total_days: 1, fps: 25, camera_a: "", camera_b: "",
  poster: "", scene_count: 1, take_count: 2, good_count: 1,
};

let doc;
let calls;
let exported;
let refreshed;
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

const tick = () => new Promise((r) => setImmediate(r));

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
          case "list_projects": return [{ ...PROJECT }];
          case "list_scenes": return [];
          case "list_project_takes": return [];
          case "photo_counts": return [];
          case "list_takes": return [];
          case "next_take": return 1;
          case "list_setups": return [];
          case "create_project": return { id: 2 };
          case "undo_delete": return { message: "Scene 3 restored", kind: "scene", project_id: 1, scene_id: 5 };
          default: return {};
        }
      },
    },
  };
  exported = [];
  refreshed = 0;
  initProjects({
    refreshStats: () => refreshed++,
    onExportProject: async (id) => { exported.push(id); },
  });
  state.projects = [];
  state.scenes = [];
  state.takes = [];
  state.allTakes = [];
  state.setups = [];
  state.photos = [];
  state.photoCounts = {};
  state.activeId = null;
  state.activeProjectId = null;
  state.projectQuery = "";
  state.editingProjectId = null;
  state.pendingPosterKey = null;
  state.posterRemove = false;
});

afterEach(() => {
  doc.restore();
  delete globalThis.__TAURI__;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

const el = (id) => doc.doc.getElementById(id);
const cards = () => doc.doc._created.filter((e) => e.tagName === "div" && e.className === "card-p");

describe("loadProjects + home grid", () => {
  it("renders cards with stats", async () => {
    await loadProjects();
    assert.equal(state.projects.length, 1);
    const found = cards();
    assert.equal(found.length, 1);
    assert.match(found[0].innerHTML, /1917/);
    assert.match(found[0].innerHTML, /1 scenes · 2 takes · 50% good/);
    assert.equal(el("home-empty").classList.contains("hidden"), true);
  });

  it("filters by name or director", async () => {
    await loadProjects();
    // The fake DOM does not clear children on innerHTML, so only count
    // cards created after each keystroke.
    const freshCards = (m) => doc.doc._created.slice(m).filter((e) => e.tagName === "div" && e.className === "card-p");
    const search = el("project-search");
    search.value = "sam";
    let m = doc.doc._created.length;
    search.oninput({ target: search });
    assert.equal(freshCards(m).length, 1);
    search.value = "nope";
    m = doc.doc._created.length;
    search.oninput({ target: search });
    assert.equal(freshCards(m).length, 0);
  });

  it("opens a project from its card", async () => {
    await loadProjects();
    await cards()[0].onclick({ target: {} });
    assert.equal(state.activeProjectId, 1);
    assert.equal(el("view-app").classList.contains("hidden"), false);
  });

  it("deletes through the card with a double confirm", async () => {
    await loadProjects();
    const card = cards()[0];
    const p = deleteFlow(card);
    el("btn-confirm-ok").onclick();
    await tick();
    el("btn-confirm-ok").onclick();
    await p;
    assert.deepEqual(calls.find((c) => c.cmd === "delete_project").args, { id: 1 });
    assert.equal(el("toast").textContent, "Project deleted — Ctrl+Z to undo");
    async function deleteFlow(c) {
      return c.onclick({ target: { dataset: { act: "del" } }, stopPropagation() {} });
    }
  });

  it("exports through the card", async () => {
    await loadProjects();
    await cards()[0].onclick({ target: { dataset: { act: "exp" } }, stopPropagation() {} });
    assert.deepEqual(exported, [1]);
  });
});

describe("project modal", () => {
  it("creates a project on save", async () => {
    el("btn-home-new").onclick();
    el("p-film").value = "New film";
    el("p-director").value = "";
    el("p-cameraop").value = "";
    el("p-location").value = "";
    el("p-unit").value = "";
    el("p-fps").value = "25";
    await el("btn-save-project").onclick();
    const call = calls.find((c) => c.cmd === "create_project");
    assert.equal(call.args.project.film_name, "New film");
    assert.equal(call.args.project.poster_stage, null);
    assert.equal(state.activeProjectId, 2);
  });

  it("falls back to Untitled film", async () => {
    el("btn-home-new").onclick();
    el("p-film").value = "   ";
    el("p-director").value = "";
    el("p-cameraop").value = "";
    el("p-location").value = "";
    el("p-unit").value = "";
    el("p-fps").value = "25";
    await el("btn-save-project").onclick();
    assert.equal(calls.find((c) => c.cmd === "create_project").args.project.film_name, "Untitled film");
  });

  it("stages a poster from the picker", async () => {
    globalThis.__TAURI__.core.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "pick_stage_poster") return { cancelled: false, key: "k1" };
      if (cmd === "staged_poster_data") return "data:image/jpeg;base64,AAA";
      return {};
    };
    el("btn-home-new").onclick();
    await el("btn-poster-pick").onclick();
    assert.equal(state.pendingPosterKey, "k1");
    assert.equal(el("p-poster").src, "data:image/jpeg;base64,AAA");
    el("btn-poster-remove").onclick();
    assert.equal(state.pendingPosterKey, null);
    assert.equal(state.posterRemove, true);
  });
});

describe("undoDelete", () => {
  it("restores and re-selects the scene project", async () => {
    state.projects = [{ ...PROJECT }];
    await undoDelete();
    assert.equal(el("toast").textContent, "Scene 3 restored");
    assert.equal(state.activeProjectId, 1);
    assert.equal(state.activeId, 5);
    assert.equal(refreshed, 1);
  });

  it("stays silent when there is nothing to undo", async () => {
    globalThis.__TAURI__.core.invoke = async () => { throw new Error("nothing to undo"); };
    await undoDelete();
    assert.equal(el("toast").textContent, "");
  });
});
