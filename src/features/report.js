// Slate Log — outputs: daily report (print/PDF view with contact sheet),
// Excel workbook, EDL selects, PDF daily log. No cross-feature calls.

import { S, state } from "../store.js";
import * as api from "../api.js";
import { esc, pad } from "../utils.js";
import { $, toast, sndClick, sndExport, showView } from "../ui.js";
import { active, activeProject, loadScenes } from "./scenes.js";

export function openReport() {
  if (!state.activeProjectId) { toast("Open a project first"); return; }
  $("report-day").value = active()?.day ?? activeProject()?.shoot_day ?? 1;
  renderReport();
  showView("report");
}

export async function renderReport() {
  const p = activeProject(); if (!p) return;
  const day = parseInt($("report-day").value) || 1;
  const takes = state.allTakes.filter((t) => (t.day ?? 1) === day);
  const scenes = state.scenes.filter((s) => (s.day ?? 1) === day);
  const good = takes.filter((t) => t.rating === "Good").length;
  const maybe = takes.filter((t) => t.rating === "Maybe").length;
  const bad = takes.filter((t) => t.rating === "Bad").length;
  const done = scenes.filter((s) => s.status === "Complete").length;
  const part = scenes.filter((s) => s.status === "Partial").length;
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const row = (t) => `<tr><td><b>${esc(t.scene_number)}</b>${t.setup_name ? " · " + esc(t.setup_name) : ""}</td><td>${pad(t.take_no)}</td><td>${esc(t.tc_in)}</td><td>${esc(t.cam)}</td><td>${esc(t.lens)}</td><td>${esc(t.cam_file)}</td><td>${esc(t.audio_file)}</td><td>${esc(t.rating)}</td><td>${esc(t.tags)}</td><td>${esc(t.note)}</td></tr>`;
  $("report-body").innerHTML = `
    <h1>${esc(p.film_name) || "Untitled film"} - Daily report</h1>
    <p class="rmeta">Day ${day} · ${esc(today)}${p.director ? " · Dir. " + esc(p.director) : ""}${p.location ? " · " + esc(p.location) : ""}</p>
    <div class="statgrid">
      <div><b>${takes.length}</b><span>takes</span></div>
      <div><b>${good}</b><span>good</span></div>
      <div><b>${maybe}</b><span>maybe</span></div>
      <div><b>${bad}</b><span>bad</span></div>
      <div><b>${done}/${scenes.length}</b><span>scenes complete${part ? ` (${part} partial)` : ""}</span></div>
    </div>
    <h2>Good selects</h2>
    ${good ? `<table><thead><tr><th>Scene</th><th>Take</th><th>TC</th><th>Cam</th><th>Lens</th><th>Camera file</th><th>Audio file</th><th>Notes</th></tr></thead><tbody>${takes.filter((t) => t.rating === "Good").map((t) => `<tr><td><b>${esc(t.scene_number)}</b>${t.setup_name ? " · " + esc(t.setup_name) : ""}</td><td>${pad(t.take_no)}</td><td>${esc(t.tc_in)}</td><td>${esc(t.cam)}</td><td>${esc(t.lens)}</td><td>${esc(t.cam_file)}</td><td>${esc(t.audio_file)}</td><td>${esc(t.note || t.tags)}</td></tr>`).join("")}</tbody></table>` : "<p>No good takes logged for this day yet.</p>"}
    <h2>All takes</h2>
    ${takes.length ? `<table><thead><tr><th>Scene</th><th>Take</th><th>TC</th><th>Cam</th><th>Lens</th><th>Camera file</th><th>Audio file</th><th>Rating</th><th>Notes</th><th>Description</th></tr></thead><tbody>${takes.map(row).join("")}</tbody></table>` : "<p>Nothing logged for this day yet.</p>"}
    <h2>Scenes</h2>
    ${scenes.length ? `<table><thead><tr><th>Scene</th><th>Title</th><th>Status</th><th>Takes</th></tr></thead><tbody>${scenes.map((s) => `<tr><td><b>${esc(s.number)}</b></td><td>${esc(s.title)}</td><td>${esc(s.status || "Not shot")}</td><td>${s.take_count ?? 0}</td></tr>`).join("")}</tbody></table>` : "<p>No scenes scheduled for this day.</p>"}
    <h2>Continuity stills</h2>
    <div id="report-stills"><p>Loading stills…</p></div>`;
  // Contact sheet loads after the text (photo reads are one invoke each).
  try {
    let sheet = "";
    for (const s of scenes) {
      let photos = [];
      try { photos = await api.listPhotos(s.id); } catch { continue; }
      if (!photos.length) continue;
      const thumbs = [];
      for (const ph of photos) {
        try { thumbs.push({ ph, src: await api.photoData(ph.id, true) }); }
        catch { /* skip unreadable */ }
      }
      if (!thumbs.length) continue;
      sheet += `<h3>Scene ${esc(s.number)}${s.title ? " · " + esc(s.title) : ""}</h3><div class="thumbs">${thumbs.map(({ ph, src }) => `<figure><img src="${src}" alt="Continuity still"><figcaption>${esc(ph.caption) || esc(ph.setup_name) || ""}</figcaption></figure>`).join("")}</div>`;
    }
    const el = $("report-stills");
    if (el) el.innerHTML = sheet || "<p>No stills for this day yet.</p>";
  } catch { /* report stands without stills */ }
}

export async function exportExcel(projectId) {
  projectId = projectId || state.activeProjectId;
  if (!projectId) return;
  try {
    const path = await api.exportExcel(projectId, S.exportGood, S.exportDays);
    sndExport();
    toast(`Exported → ${path}`);
  } catch (e) { toast("Export failed: " + e); }
}

// Wire the report + export buttons. Called once at startup.
export function initReport() {
  $("btn-report").onclick = openReport;
  $("btn-report-back").onclick = () => showView("app");
  $("report-day").onchange = renderReport;
  $("btn-print").onclick = () => window.print();
  $("btn-import").onclick = async () => {
    if (!state.activeProjectId) { toast("Open a project first"); return; }
    try {
      const r = await api.importScenesCsv(state.activeProjectId);
      if (r.cancelled) { toast("Import cancelled"); return; }
      sndClick();
      toast(`Imported ${r.imported} scenes${r.duplicates ? ` (${r.duplicates} duplicates skipped)` : ""}${r.skipped ? `, ${r.skipped} rows skipped` : ""}`);
      await loadScenes();
    } catch (e) { toast("Import failed: " + e); }
  };
  // (wrap-progress buttons are wired in progress.js initProgress)
  $("btn-edl").onclick = async () => {
    if (!state.activeProjectId) return;
    try {
      const r = await api.exportEdl(state.activeProjectId);
      sndExport();
      toast(`EDL: ${r.events} events${r.skipped ? ` (${r.skipped} bad TC skipped)` : ""} → ${r.path}`);
    } catch (e) { toast("EDL failed: " + e); }
  };
  $("btn-pdf").onclick = async () => {
    if (!state.activeProjectId) return;
    const day = parseInt($("report-day").value) || 1;
    try {
      const path = await api.exportPdf(state.activeProjectId, day);
      sndExport();
      toast(`PDF saved → ${path}`);
    } catch (e) { toast("PDF failed: " + e); }
  };
  $("btn-export").onclick = () => exportExcel();
}
