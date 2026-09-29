import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./bootenv.js";
// Importing the shell is the test: a bad import path, a missing export, or
// a throw during startup wiring fails this file (blank app in production).
import "../app.js";
import { state } from "../store.js";

// Let the startup promise chain (loadProjects with no backend) settle.
await new Promise((r) => setImmediate(r));
await new Promise((r) => setImmediate(r));

const $ = (id) => globalThis.document.getElementById(id);

describe("app boot (no backend)", () => {
  it("loads with an empty project list and shows the empty state", () => {
    assert.deepEqual(state.projects, []);
    assert.equal($("home-empty").classList.contains("hidden"), false);
    assert.equal($("toast").textContent, "");
  });

  it("wired every feature's entry points", () => {
    const wired = (id) => {
      const el = $(id);
      return [el.onclick, el.onchange, el.oninput].some((h) => typeof h === "function");
    };
    for (const id of [
      "btn-home-new", "btn-home-first", "btn-home",           // projects
      "btn-new-scene", "btn-create", "day-prev", "day-next",  // scenes
      "btn-log", "btn-timer", "btn-cam", "btn-add-setup",     // takes
      "btn-lightbox-close", "btn-lightbox-save",              // photos
      "btn-settings", "btn-open-shortcuts", "btn-check-updates", // settings
      "btn-progress", "btn-report", "btn-edl", "btn-pdf", "btn-export", // outputs
      "btn-script", "btn-script-parse", "btn-script-import",  // script import
      "btn-close-set",                                       // set mode
    ]) {
      assert.equal(wired(id), true, `${id} wired`);
    }
  });
});
