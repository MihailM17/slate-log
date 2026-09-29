import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./bootenv.js";
import { handleGlobalKey, submitOpenModal } from "../app.js";
import { installFakeDocument } from "./fakeDom.js";

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
          case "undo_delete": return { message: "Scene 3 restored", kind: "scene", project_id: 1, scene_id: 5 };
          case "list_projects": return [];
          case "list_scenes": return [];
          case "list_project_takes": return [];
          case "photo_counts": return [];
          case "list_takes": return [];
          case "next_take": return 1;
          case "list_setups": return [];
          case "get_stats": return { total: 0, goods: 0, good_rate: 0 };
          default: return {};
        }
      },
    },
  };
});

afterEach(() => {
  doc.restore();
  delete globalThis.__TAURI__;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

const el = (id) => doc.doc.getElementById(id);
const open = (id) => el(id).classList.remove("hidden");
const keyEvent = (over = {}) => ({
  ctrlKey: false, metaKey: false, shiftKey: false, code: "",
  key: "", preventDefault() {},
  target: { tagName: "DIV", matches: () => false },
  ...over,
});

describe("submitOpenModal", () => {
  it("hits the confirm dialog before the modal underneath", () => {
    open("modal-setup");
    open("modal-confirm");
    let setupClicked = false;
    let confirmClicked = false;
    el("btn-save-setup").click = () => { setupClicked = true; };
    el("btn-confirm-ok").click = () => { confirmClicked = true; };
    assert.equal(submitOpenModal(), true);
    assert.equal(confirmClicked, true);
    assert.equal(setupClicked, false);
  });

  it("submits a lone modal", () => {
    open("modal-cam");
    let clicked = false;
    el("btn-save-cam").click = () => { clicked = true; };
    assert.equal(submitOpenModal(), true);
    assert.equal(clicked, true);
  });

  it("returns false with nothing open", () => {
    assert.equal(submitOpenModal(), false);
  });
});

describe("handleGlobalKey undo", () => {
  it("fires on a plain surface", async () => {
    handleGlobalKey(keyEvent({ ctrlKey: true, code: "KeyZ" }));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.filter((c) => c.cmd === "undo_delete").length, 1);
  });

  it("leaves text undo alone in inputs, textareas and selects", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      handleGlobalKey(keyEvent({
        ctrlKey: true, code: "KeyZ",
        target: { tagName: tag, matches: () => true },
      }));
    }
    assert.equal(calls.filter((c) => c.cmd === "undo_delete").length, 0);
  });
});
