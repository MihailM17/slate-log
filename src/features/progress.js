// Slate Log — wrap progress board: per-day scene rows with tap-to-cycle
// status, plus the overall Complete/total fill.

import { state } from "../store.js";
import { esc, calcProgress } from "../utils.js";
import { $, toast, showView } from "../ui.js";
import { activeProject, renderScenes, renderHead, cycleStatus } from "./scenes.js";
import { loadTakes, resetTimerUI } from "./takes.js";
import { pushSceneToServer } from "./setMode.js";

export function openProgress() {
  if (!state.activeProjectId) { toast("Open a project first"); return; }
  renderProgress();
  showView("progress");
}

export function renderProgress() {
  const p = activeProject(); if (!p) return;
  $("progress-sub").textContent = `${p.film_name || "Untitled film"} - wrap progress`;
  const days = [...new Set(state.scenes.map((s) => s.day ?? 1))].sort((a, b) => a - b);
  const { done, total, pct, remaining } = calcProgress(state.scenes);
  const good = state.allTakes.filter((t) => t.rating === "Good").length;
  let html = `<div class="meta"><span>${done}/${total} scenes complete</span><span>${state.allTakes.length} takes · ${good} good</span></div><div class="prog-bar"><div class="prog-fill" id="prog-fill"></div></div><div class="prog-meta"><span>${pct}% wrapped</span><span>${remaining} remaining</span></div>`;
  days.forEach((d) => {
    html += `<div class="prog-day">Day ${d}</div>`;
    state.scenes
      .filter((s) => (s.day ?? 1) === d)
      .forEach((s) => {
        const takes = state.allTakes.filter((t) => t.scene_id === s.id);
        const g = takes.filter((t) => t.rating === "Good").length;
        const st = s.status || "Not shot";
        html += `<div class="prog-row" data-id="${s.id}"><span class="num">${esc(s.number)}</span><span class="tt">${esc(s.title) || "(untitled)"}</span><span class="meta">${takes.length} takes · ${g} good</span><button class="status-btn ${st.replace(" ", "")}" data-st="${s.id}" title="Tap to cycle status">${esc(st)}</button></div>`;
      });
  });
  if (!state.scenes.length) html += `<p class="empty-hint">No scenes yet.</p>`;
  $("progress-body").innerHTML = html;
  // Set the fill via the DOM (not string interpolation) so an invalid value
  // can never leave the fill at full width — it clamps to 0..100.
  const fill = $("prog-fill");
  if (fill) fill.style.width = `${pct}%`;
  document.querySelectorAll(".prog-row").forEach((r) => {
    r.onclick = async (e) => {
      const id = parseInt(r.dataset.id);
      const s = state.scenes.find((x) => x.id === id);
      if (!s) return;
      if (e.target.dataset.st) {
        e.stopPropagation();
        await cycleStatus(s);
        renderProgress();
        return;
      }
      resetTimerUI();
      state.activeId = id;
      await loadTakes();
      renderScenes(); renderHead(); pushSceneToServer();
      showView("app");
    };
  });
}

// Wire the progress open/back buttons. Called once at startup.
export function initProgress() {
  $("btn-progress").onclick = openProgress;
  $("btn-progress-back").onclick = () => showView("app");
}
