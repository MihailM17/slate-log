// Slate Log - projects + scenes + takes. Empty start, no seed data.
// This file is the wiring shell: global key handling, modal system, app
// chrome (sidebar stats/resize, scroll isolation) and feature init. Every
// feature lives in its own module under features/ (tested via npm test).
import * as api from "./api.js";
import { nowTC, clampSidebarWidth, shouldIsolateWheel } from "./utils.js";
import {
  initTakes, loadTakes, logTake, renderChips, syncLensSeg,
} from "./features/takes.js";
import {
  initScenes, loadScenes, renderScenes, renderHead, openNewScene, scrollActiveSceneIntoView,
} from "./features/scenes.js";
import { initPhotos, loadPhotos } from "./features/photos.js";
import { initProjects, loadProjects, undoDelete } from "./features/projects.js";
import { initProgress } from "./features/progress.js";
import { initReport, exportExcel } from "./features/report.js";
import { initSetMode, openSetMode, closeSetMode, pushSceneToServer } from "./features/setMode.js";
import { initScriptImport } from "./features/scriptImport.js";

import { S, state, DEFAULT_SHORTCUTS } from "./store.js";
import { $, toast } from "./ui.js";
import { initSettings, applySettingsToUI, handleCaptureKey } from "./features/settings.js";
async function refreshStats() {
  if (!state.activeProjectId) return;
  try {
    const s = await api.getStats(state.activeProjectId);
    $("stat-total").textContent = `${s.total} takes logged`;
    $("stat-rate").textContent = `${s.good_rate ?? s.print_rate ?? 0}% good`;
  } catch { /* ignore */ }
}

// ---------- modal keyboard system: Enter submits, Esc closes ----------
// (remappable shortcuts live in features/settings.js)
const modalOpen = () => !!document.querySelector(".modal:not(.hidden)");

// Order matters: the confirm dialog floats above other modals, so Enter
// must hit it first (e.g. delete-setup confirm over the setup modal).
const ENTER_SUBMIT = {
  "modal-confirm": "btn-confirm-ok",
  "modal": "btn-create",
  "modal-take": "btn-save-take",
  "modal-project": "btn-save-project",
  "modal-cam": "btn-save-cam",
  "modal-lens": "btn-save-lens",
  "modal-setup": "btn-save-setup",
  "modal-settings": "btn-close-settings",
  "modal-shortcuts": "btn-close-shortcuts",
  "modal-lightbox": "btn-lightbox-save",
};

export function submitOpenModal() {
  for (const [mid, bid] of Object.entries(ENTER_SUBMIT)) {
    const m = $(mid);
    if (m && !m.classList.contains("hidden")) {
      const b = $(bid);
      if (b) b.click();
      return true;
    }
  }
  return false;
}

function closeTopModal() {
  // Topmost first: confirm floats above everything (z-index).
  for (const mid of ["modal-confirm", "modal-shortcuts", "modal-lightbox", "modal-setup", "modal-lens", "modal-cam", "modal-take", "modal", "modal-project", "modal-settings", "modal-set"]) {
    const m = $(mid);
    if (m && !m.classList.contains("hidden")) {
      if (mid === "modal-confirm") { $("btn-confirm-cancel").click(); }
      else if (mid === "modal-set") { closeSetMode(); }
      else if (mid === "modal-lens") { $("btn-cancel-lens").click(); }
      else { m.classList.add("hidden"); }
      return true;
    }
  }
  return false;
}
// set mode lives in features/setMode.js; screenplay import in
// features/scriptImport.js; report + exports in features/report.js; wrap
// progress in features/progress.js. Their buttons are wired in each
// module's init function (see bottom of this file).

