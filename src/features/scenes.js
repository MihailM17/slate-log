// Slate Log — scenes feature: scene list, scene modal (new/edit), status
// cycling, day stepper, project header, scene header.
//
// Selection helpers (active/activeProject) live here and are shared with the
// features extracted later. Takes loading comes from takes.js (one direction
// only — takes.js never imports this module); sidebar stats and the set-mode
// push arrive via initScenes deps.

import { S, state } from "../store.js";
import * as api from "../api.js";
import { esc, pad, nextStatus, scenePayload } from "../utils.js";
import { $, toast, sndClick, sndDelete, confirmAsync } from "../ui.js";
import { loadTakes, loadAllTakes } from "./takes.js";

export const activeProject = () => state.projects.find((p) => p.id === state.activeProjectId);
export const active = () => state.scenes.find((s) => s.id === state.activeId);

let deps = {
  refreshStats() {},
  pushSceneToServer() {},
};

export async function loadScenes() {
  const pid = state.activeProjectId; if (!pid) return;
  try { state.scenes = await api.listScenes(pid); }
  catch { state.scenes = []; }
  if (!state.scenes.find((s) => s.id === state.activeId)) state.activeId = state.scenes[0]?.id ?? null;
  renderProjectHeader(); renderScenes();
  if (state.activeId) await loadTakes(); else { state.takes = []; state.takeNo = 1; renderHead(); }
  await loadAllTakes();
  deps.refreshStats();
}

function renderProjectHeader() {
  const p = activeProject(); if (!p) return;
  $("proj-name").textContent = p.film_name || "Untitled film";
  // Day follows the selected scene; project day is the fallback for new scenes.
  $("day-label").textContent = `Day ${active()?.day ?? p.shoot_day ?? 1}`;
  $("proj-sub").textContent = `${p.location}${p.unit ? ", " + p.unit : ""}` || "-";
  const crew = [p.director && `Dir. ${p.director}`, p.camera_op && `Cam op. ${p.camera_op}`].filter(Boolean).join(" · ");
  $("proj-crew").textContent = crew || "-";
  document.title = `${p.film_name || "Slate Log"} - Slate Log`;
}

export async function stepDay(delta) {
  const sc = active();
  if (sc) {
    // Day lives on the scene - the stepper is a quick way to set it.
    const day = Math.max(1, (sc.day || 1) + delta);
    const payload = scenePayload(sc, { day });
    try { await api.updateScene(sc.id, payload); } catch (e) { toast("Day change failed: " + e); return; }
    sc.day = day;
    sndClick();
    renderScenes(); renderHead(); deps.refreshStats();
    return;
  }
  const p = activeProject(); if (!p) return;
  const day = Math.max(1, (p.shoot_day || 1) + delta);
  try { await api.setProjectDay(p.id, day); } catch (e) { toast("Day change failed: " + e); return; }
  p.shoot_day = day;
  sndClick();
  renderProjectHeader(); renderHead();
}

// Keep keyboard navigation visible: after the active scene moves, bring it
// into view inside the sidebar list (nearest = no-op when already visible).
export function scrollActiveSceneIntoView() {
  const el = document.querySelector("#scene-list .scene.active");
  if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
}

export function renderScenes() {
  const q = state.filter.toLowerCase();
  const list = $("scene-list"); list.innerHTML = "";
  const rows = state.scenes.filter((s) => (s.number + " " + s.title).toLowerCase().includes(q));
  $("scene-count").textContent = state.scenes.length;
  if (!rows.length) {
    list.innerHTML = `<div class="empty-hint">No scenes yet.<br>Click + New scene.</div>`;
    return;
  }
  rows.forEach((s) => {
    const d = document.createElement("div");
    d.className = "scene" + (s.id === state.activeId ? " active" : "");
    const st = s.status || "Not shot";
    const photoN = state.photoCounts[s.id] || 0;
    d.innerHTML = `<span class="scene-dot ${st}" title="${esc(st)}"></span><span class="num">${esc(s.number)}</span><div><div class="t">${esc(s.title) || "(untitled)"}</div><div class="m"><span class="badge">${esc(s.int_ext)}</span><span>${esc(s.daypart)} · Day ${s.day ?? 1} · ${s.take_count ?? 0} takes${photoN ? ` · 📷 ${photoN}` : ""}${s.location ? " · " + esc(s.location) : ""}${st !== "Not shot" ? " · " + esc(st) : ""}</span></div></div>
      <div class="row-actions"><button class="mini-btn" data-act="edit" title="Edit scene">✎</button><button class="mini-btn danger" data-act="del" title="Delete scene + its takes">×</button></div>`;
    d.onclick = async (e) => {
      const act = e.target.dataset?.act;
      if (act === "del") { e.stopPropagation(); await deleteScene(s); return; }
      if (act === "edit") { e.stopPropagation(); openEditScene(s); return; }
      state.activeId = s.id; await loadTakes(); renderScenes(); renderHead(); deps.pushSceneToServer();
    };
    list.appendChild(d);
  });
}

