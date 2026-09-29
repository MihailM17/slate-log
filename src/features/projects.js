// Slate Log — projects feature: home grid, project modal (new/edit with
// poster), delete/duplicate, undo. Sidebar stats and the Excel export live
// elsewhere and arrive via initProjects deps; scene/take loading comes from
// the scenes/takes modules (one direction only).

import { state } from "../store.js";
import * as api from "../api.js";
import { esc } from "../utils.js";
import { $, toast, sndClick, sndDelete, confirmAsync, showView } from "../ui.js";
import { loadScenes, renderScenes, renderHead, activeProject } from "./scenes.js";
import { loadAllTakes, resetTimerUI } from "./takes.js";

let deps = {
  refreshStats() {},
  onExportProject() {},
};

export async function loadProjects() {
  try { state.projects = await api.listProjects(); }
  catch { state.projects = []; }
  renderHome();
}

function renderHome() {
  const q = (state.projectQuery || "").toLowerCase();
  const grid = $("project-grid"); grid.innerHTML = "";
  const rows = state.projects.filter((p) =>
    ((p.film_name || "") + " " + (p.director || "")).toLowerCase().includes(q));
  $("home-empty").classList.toggle("hidden", state.projects.length > 0);
  rows.forEach((p) => {
    const rate = p.take_count ? Math.round((p.good_count || 0) * 100 / p.take_count) : 0;
    const crew = [p.director && `Dir. ${esc(p.director)}`, p.camera_op && `Cam op. ${esc(p.camera_op)}`].filter(Boolean).join(" · ");
    const loc = [p.location, p.unit].filter(Boolean).map(esc).join(", ");
    const d = document.createElement("div");
    d.className = "card-p";
    d.title = "Open project";
    d.innerHTML = `${p.poster ? `<img class="poster" alt="">` : ""}
      <h3>${esc(p.film_name) || "Untitled film"}</h3>
      ${crew ? `<div class="crew">${crew}</div>` : ""}
      ${loc ? `<div class="crew">${loc}</div>` : ""}
      <div class="stats">Day ${p.shoot_day} · ${p.scene_count} scenes · ${p.take_count} takes · ${rate}% good</div>
      <div class="row">
        <button class="btn primary" data-act="open">Open →</button>
        <button class="btn ghost" data-act="edit" title="Edit project">✎</button>
        <button class="btn ghost" data-act="dup" title="Duplicate project">⧉</button>
        <button class="btn ghost" data-act="exp" title="Export to Excel">▦</button>
        <button class="btn ghost" data-act="del" title="Delete project">×</button>
      </div>`;
    if (p.poster) {
      api.projectPosterData(p.id)
        .then((src) => { const im = d.querySelector("img.poster"); if (im && src) im.src = src; })
        .catch(() => {});
    }
    d.onclick = async (e) => {
      const act = e.target.dataset?.act || "open";
      if (act === "open") { await openProject(p.id); return; }
      e.stopPropagation();
      if (act === "edit") openEditProject(p);
      else if (act === "dup") await duplicateProject(p);
      else if (act === "exp") await deps.onExportProject(p.id);
      else if (act === "del") await deleteProject(p);
    };
    grid.appendChild(d);
  });
}

export async function openProject(id) {
  state.activeProjectId = id; state.activeId = null;
  state.scenes = []; state.takes = []; state.allTakes = []; state.setups = []; state.photos = [];
  resetTimerUI();
  showView("app");
  await loadScenes();
}

async function goHome() {
  state.activeProjectId = null; state.activeId = null;
  showView("home");
  await loadProjects();
}

function setPosterPreview(src) {
  const im = $("p-poster");
  if (src) { im.src = src; im.classList.remove("none"); }
  else { im.removeAttribute("src"); im.classList.add("none"); }
}

function openNewProject() {
  state.editingProjectId = null;
  state.pendingPosterKey = null; state.posterRemove = false;
  $("project-modal-title").textContent = "New project";
  ["p-film","p-director","p-cameraop","p-location","p-unit"].forEach((id) => $(id).value = "");
  $("p-fps").value = "25";
  setPosterPreview(null);
  $("modal-project").classList.remove("hidden");
}

function openEditProject(p) {
  p = p || activeProject();
  if (!p) { toast("Create a project first"); return; }
  state.editingProjectId = p.id;
  state.pendingPosterKey = null; state.posterRemove = false;
  $("project-modal-title").textContent = "Edit project";
  $("p-film").value = p.film_name; $("p-director").value = p.director; $("p-cameraop").value = p.camera_op;
  $("p-location").value = p.location; $("p-unit").value = p.unit;
  $("p-fps").value = String(p.fps ?? 25);
  setPosterPreview(null);
  if (p.poster) {
    api.projectPosterData(p.id)
      .then((src) => { if (src) setPosterPreview(src); })
      .catch(() => {});
  }
  $("modal-project").classList.remove("hidden");
}