export function handleGlobalKey(e) {
  // Remap capture (features/settings.js) has first dibs on every key.
  if (handleCaptureKey(e)) return;
  // Ctrl/Cmd+Z undoes the last scene or project deletion — except inside
  // editable fields, where text undo wins.
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !e.shiftKey) {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    e.preventDefault();
    undoDelete();
    return;
  }
  if (e.key === "Escape") {
    if (closeTopModal()) { e.preventDefault(); }
    return;
  }
  // Enter submits whichever modal is open (but never inside a textarea).
  if (e.key === "Enter" && e.target.matches("input,select") && modalOpen()) {
    e.preventDefault();
    submitOpenModal();
    return;
  }
  if (e.target.matches("input,textarea,select")) return;
  if (modalOpen()) return; // action shortcuts stay out while a popup is up
  const eq = (a) => e.code === (S.shortcuts[a] || DEFAULT_SHORTCUTS[a]);
  if (eq("logTake")) { if (e.code === "Space") e.preventDefault(); logTake(); }
  else if (eq("rateGood")) document.querySelector('#seg-rating [data-v="Good"]').click();
  else if (eq("rateMaybe")) document.querySelector('#seg-rating [data-v="Maybe"]').click();
  else if (eq("rateBad")) document.querySelector('#seg-rating [data-v="Bad"]').click();
  else if (eq("newScene")) openNewScene();
  else if (e.code === (S.shortcuts.nextScene || "ArrowDown") || e.code === (S.shortcuts.prevScene || "ArrowUp")) {
    const i = state.scenes.findIndex((s) => s.id === state.activeId);
    const n = e.code === (S.shortcuts.nextScene || "ArrowDown") ? i + 1 : i - 1;
    if (state.scenes[n]) { state.activeId = state.scenes[n].id; loadTakes().then(() => { renderScenes(); renderHead(); pushSceneToServer(); scrollActiveSceneIntoView(); }); }
  }
}

document.addEventListener("keydown", handleGlobalKey);

setInterval(() => { $("tc-now").textContent = nowTC(); }, 1000);
$("tc-now").textContent = nowTC();
// Settings owns its subscription + boot update check (see initSettings).
initSettings({ renderChips, syncLensSeg });
initTakes({ renderScenes, renderHead, refreshStats, loadPhotos, reloadScenes: loadScenes });
initScenes({ refreshStats, pushSceneToServer });
initPhotos({ openSetMode });
initProjects({ refreshStats, onExportProject: (id) => exportExcel(id) });
$("btn-photos").onclick = async () => {
  try {
    await api.openProjectPhotos(state.activeProjectId);
  } catch (e) { toast("Could not open photo folder: " + e); }
};
initProgress();
initReport();
initScriptImport({ loadScenes });
initSetMode({ refreshStats });
applySettingsToUI();
loadProjects();

// ---------- resizable scenes sidebar (drag the right edge, 200–520px, remembered) ----------
(function initSidebarResize() {
  const bar = document.querySelector("#view-app .sidebar");
  const grip = $("sidebar-resize");
  if (!bar || !grip) return;
  try {
    const w = clampSidebarWidth(parseInt(localStorage.getItem("slate-sidebar-w") || ""));
    if (Number.isFinite(w)) bar.style.width = w + "px";
  } catch { /* fresh start */ }
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    grip.classList.add("drag");
    const x0 = e.clientX, w0 = bar.getBoundingClientRect().width;
    const move = (m) => {
      bar.style.width = clampSidebarWidth(w0 + m.clientX - x0) + "px";
    };
    const up = (m) => {
      move(m);
      grip.classList.remove("drag");
      try { localStorage.setItem("slate-sidebar-w", String(Math.round(bar.getBoundingClientRect().width))); } catch { /* ignore */ }
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
})();

// ---------- scroll isolation: a list/modal at its end must not scroll the page behind ----------
// Single capture-phase handler covers re-rendered lists too (no listener pile-up).
// shouldIsolateWheel (tested) decides: scrollers with no overflow pass through.
document.addEventListener("wheel", (e) => {
  const el = e.target.closest?.("#scene-list, .modal-card, .table-wrap, .photo-grid");
  if (!el) return;
  if (shouldIsolateWheel(el, e.deltaY)) e.preventDefault();
  e.stopPropagation();
}, { passive: false, capture: true });
