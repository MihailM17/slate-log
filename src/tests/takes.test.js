import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { state, updateSettings, _reloadSettings } from "../store.js";
import {
  initTakes, loadTakes, loadAllTakes, logTake, resetTimerUI, toggleTimer,
  renderChips, syncLensSeg, saveSetup, replaceCamAll, saveEditTake,
} from "../features/takes.js";
import { installFakeDocument } from "./fakeDom.js";

const SCENE = {
  id: 7, project_id: 1, number: "3", title: "Meadow", int_ext: "EXT",
  daypart: "Day", day: 2, location: "", status: "Not shot",
  description: "", camera_default: "B", take_count: 0,
};
const TAKE = {
  id: 11, scene_id: 7, scene_number: "3", scene_title: "Meadow", take_no: 2,
  tc_in: "10:00:00", cam: "A", lens: "35mm", rating: "Good", int_ext: "EXT",
  day: 2, duration_sec: 0, cam_file: "", audio_file: "", setup_id: null,
  setup_name: "", tags: "", note: "hi", created_at: "",
};

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
  globalThis.setTimeout = () => 0; // keep toast() from parking a 2.6s timer
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
          case "list_project_takes": return [];
          case "photo_counts": return [];
          case "log_take": return { take_no: 3 };
          case "set_all_scene_cameras": return { updated: 60 };
          case "update_take": return {};
          case "create_setup": return { id: 9 };
          default: return {};
        }
      },
    },
  };
  spies = { renderScenes: 0, renderHead: 0, refreshStats: 0, loadPhotos: 0, reloadScenes: 0 };
  initTakes({
    renderScenes: () => spies.renderScenes++,
    renderHead: () => spies.renderHead++,
    refreshStats: () => spies.refreshStats++,
    loadPhotos: async () => { spies.loadPhotos++; },
    reloadScenes: async () => { spies.reloadScenes++; },
  });
  // Fresh take state for every test.
  state.scenes = [];
  state.takes = [];
  state.allTakes = [];
  state.setups = [];
  state.photos = [];
  state.photoCounts = {};
  state.activeId = null;
  state.activeProjectId = null;
  state.rating = "Good";
  state.lens = "35";
  state.takeIntExt = "INT";
  state.tags = new Set();
  state.takeNo = 1;
  state.takeSetupId = null;
  state.lastDuration = 0;
  state.editingTakeId = null;
});

afterEach(() => {
  doc.restore();
  delete globalThis.__TAURI__;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

const el = (id) => doc.doc.getElementById(id);
const logTakeCalls = () => calls.filter((c) => c.cmd === "log_take");

describe("logTake", () => {
  it("builds the take payload from scene + card state", async () => {
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    el("take-camfile").value = "C0004.MP4";
    el("take-audiofile").value = "";
    el("note").value = "night shot";
    await logTake();
    assert.equal(logTakeCalls().length, 1);
    assert.deepEqual(logTakeCalls()[0].args.take, {
      scene_id: 7,
      tc_in: logTakeCalls()[0].args.take.tc_in, // wall-clock, just carries through
      cam: "A",
      lens: "35mm",
      rating: "Good",
      int_ext: "INT",
      day: 2,
      duration_sec: 0,
      setup_id: null,
      cam_file: "C0004.MP4",
      audio_file: "",
      tags: "",
      note: "night shot",
    });
    assert.match(logTakeCalls()[0].args.take.tc_in, /^\d{1,2}:\d{2}:\d{2}$/);
    assert.equal(el("take-camfile").value, "C0005.MP4"); // auto-bump
    assert.equal(el("take-no").textContent, "04");
    assert.equal(el("toast").textContent, "Take 03 · Good logged");
    assert.equal(spies.renderScenes, 1);
    assert.equal(spies.refreshStats, 1);
  });

  it("refuses a bad manual timecode without calling the backend", async () => {
    updateSettings({ manualTC: true });
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    el("take-tc").value = "bad";
    await logTake();
    assert.equal(logTakeCalls().length, 0);
    assert.equal(el("toast").textContent, "Timecode must look like HH:MM:SS");
  });

  it("needs a scene first", async () => {
    await logTake();
    assert.equal(logTakeCalls().length, 0);
    assert.equal(el("toast").textContent, "Create a scene first");
  });
});

describe("renderTakes + delete flow", () => {
  it("renders rows and deletes through confirm + backend", async () => {
    updateSettings({ confirmDelete: false });
    state.activeProjectId = 1;
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    globalThis.__TAURI__.core.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "list_project_takes") return [{ ...TAKE }];
      if (cmd === "photo_counts") return [{ scene_id: 7, count: 2 }];
      if (cmd === "list_takes") return [];
      if (cmd === "next_take") return 1;
      if (cmd === "list_setups") return [];
      return {};
    };
    await loadAllTakes();
    const trs = doc.doc._created.filter((e) => e.tagName === "tr");
    assert.equal(trs.length, 1);
    assert.match(trs[0].innerHTML, /<b>3<\/b>/);
    assert.match(trs[0].innerHTML, /📷 ×2 attached/);
    assert.equal(el("takes-count").textContent, "1 takes");
    // Drive the × button: confirm is off so it deletes straight through.
    await trs[0].querySelector(".del").onclick({ stopPropagation() {} });
    assert.deepEqual(calls.find((c) => c.cmd === "delete_take"), {
      cmd: "delete_take", args: { takeId: 11 },
    });
    assert.equal(spies.refreshStats, 1);
  });
});