export async function deleteScene(s) {
  if (!(await confirmAsync(`Delete scene ${s.number} “${s.title}” + its ${s.take_count ?? 0} takes?`))) return;
  try { await api.deleteScene(s.id); } catch (e) { toast("Delete failed: " + e); return; }
  sndDelete();
  if (state.activeId === s.id) state.activeId = null;
  await loadScenes();
  toast("Scene deleted — Ctrl+Z to undo");
}

export function openNewScene() {
  if (!state.activeProjectId) { toast("Create a project first"); return; }
  state.editingSceneId = null;
  $("modal-title").textContent = "New scene";
  $("btn-create").textContent = "Create scene";
  const nums = state.scenes.map((s) => parseInt(s.number, 10)).filter((n) => !isNaN(n));
  $("f-number").value = nums.length ? String(Math.max(...nums) + 1) : "1";
  $("f-title").value = ""; $("f-desc").value = "";
  // Carry the camera forward from the previous (highest-numbered) scene -
  // same rig 90% of the time, still editable.
  const prevCam = state.scenes
    .map((s) => ({ n: parseInt(s.number, 10), cam: (s.camera_default || "").trim() }))
    .filter((x) => !isNaN(x.n) && x.cam)
    .sort((a, b) => b.n - a.n)[0]?.cam || "";
  $("f-camera").value = prevCam || S.defaultCam || "";
  $("f-location").value = "";
  $("f-intext").value = S.defaultIntExt || "INT";
  $("f-day").value = active()?.day ?? activeProject()?.shoot_day ?? 1;
  $("modal").classList.remove("hidden");
}

function openEditScene(s) {
  state.editingSceneId = s.id;
  $("modal-title").textContent = `Edit scene ${s.number}`;
  $("btn-create").textContent = "Save changes";
  $("f-number").value = s.number; $("f-title").value = s.title;
  $("f-intext").value = s.int_ext; $("f-daypart").value = s.daypart;
  $("f-camera").value = s.camera_default; $("f-desc").value = s.description;
  $("f-location").value = s.location || "";
  $("f-status").value = s.status || "Not shot";
  $("f-day").value = s.day ?? 1;
  $("modal").classList.remove("hidden");
}

export function renderHead() {
  const s = active();
  if (!s) { $("scene-head").innerHTML = `<p class="empty-hint">Select or create a scene to start logging.</p>`; return; }
  const p = activeProject();
  $("scene-head").innerHTML = `<h2><span class="n">${esc(s.number)}</span>${esc(s.int_ext)}. ${esc(s.title || "").toUpperCase()} - ${esc(s.daypart).toUpperCase()}<button class="scene-edit-btn" id="btn-edit-scene">✎ Edit</button><button class="status-btn ${esc(s.status || "Not shot").replace(" ", "")}" id="btn-status" title="Tap to cycle shoot status">${esc(s.status || "Not shot")}</button></h2>
    <div class="meta plain"><span>Day ${s.day ?? "–"}</span>${s.location ? `<span>${esc(s.location)}</span>` : ""}<span>${state.takes.length} takes logged</span><span>Camera ${esc(s.camera_default) || "-"}</span></div>
    <p class="desc">${esc(s.description) || ""}</p>`;
  $("take-no").textContent = pad(state.takeNo);
  $("btn-edit-scene").onclick = () => openEditScene(s);
  $("btn-status").onclick = () => cycleStatus(s);
  renderProjectHeader();
}

export async function cycleStatus(s) {
  const payload = scenePayload(s, { status: nextStatus(s.status || "Not shot") });
  try { await api.updateScene(s.id, payload); }
  catch (e) { toast("Save failed: " + e); return; }
  s.status = payload.status;
  sndClick();
  renderScenes(); renderHead();
}

async function saveScene() {
  const s = { number: $("f-number").value.trim() || "1", title: $("f-title").value.trim(), int_ext: $("f-intext").value, daypart: $("f-daypart").value, description: $("f-desc").value, camera_default: $("f-camera").value.trim(), day: parseInt($("f-day").value) || 1, location: $("f-location").value.trim(), status: $("f-status").value };
  try {
    if (state.editingSceneId) { await api.updateScene(state.editingSceneId, s); state.activeId = state.editingSceneId; }
    else { const created = await api.createScene(state.activeProjectId, s); state.activeId = created.id; }
  } catch (e) { toast("Save failed: " + e); return; }
  $("modal").classList.add("hidden");
  sndClick();
  await loadScenes();
}

// Wire the scene panel + scene modal + day stepper. Called once at startup.
export function initScenes(d) {
  deps = { ...deps, ...d };
  $("filter").oninput = (e) => { state.filter = e.target.value; renderScenes(); };
  $("btn-new-scene").onclick = openNewScene;
  $("btn-cancel").onclick = () => $("modal").classList.add("hidden");
  $("btn-create").onclick = saveScene;
  $("day-prev").onclick = () => stepDay(-1);
  $("day-next").onclick = () => stepDay(1);
}
