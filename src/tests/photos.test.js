import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { state, updateSettings, _reloadSettings } from "../store.js";
import { initPhotos, loadPhotos } from "../features/photos.js";
import { installFakeDocument } from "./fakeDom.js";

const SCENE = {
  id: 7, project_id: 1, number: "3", title: "Meadow", int_ext: "EXT",
  daypart: "Day", day: 2, location: "", status: "Not shot",
  description: "", camera_default: "A", take_count: 0,
};
const PHOTO = {
  id: 3, scene_id: 7, setup_id: null, setup_name: "",
  filename: "a.jpg", caption: "Hat", created_at: "",
};

let doc;
let calls;
let setMode;
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
          case "list_photos": return [{ ...PHOTO }];
          case "photo_data": return "data:image/jpeg;base64,AAA";
          case "list_project_takes": return [];
          case "photo_counts": return [];
          default: return {};
        }
      },
    },
  };
  setMode = 0;
  initPhotos({ openSetMode: () => setMode++ });
  state.scenes = [];
  state.photos = [];
  state.allTakes = [];
  state.photoCounts = {};
  state.activeId = null;
  state.activeProjectId = null;
  state.takeSetupId = null;
  state.lightboxId = null;
});

afterEach(() => {
  doc.restore();
  delete globalThis.__TAURI__;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

const el = (id) => doc.doc.getElementById(id);
const cells = () => doc.doc._created.filter((e) => e.tagName === "div" && e.className === "photo-cell");

describe("loadPhotos", () => {
  it("clears the grid with no scene selected", async () => {
    await loadPhotos();
    assert.deepEqual(state.photos, []);
    assert.equal(el("photos").innerHTML, "");
    assert.equal(calls.filter((c) => c.cmd === "list_photos").length, 0);
  });

  it("loads stills and renders the grid with captions", async () => {
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    await loadPhotos();
    await tick();
    assert.equal(state.photos.length, 1);
    assert.match(el("photos").innerHTML, /Continuity stills/);
    const found = cells();
    assert.equal(found.length, 1);
    assert.match(found[0].innerHTML, /Hat/);
    assert.equal(found[0].querySelector("img").src, "data:image/jpeg;base64,AAA");
  });
});

describe("still delete flow", () => {
  it("deletes through the × button and refreshes takes", async () => {
    updateSettings({ confirmDelete: false });
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    state.activeProjectId = 1;
    await loadPhotos();
    const cell = cells()[0];
    await cell.querySelector(".px").onclick({ stopPropagation() {} });
    assert.deepEqual(calls.find((c) => c.cmd === "delete_photo").args, { id: 3 });
    assert.ok(calls.some((c) => c.cmd === "list_project_takes"), "takes reloaded");
  });
});

describe("addPhoto", () => {
  it("adds and refreshes", async () => {
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    state.activeProjectId = 1;
    // btn-add-photo is wired per render, so render first.
    await loadPhotos();
    await el("btn-add-photo").onclick();
    assert.deepEqual(calls.find((c) => c.cmd === "add_photo").args, { sceneId: 7, setupId: null });
    assert.equal(el("toast").textContent, "Photo added");
  });

  it("stays silent on cancel, complains on real errors", async () => {
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    await loadPhotos();
    globalThis.__TAURI__.core.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "add_photo") throw new Error("cancelled");
      if (cmd === "list_photos") return [];
      if (cmd === "list_project_takes") return [];
      if (cmd === "photo_counts") return [];
      return {};
    };
    await el("btn-add-photo").onclick();
    assert.equal(el("toast").textContent, "");
    globalThis.__TAURI__.core.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "add_photo") throw new Error("disk full");
      if (cmd === "list_photos") return [];
      return {};
    };
    await el("btn-add-photo").onclick();
    assert.match(el("toast").textContent, /Photo failed:.*disk full/);
  });
});

describe("lightbox", () => {
  it("opens, saves captions and deletes", async () => {
    updateSettings({ confirmDelete: false });
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    state.activeProjectId = 1;
    await loadPhotos();
    cells()[0].querySelector("img").onclick();
    await tick();
    assert.equal(state.lightboxId, 3);
    assert.equal(el("lightbox-cap").value, "Hat");
    assert.equal(el("lightbox-img").src, "data:image/jpeg;base64,AAA");
    el("lightbox-cap").value = "New cap";
    await el("btn-lightbox-save").onclick();
    assert.deepEqual(calls.find((c) => c.cmd === "update_photo_caption").args, {
      id: 3, caption: "New cap",
    });
    await el("btn-lightbox-del").onclick();
    assert.deepEqual(calls.find((c) => c.cmd === "delete_photo").args, { id: 3 });
    assert.equal(state.lightboxId, null);
  });
});

describe("set-mode button", () => {
  it("delegates to the injected opener", async () => {
    state.scenes = [{ ...SCENE }];
    state.activeId = 7;
    await loadPhotos();
    el("btn-set").onclick();
    assert.equal(setMode, 1);
  });
});