describe("toggleTimer / resetTimerUI", () => {
  it("starts, stops and banks the duration", () => {
    toggleTimer();
    assert.equal(el("btn-timer").textContent, "◼ Stop");
    toggleTimer();
    assert.equal(el("btn-timer").textContent, "⏱ Start timer");
    assert.match(el("toast").textContent, /^Timed .*s - will attach/);
    assert.ok(state.lastDuration >= 0);
  });

  it("reset restores the log button", () => {
    toggleTimer();
    resetTimerUI();
    assert.equal(el("btn-log").textContent, "Log take");
    assert.equal(el("take-timer").textContent, "00:00");
  });
});

describe("saveSetup", () => {
  it("requires a name and never calls the backend without one", async () => {
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    el("setup-input").value = "   ";
    await saveSetup();
    assert.equal(el("toast").textContent, "Give the setup a name");
    assert.equal(calls.filter((c) => c.cmd === "create_setup").length, 0);
  });

  it("creates and selects the setup", async () => {
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    el("setup-input").value = "Wide";
    await saveSetup();
    assert.equal(state.takeSetupId, 9);
    assert.deepEqual(calls.find((c) => c.cmd === "create_setup").args, {
      sceneId: 7, name: "Wide",
    });
  });
});

describe("replaceCamAll", () => {
  it("confirms once, replaces, reloads scenes", async () => {
    state.activeProjectId = 1;
    state.scenes = [{ ...SCENE }];
    el("cam-input").value = "CU";
    const p = replaceCamAll();
    el("btn-confirm-ok").onclick(); // project deletes double-confirm; this one asks once
    await p;
    assert.deepEqual(calls.find((c) => c.cmd === "set_all_scene_cameras").args, {
      projectId: 1, camera: "CU",
    });
    assert.equal(el("toast").textContent, "Camera replaced on 60 scenes");
    assert.equal(spies.reloadScenes, 1);
  });

  it("needs a camera value", async () => {
    el("cam-input").value = "  ";
    await replaceCamAll();
    assert.equal(el("toast").textContent, "Enter a camera first");
    assert.equal(calls.filter((c) => c.cmd === "set_all_scene_cameras").length, 0);
  });
});

describe("saveEditTake", () => {
  it("saves a valid edit and refreshes", async () => {
    state.editingTakeId = 20;
    state.allTakes = [{ id: 20, scene_id: 7 }];
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    el("e-tc").value = "01:02:03";
    el("e-rating").value = "Good";
    el("e-cam").value = "A";
    el("e-lens").value = "35";
    el("e-intext").value = "INT";
    el("e-day").value = "2";
    el("e-setup").value = "";
    el("e-camfile").value = "";
    el("e-audiofile").value = "";
    el("e-dur").value = "";
    el("e-tags").value = "";
    el("e-note").value = "n";
    await saveEditTake();
    const call = calls.find((c) => c.cmd === "update_take");
    assert.deepEqual(call.args, {
      id: 20,
      take: {
        tc_in: "01:02:03", cam: "A", lens: "35", rating: "Good",
        int_ext: "INT", day: 2, duration_sec: 0, setup_id: null,
        cam_file: "", audio_file: "", tags: "", note: "n",
      },
    });
    assert.equal(el("toast").textContent, "Take updated");
  });

  it("blocks a bad timecode", async () => {
    state.editingTakeId = 20;
    el("e-tc").value = "xx";
    await saveEditTake();
    assert.equal(calls.filter((c) => c.cmd === "update_take").length, 0);
    assert.equal(el("toast").textContent, "Timecode must look like HH:MM:SS");
  });
});

describe("loadTakes", () => {
  it("follows the scene but stays editable per take", async () => {
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    await loadTakes();
    assert.equal(state.takeIntExt, "EXT");
    assert.equal(state.takeNo, 1);
    assert.equal(spies.loadPhotos, 1);
  });
});
