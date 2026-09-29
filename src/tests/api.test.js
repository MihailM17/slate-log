import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as api from "../api.js";

// Every Tauri command registered in src-tauri must have exactly one wrapper
// here, and vice versa. Update both sides together — this test fails otherwise.
const CONTRACT = {
  listProjects: ["list_projects", {}],
  createProject: ["create_project", { project: { film_name: "X" } }],
  updateProject: ["update_project", { id: 1, project: {} }],
  deleteProject: ["delete_project", { id: 1 }],
  duplicateProject: ["duplicate_project", { id: 1 }],
  setProjectDay: ["set_project_day", { id: 1, day: 2 }],
  listScenes: ["list_scenes", { projectId: 1 }],
  createScene: ["create_scene", { projectId: 1, scene: {} }],
  updateScene: ["update_scene", { id: 1, scene: {} }],
  deleteScene: ["delete_scene", { id: 1 }],
  setAllSceneCameras: ["set_all_scene_cameras", { projectId: 1, camera: "A" }],
  listSetups: ["list_setups", { sceneId: 1 }],
  createSetup: ["create_setup", { sceneId: 1, name: "Wide" }],
  deleteSetup: ["delete_setup", { id: 1 }],
  listTakes: ["list_takes", { sceneId: 1 }],
  listProjectTakes: ["list_project_takes", { projectId: 1 }],
  nextTake: ["next_take", { sceneId: 1 }],
  logTake: ["log_take", { take: {} }],
  updateTake: ["update_take", { id: 1, take: {} }],
  deleteTake: ["delete_take", { takeId: 1 }],
  getStats: ["get_stats", { projectId: 1 }],
  listPhotos: ["list_photos", { sceneId: 1 }],
  addPhoto: ["add_photo", { sceneId: 1, setupId: null }],
  photoData: ["photo_data", { id: 1, thumb: true }],
  updatePhotoCaption: ["update_photo_caption", { id: 1, caption: "cap" }],
  deletePhoto: ["delete_photo", { id: 1 }],
  photoCounts: ["photo_counts", { projectId: 1 }],
  pickStagePoster: ["pick_stage_poster", {}],
  stagedPosterData: ["staged_poster_data", { key: "k" }],
  projectPosterData: ["project_poster_data", { projectId: 1 }],
  removeProjectPoster: ["remove_project_poster", { projectId: 1 }],
  importScenesCsv: ["import_scenes_csv", { projectId: 1 }],
  importScreenplayPdf: ["import_screenplay_pdf", {}],
  parseScreenplayText: ["parse_screenplay_text", { text: "INT. X - DAY" }],
  importParsedScenes: ["import_parsed_scenes", { projectId: 1, scenes: [] }],
  exportExcel: ["export_excel", { projectId: 1, includeGood: true, includeDays: true }],
  exportPdf: ["export_pdf", { projectId: 1, day: 1 }],
  exportEdl: ["export_edl", { projectId: 1 }],
  setStart: ["set_start", { sceneId: 1, port: 17831 }],
  setStop: ["set_stop", {}],
  setServerScene: ["set_scene", { sceneId: 1 }],
  setInfo: ["set_info", {}],
  setQr: ["set_qr", {}],
  appVersion: ["app_version", {}],
  checkUpdate: ["check_update", {}],
  installUpdate: ["install_update", {}],
  undoDelete: ["undo_delete", {}],
};

let calls;
beforeEach(() => {
  calls = [];
  globalThis.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        calls.push({ cmd, args });
        return { ok: true };
      },
    },
  };
});
afterEach(() => {
  delete globalThis.__TAURI__;
});

describe("api contract", () => {
  it("exposes exactly the contracted wrappers — no more, no fewer", () => {
    assert.deepEqual(Object.keys(api).sort(), Object.keys(CONTRACT).sort());
  });

  for (const [fn, [cmd, args]] of Object.entries(CONTRACT)) {
    it(`${fn} calls ${cmd} with the right args`, async () => {
      const r = await api[fn](...Object.values(args));
      assert.deepEqual(r, { ok: true });
      assert.deepEqual(calls, [{ cmd, args }]);
    });
  }

  it("throws no-tauri outside the webview", async () => {
    delete globalThis.__TAURI__;
    await assert.rejects(api.listProjects(), /no-tauri/);
  });
});