async function saveProject() {
  const cur = activeProject();
  const p = {
    film_name: $("p-film").value.trim() || "Untitled film",
    director: $("p-director").value.trim(), camera_op: $("p-cameraop").value.trim(),
    location: $("p-location").value.trim(), unit: $("p-unit").value.trim(),
    fps: parseFloat($("p-fps").value) || 25,
    // days are driven by the ◀ Day ▶ stepper, cameras per take - not asked here
    shoot_day: state.editingProjectId ? (cur?.shoot_day ?? 1) : 1,
    total_days: state.editingProjectId ? (cur?.total_days ?? 1) : 1,
    camera_a: cur?.camera_a ?? "", camera_b: cur?.camera_b ?? "",
    poster_stage: state.pendingPosterKey || null,
  };
  try {
    if (state.editingProjectId) {
      await api.updateProject(state.editingProjectId, p);
      if (state.posterRemove && !state.pendingPosterKey) {
        try { await api.removeProjectPoster(state.editingProjectId); } catch { /* already gone */ }
      }
      state.activeProjectId = state.editingProjectId;
    } else {
      const created = await api.createProject(p);
      state.activeProjectId = created.id;
    }
  } catch (e) { toast("Save failed: " + e); return; }
  state.pendingPosterKey = null; state.posterRemove = false;
  $("modal-project").classList.add("hidden");
  await loadProjects();
}

async function deleteProject(p) {
  p = p || activeProject();
  if (!p) return;
  // Projects always double-confirm, even when the settings toggle is off.
  if (!(await confirmAsync(`Delete project “${p.film_name}” + all ${p.scene_count} scenes and ${p.take_count} takes?`, "Delete", true))) return;
  if (!(await confirmAsync(`Really delete “${p.film_name}”? This cannot be undone (Ctrl+Z restores it right after).`, "Yes, delete", true))) return;
  try { await api.deleteProject(p.id); } catch (e) { toast("Delete failed: " + e); return; }
  sndDelete();
  if (state.activeProjectId === p.id) { state.activeProjectId = null; state.activeId = null; }
  await loadProjects();
  toast("Project deleted — Ctrl+Z to undo");
}

export async function undoDelete() {
  let r;
  try {
    r = await api.undoDelete();
    sndClick();
    toast(r.message || "Restored");
  } catch (e) {
    const m = String(e);
    if (!m.includes("nothing to undo")) toast("Nothing to undo: " + m);
    return;
  }
  await loadProjects();
  // Re-select what was restored so the user lands back where they were.
  if (r.kind === "project" && r.project_id) {
    state.activeProjectId = r.project_id; state.activeId = null;
    showView("app");
    await loadScenes();
  } else if (r.kind === "scene" && r.project_id) {
    if (state.activeProjectId !== r.project_id) {
      state.activeProjectId = r.project_id;
      showView("app");
    }
    state.activeId = r.scene_id ?? state.activeId;
    await loadScenes();
    if (r.scene_id) state.activeId = r.scene_id;
  } else if (state.activeProjectId) {
    await loadScenes();
  }
  await loadAllTakes();
  renderScenes(); renderHead(); deps.refreshStats();
}

async function duplicateProject(p) {
  try {
    const copy = await api.duplicateProject(p.id);
    sndClick();
    toast(`Duplicated as “${copy.film_name}”`);
  } catch (e) { toast("Duplicate failed: " + e); return; }
  await loadProjects();
}

// Wire the home screen + project modal. Called once at startup.
export function initProjects(d) {
  deps = { ...deps, ...d };
  $("btn-home").onclick = goHome;
  $("btn-home-new").onclick = openNewProject;
  $("btn-home-first").onclick = openNewProject;
  $("project-search").oninput = (e) => { state.projectQuery = e.target.value; renderHome(); };
  $("btn-cancel-project").onclick = () => $("modal-project").classList.add("hidden");
  $("btn-save-project").onclick = saveProject;
  $("btn-poster-pick").onclick = async () => {
    try {
      const r = await api.pickStagePoster();
      if (r.cancelled) return;
      state.pendingPosterKey = r.key; state.posterRemove = false;
      const src = await api.stagedPosterData(r.key);
      setPosterPreview(src);
      sndClick();
    } catch (e) { toast("Poster failed: " + e); }
  };
  $("btn-poster-remove").onclick = () => {
    state.pendingPosterKey = null; state.posterRemove = true;
    setPosterPreview(null);
    sndClick();
  };
}
