import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { state, _reloadSettings } from "../store.js";
import { openReport, renderReport, exportExcel, initReport } from "../features/report.js";
import { installFakeDocument } from "./fakeDom.js";

const PROJECT = {
  id: 1, film_name: "1917", director: "Sam", camera_op: "", location: "Field",
  unit: "", shoot_day: 2, total_days: 3, fps: 25, camera_a: "", camera_b: "",
  poster: "", scene_count: 0, take_count: 0, good_count: 0,
};
const SCENE = {
  id: 5, project_id: 1, number: "1", title: "Meadow", int_ext: "EXT",
  daypart: "Day", day: 2, location: "", status: "Complete",
  description: "", camera_default: "A", take_count: 2,
};
const TAKES = [
  {
    id: 11, scene_id: 5, scene_number: "1", scene_title: "Meadow", take_no: 1,
    tc_in: "10:00:00", cam: "A", lens: "35mm", rating: "Good", int_ext: "EXT",
    day: 2, duration_sec: 0, cam_file: "", audio_file: "", setup_id: null,
    setup_name: "", tags: "", note: "", created_at: "",
  },
  {
    id: 12, scene_id: 5, scene_number: "1", scene_title: "Meadow", take_no: 2,
    tc_in: "10:05:00", cam: "A", lens: "35mm", rating: "Bad", int_ext: "EXT",
    day: 2, duration_sec: 0, cam_file: "", audio_file: "", setup_id: null,
    setup_name: "", tags: "", note: "", created_at: "",
  },
];

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
          case "list_photos": return [{ id: 3, scene_id: 5, setup_id: null, setup_name: "", filename: "a.jpg", caption: "Hat", created_at: "" }];
          case "photo_data": return "data:image/jpeg;base64,AAA";
          case "export_excel": return "/docs/1917.xlsx";
          case "export_edl": return { events: 4, skipped: 0, path: "/docs/s.edl" };
          case "export_pdf": return "/docs/day2.pdf";
          default: return {};
        }
      },
    },
  };
  initReport();
  state.projects = [];
  state.scenes = [];
  state.allTakes = [];
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

describe("openReport", () => {
  it("needs a project first", () => {
    openReport();
    assert.equal(el("toast").textContent, "Open a project first");
  });

  it("defaults the day from the active scene and shows the view", async () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [{ ...SCENE }];
    state.activeId = 5;
    state.allTakes = [];
    await openReport();
    assert.equal(el("report-day").value, 2);
    assert.equal(el("view-report").classList.contains("hidden"), false);
    assert.match(el("report-body").innerHTML, /Daily report/);
  });
});

describe("renderReport", () => {
  it("tallies takes and builds the contact sheet", async () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [{ ...SCENE }];
    state.allTakes = [...TAKES];
    el("report-day").value = "2";
    await renderReport();
    await tick();
    const html = el("report-body").innerHTML;
    assert.match(html, /1917 - Daily report/);
    assert.match(html, /1\/1<\/b><span>scenes complete/);
    const stills = el("report-stills").innerHTML;
    assert.match(stills, /Scene 1/);
    assert.match(stills, /Hat/);
  });

  it("reports an empty day honestly", async () => {
    state.projects = [{ ...PROJECT }];
    state.activeProjectId = 1;
    state.scenes = [];
    state.allTakes = [];
    el("report-day").value = "9";
    await renderReport();
    await tick();
    assert.match(el("report-body").innerHTML, /Nothing logged for this day yet/);
    assert.match(el("report-stills").innerHTML, /No stills for this day yet/);
  });
});

describe("exports", () => {
  it("exports Excel with the settings flags", async () => {
    state.activeProjectId = 1;
    await exportExcel();
    assert.deepEqual(calls.find((c) => c.cmd === "export_excel").args, {
      projectId: 1, includeGood: true, includeDays: true,
    });
    assert.equal(el("toast").textContent, "Exported → /docs/1917.xlsx");
  });

  it("exports EDL and PDF through their buttons", async () => {
    state.activeProjectId = 1;
    await el("btn-edl").onclick();
    assert.match(el("toast").textContent, /EDL: 4 events/);
    el("report-day").value = "2";
    await el("btn-pdf").onclick();
    assert.deepEqual(calls.find((c) => c.cmd === "export_pdf").args, { projectId: 1, day: 2 });
  });
});
