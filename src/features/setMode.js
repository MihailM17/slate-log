// Slate Log — set mode: phones on the set WiFi push stills + quick takes
// straight into the live database while this stays open. Sidebar stats
// refresh arrives via initSetMode deps; scene/take reloading comes from the
// scenes/takes modules (one direction only).

import { S, state } from "../store.js";
import * as api from "../api.js";
import { $, toast, sndClick } from "../ui.js";
import { loadTakes, loadAllTakes } from "./takes.js";
import { renderScenes, renderHead } from "./scenes.js";

let setPollH = null;
let deps = {
  refreshStats() {},
};

export async function openSetMode() {
  if (!state.activeProjectId) { toast("Open a project first"); return; }
  try {
    const r = await api.setStart(state.activeId, S.setPort);
    const svg = await api.setQr();
    $("set-qr").innerHTML = svg;
    $("set-url").textContent = r.url;
    $("modal-set").classList.remove("hidden");
    refreshSetScene();
    setPollH = setInterval(refreshSetScene, 2500);
    try {
      toast("Set mode on - macOS may ask to allow incoming connections: click Allow");
    } catch { /* ignore */ }
  } catch (e) { toast("Set mode failed: " + e); }
}

export async function refreshSetScene() {
  try {
    const info = await api.setInfo();
    if (!info.running) { closeSetMode(true); return; }
    $("set-scene").textContent = info.scene_number ? `Scene ${info.scene_number} ${info.scene_title || ""}` : "-";
  } catch { /* server went away */ }
}

export async function closeSetMode(silent) {
  clearInterval(setPollH);
  setPollH = null;
  try { await api.setStop(); } catch { /* ignore */ }
  $("modal-set").classList.add("hidden");
  if (!silent) sndClick();
  // Phone may have pushed stills/takes while we were covered - refresh.
  if (state.activeProjectId) {
    await loadTakes();
    renderScenes(); renderHead();
    await loadAllTakes(); deps.refreshStats();
  }
}

export async function pushSceneToServer() {
  try { await api.setServerScene(state.activeId); } catch { /* server off */ }
  if (!$("modal-set").classList.contains("hidden")) refreshSetScene();
}

// Wire the set-mode close button. Called once at startup.
export function initSetMode(d) {
  deps = { ...deps, ...d };
  $("btn-close-set").onclick = () => closeSetMode();
}
