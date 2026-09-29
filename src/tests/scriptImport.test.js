import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { state, updateSettings, _reloadSettings } from "../store.js";
import { initScriptImport } from "../features/scriptImport.js";
import { installFakeDocument } from "./fakeDom.js";

const PARSED = [
  {
    number: "1", title: "MEADOW", int_ext: "EXT", daypart: "Day",
    location: "", setups: ["WIDE SHOT - #1"],
  },
  {
    number: "2", title: "TRENCH", int_ext: "INT", daypart: "Night",
    location: "", setups: [],
  },
];

let doc;
let calls;
let loaded;
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
          case "import_screenplay_pdf": return { cancelled: false, scenes: PARSED, warnings: [] };
          case "import_parsed_scenes": return { imported: 2, setups: 1, duplicates: 0, skipped: 0 };
          default: return {};
        }
      },
    },
  };
  loaded = 0;
  initScriptImport({ loadScenes: async () => { loaded++; } });
  state.activeProjectId = 1;
  state.projectQuery = "";
});

afterEach(() => {
  doc.restore();
  delete globalThis.__TAURI__;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

const el = (id) => doc.doc.getElementById(id);
const reviewRows = () => doc.doc._created.filter((e) => e.tagName === "tr");

describe("PDF auto-import", () => {
  it("creates scenes straight from the PDF", async () => {
    await el("btn-script").onclick();
    const call = calls.find((c) => c.cmd === "import_parsed_scenes");
    assert.deepEqual(call.args, {
      projectId: 1,
      scenes: [
        { number: "1", title: "MEADOW", int_ext: "EXT", daypart: "Day", location: "", setups: ["WIDE SHOT - #1"] },
        { number: "2", title: "TRENCH", int_ext: "INT", daypart: "Night", location: "", setups: [] },
      ],
    });
    assert.equal(el("toast").textContent, "Imported 2 scenes + 1 setups");
    assert.equal(loaded, 1);
  });

  it("stops on cancel", async () => {
    globalThis.__TAURI__.core.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      return { cancelled: true };
    };
    await el("btn-script").onclick();
    assert.equal(el("toast").textContent, "Import cancelled");
    assert.equal(calls.filter((c) => c.cmd === "import_parsed_scenes").length, 0);
  });

  it("falls back to paste when nothing parses", async () => {
    globalThis.__TAURI__.core.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      return { cancelled: false, scenes: [], warnings: [] };
    };
    await el("btn-script").onclick();
    assert.match(el("script-sub").textContent, /paste the script text below/);
    assert.equal(el("view-script").classList.contains("hidden"), false);
  });
});

describe("paste + review", () => {
  it("parses pasted text into the review table", async () => {
    globalThis.__TAURI__.core.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "parse_screenplay_text") return { cancelled: false, scenes: PARSED, warnings: ["w1"] };
      return {};
    };
    el("script-paste").value = "1 EXT. MEADOW - DAY";
    await el("btn-script-parse").onclick();
    assert.equal(reviewRows().length, 2);
    assert.match(reviewRows()[0].innerHTML, /value="MEADOW"/);
    assert.match(reviewRows()[0].innerHTML, /value=""/); // location stays empty
    assert.equal(el("script-warn").textContent, "w1");
  });

  it("fills location when the setting is on", async () => {
    updateSettings({ fillLocation: true });
    globalThis.__TAURI__.core.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "parse_screenplay_text") return { cancelled: false, scenes: PARSED, warnings: [] };
      return {};
    };
    el("script-paste").value = "1 EXT. MEADOW - DAY";
    await el("btn-script-parse").onclick();
    assert.match(reviewRows()[0].innerHTML, /value="MEADOW"/g);
  });

  it("refuses an empty review import", async () => {
    await el("btn-script-import").onclick();
    assert.equal(el("toast").textContent, "Nothing checked");
  });
});
