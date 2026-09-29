import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { state, _reloadSettings } from "../store.js";
import { openProgress, renderProgress, initProgress } from "../features/progress.js";
import { installFakeDocument } from "./fakeDom.js";

const PROJECT = {
  id: 1, film_name: "1917", director: "", camera_op: "", location: "",
  unit: "", shoot_day: 1, total_days: 1, fps: 25, camera_a: "", camera_b: "",
  poster: "", scene_count: 0, take_count: 0, good_count: 0,
};
const S1 = {
  id: 5, project_id: 1, number: "1", title: "Meadow", int_ext: "EXT",
  daypart: "Day", day: 1, location: "", status: "Complete",
  description: "", camera_default: "A", take_count: 1,
};
const S2 = { ...S1, id: 6, number: "2", title: "Trench", status: "Partial", take_count: 0 };
const S3 = { ...S1, id: 7, number: "3", title: "Dugout", status: "Not shot", take_count: 0 };

let doc;
let calls;
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
          case "list_takes": return [];
          case "next_take": return 1;
          case "list_setups": return [];
          default: return {};
        }
      },
    },
  };
  initProgress();
  state.projects = [];
  state.scenes = [];
  state.allTakes = [];
  state.takes = [];
  state.setups = [];
  state.photoCounts = {};
  state.activeId = null;
  state.activeProjectId = null;
});

afterEach(() => {
  doc.restore();
  delete globalThis.__TAURI__;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

const el = (id) => doc.doc.getElementById(id);

describe("openProgress", () => {
  it("needs a project first", () => {
    openProgress();
    assert.equal(el("toast").textContent, "Open a project first");
  });

  it("renders the board and switches view", () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [{ ...S1 }];
    openProgress();
    assert.equal(el("progress-sub").textContent, "1917 - wrap progress");
    assert.equal(el("view-progress").classList.contains("hidden"), false);
  });
});

describe("renderProgress", () => {
  it("counts Complete-only and sizes the fill", () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [{ ...S1 }, { ...S2 }, { ...S3 }];
    state.allTakes = [{ scene_id: 5, rating: "Good" }];
    renderProgress();
    const html = el("progress-body").innerHTML;
    assert.match(html, /1\/3 scenes complete/);
    assert.match(html, /33% wrapped/);
    assert.match(html, /2 remaining/);
    assert.match(html, /Day 1/);
    assert.equal(el("prog-fill").style.width, "33%");
  });

  it("shows the empty hint with no scenes", () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [];
    renderProgress();
    assert.match(el("progress-body").innerHTML, /No scenes yet/);
    assert.equal(el("prog-fill").style.width, "0%");
  });

  it("cycles status through the row button", async () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [{ ...S2 }];
    renderProgress();
    const row = { dataset: { id: "6" }, onclick: null };
    doc.doc.querySelectorAll = (sel) => (sel === ".prog-row" ? [row] : []);
    renderProgress(); // re-render so the test row gets the handler
    await row.onclick({ target: { dataset: { st: "6" } }, stopPropagation() {} });
    assert.equal(calls.find((c) => c.cmd === "update_scene").args.scene.status, "Complete");
    assert.equal(state.scenes[0].status, "Complete");
  });

  it("selects the scene through the row body", async () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [{ ...S1 }, { ...S2 }];
    renderProgress();
    const row = { dataset: { id: "6" }, onclick: null };
    doc.doc.querySelectorAll = (sel) => (sel === ".prog-row" ? [row] : []);
    renderProgress();
    await row.onclick({ target: { dataset: {} } });
    assert.equal(state.activeId, 6);
    assert.equal(el("view-app").classList.contains("hidden"), false);
    assert.ok(calls.some((c) => c.cmd === "list_takes"), "takes loaded for the scene");
  });
});
