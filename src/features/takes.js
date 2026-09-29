// Slate Log — takes feature: log card, takes table, take/setup modals,
// camera & lens popups, stopwatch, quick-note chips.
//
// Cross-feature refreshes (scene list, scene header, stats, stills, full
// scene reload) arrive via initTakes deps so this module never reaches into
// another feature's code. app.js passes the real functions; tests pass spies.

import { S, state } from "../store.js";
import * as api from "../api.js";
import { esc, pad, fmtLens, validTC, bumpName, nowTC, fmtDur, rateDot, photoCountText, scenePayload } from "../utils.js";
import { $, toast, sndClick, sndLog, sndDelete, confirmAsync } from "../ui.js";

const activeScene = () => state.scenes.find((s) => s.id === state.activeId);

let takeCam = "A";
let timing = null, tickH = null;
let deps = {
  renderScenes() {},
  renderHead() {},
  refreshStats() {},
  loadPhotos() {},
  reloadScenes() {},
};

const LENS_PRESETS = ["24", "35", "50", "85"];

export async function loadTakes() {
  const sc = activeScene(); if (!sc) { state.takes = []; return; }
  resetTimerUI();
  state.lastDuration = 0;
  try {
    state.takes = await api.listTakes(sc.id);
    state.takeNo = await api.nextTake(sc.id);
    state.setups = await api.listSetups(sc.id);
  } catch { state.takes = []; state.takeNo = 1; }
  // defaults for this take follow the scene but stay editable per take
  state.takeIntExt = sc.int_ext || "INT";
  state.takeSetupId = null;
  takeCam = sc.camera_default || S.defaultCam || "A";
  syncTakeSeg(); syncCamBtn(); syncLensSeg(); renderSetupChips();
  if (S.manualTC) $("take-tc").value = nowTC();
  await deps.loadPhotos();
  // filenames continue from the last take of this scene (C0004 -> C0005)
  const last = [...state.takes].sort((a, b) => a.take_no - b.take_no).pop();
  $("take-camfile").value = S.autoBump && last?.cam_file ? bumpName(last.cam_file) : "";
  $("take-audiofile").value = S.autoBump && last?.audio_file ? bumpName(last.audio_file) : "";
}

export async function loadAllTakes() {
  if (!state.activeProjectId) { state.allTakes = []; state.photoCounts = {}; renderTakes(); return; }
  try { state.allTakes = await api.listProjectTakes(state.activeProjectId); }
  catch { state.allTakes = []; }
  try {
    const counts = await api.photoCounts(state.activeProjectId);
    state.photoCounts = {};
    (counts || []).forEach((c) => { state.photoCounts[c.scene_id] = c.count; });
  } catch { state.photoCounts = {}; }
  renderTakes();
  // Scene rows show 📷 counts too — refresh them once counts land.
  if ($("view-app") && !$("view-app").classList.contains("hidden")) deps.renderScenes();
}

function renderTakes() {
  const tb = $("takes-body"); tb.innerHTML = "";
  const rows = [...state.allTakes];
  $("takes-count").textContent = `${rows.length} takes`;
  rows.forEach((t) => {
    const tr = document.createElement("tr");
    const dot = rateDot(t.rating);
    const photoN = state.photoCounts[t.scene_id] || 0;
    const photoCell = photoN ? `<span title="${photoN} still(s) on this scene">${photoCountText(photoN)}</span>` : `<span class="dim">${photoCountText(0)}</span>`;
    tr.innerHTML = `<td><b>${esc(t.scene_number)}</b> <span class="dim">${esc(t.scene_title) || ""}</span></td><td>${esc(t.setup_name) || ""}</td><td>${t.day ?? ""}</td><td>${pad(t.take_no)}</td><td>${esc(t.tc_in)}${t.duration_sec > 0 ? `<br><span class="dim">${Math.round(t.duration_sec * 10) / 10}s</span>` : ""}</td><td>${esc(t.cam)}</td><td>${esc(t.int_ext)}</td><td>${esc(t.lens)}</td><td class="mono">${esc(t.cam_file) || ""}</td><td class="mono">${esc(t.audio_file) || ""}</td>
      <td><span class="pill ${t.rating}">${dot} ${esc(t.rating)}</span></td><td>${esc(t.tags) || ""}</td><td>${esc(t.note) || ""}</td>
      <td>${photoCell}</td>
      <td class="rowbtns"><button class="mini-btn" data-act="edit" title="Edit take">✎</button><button class="del" title="Delete take">×</button></td>`;
    tr.querySelector('[data-act="edit"]').onclick = () => openEditTake(t);
    tr.querySelector(".del").onclick = async () => {
      if (!(await confirmAsync(`Delete take ${pad(t.take_no)} of scene ${t.scene_number}?`))) return;
      try { await api.deleteTake(t.id); } catch (e) { toast("Delete failed: " + e); return; }
      sndDelete();
      if (t.scene_id === state.activeId) await loadTakes();
      await loadAllTakes(); deps.renderScenes(); deps.renderHead(); deps.refreshStats();
    };
    tb.appendChild(tr);
  });
}

function openEditTake(t) {
  state.editingTakeId = t.id;
  $("take-modal-title").textContent = `Scene ${t.scene_number} · Take ${pad(t.take_no)}`;
  $("e-tc").value = t.tc_in; $("e-rating").value = t.rating;
  $("e-cam").value = t.cam; $("e-lens").value = t.lens;
  $("e-intext").value = t.int_ext || "INT"; $("e-day").value = t.day ?? 1;
  $("e-camfile").value = t.cam_file || ""; $("e-audiofile").value = t.audio_file || "";
  $("e-dur").value = t.duration_sec ? String(Math.round(t.duration_sec * 10) / 10) : "";
  $("e-tags").value = t.tags || ""; $("e-note").value = t.note || "";
  const sel = $("e-setup"); sel.innerHTML = "";
  const none = document.createElement("option");
  none.value = ""; none.textContent = "- Whole scene -";
  sel.appendChild(none);
  state.setups
    .filter((u) => u.scene_id === t.scene_id)
    .forEach((u) => {
      const o = document.createElement("option");
      o.value = u.id; o.textContent = u.name;
      if (t.setup_id === u.id) o.selected = true;
      sel.appendChild(o);
    });
  // setups may have changed since the scene was opened - refresh quietly
  api.listSetups(t.scene_id).then((fresh) => {
    if (!Array.isArray(fresh)) return;
    state.setups = state.setups.filter((u) => u.scene_id !== t.scene_id).concat(fresh);
    const cur = sel.value;
    sel.innerHTML = "";
    const n0 = document.createElement("option");
    n0.value = ""; n0.textContent = "- Whole scene -";
    sel.appendChild(n0);
    fresh.forEach((u) => {
      const o = document.createElement("option");
      o.value = u.id; o.textContent = u.name;
      sel.appendChild(o);
    });
    sel.value = cur || (t.setup_id != null ? String(t.setup_id) : "");
  }).catch(() => {});
  sel.value = t.setup_id != null ? String(t.setup_id) : "";
  $("modal-take").classList.remove("hidden");
}

export async function saveEditTake() {
  if (!state.editingTakeId) return;
  const editedSceneId = state.allTakes.find((t) => t.id === state.editingTakeId)?.scene_id;
  if (!liveTC($("e-tc"))) { toast("Timecode must look like HH:MM:SS"); $("e-tc").focus(); return; }
  const payload = {
    tc_in: $("e-tc").value.trim(), cam: $("e-cam").value.trim(),
    lens: $("e-lens").value.trim(), rating: $("e-rating").value,
    int_ext: $("e-intext").value, day: parseInt($("e-day").value) || 1,
    duration_sec: Math.max(0, parseFloat($("e-dur").value) || 0),
    setup_id: $("e-setup").value === "" ? null : parseInt($("e-setup").value),
    cam_file: $("e-camfile").value.trim(), audio_file: $("e-audiofile").value.trim(),
    tags: $("e-tags").value.trim(), note: $("e-note").value,
  };
  try { await api.updateTake(state.editingTakeId, payload); }
  catch (e) { toast("Save failed: " + e); return; }
  $("modal-take").classList.add("hidden");
  sndClick();
  if (editedSceneId === state.activeId) await loadTakes();
  await loadAllTakes(); deps.renderScenes(); deps.renderHead(); deps.refreshStats();
  toast("Take updated");
}

function renderSetupChips() {
  const c = $("setup-chips"); c.innerHTML = "";
  const mk = (id, label, count, on, title) => {
    const s = document.createElement("span");
    s.className = "setup-pick" + (on ? " on" : "");
    const b = document.createElement("button");
    b.style.cssText = "background:none;border:none;color:inherit;font:inherit;cursor:pointer;padding:0";
    b.textContent = count != null ? `${label} · ${count}` : label;
    b.title = title || label;
    b.onclick = () => { state.takeSetupId = id; renderSetupChips(); sndClick(); };
    s.appendChild(b);
    return s;
  };
  c.appendChild(mk(null, "Whole scene", null, state.takeSetupId == null, "No specific setup"));
  state.setups.forEach((u) => {
    const s = mk(u.id, u.name, u.take_count, state.takeSetupId === u.id, `${u.name} - click × to delete setup`);
    const x = document.createElement("button");
    x.className = "x"; x.textContent = "×"; x.title = `Delete setup “${u.name}” (takes stay)`;
    x.onclick = async (e) => {
      e.stopPropagation();
      if (!(await confirmAsync(`Delete setup “${u.name}”? Takes stay, they just lose the tag.`))) return;
      try { await api.deleteSetup(u.id); } catch (err) { toast("Delete failed: " + err); return; }
      sndDelete();
      if (state.takeSetupId === u.id) state.takeSetupId = null;
      await loadTakes(); renderSetupChips(); await loadAllTakes(); deps.renderScenes();
    };
    s.appendChild(x);
    c.appendChild(s);
  });
}

export async function saveSetup() {
  const sc = activeScene(); if (!sc) return;
  const name = $("setup-input").value.trim();
  if (!name) { toast("Give the setup a name"); return; }
  let created;
  try {
    created = await api.createSetup(sc.id, name);
  } catch (e) { toast("Save failed: " + e); return; }
  $("setup-input").value = "";
  $("modal-setup").classList.add("hidden");
  sndClick();
  await loadTakes();
  // loadTakes clears the setup pick — re-select the one just created.
  state.takeSetupId = created.id;
  renderSetupChips();
}

export function renderChips() {
  const c = $("chips"); c.innerHTML = "";
  S.quickNotes.forEach((q) => {
    const b = document.createElement("button");
    b.textContent = q; if (state.tags.has(q)) b.classList.add("on");
    b.onclick = () => { state.tags.has(q) ? state.tags.delete(q) : state.tags.add(q); renderChips(); sndClick(); };
    c.appendChild(b);
  });
}

function seg(id, fn) {
  $(id).querySelectorAll("button").forEach((b) => {
    b.onclick = () => { $(id).querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); fn(b.dataset.v); sndClick(); };
  });
}

function syncTakeSeg() {
  document.querySelectorAll("#seg-take-intext button").forEach((b) =>
    b.classList.toggle("on", b.dataset.v === state.takeIntExt));
}

export function syncLensSeg() {
  const custom = !LENS_PRESETS.includes(state.lens);
  document.querySelectorAll("#seg-lens button").forEach((b) => {
    if (b.dataset.v === "__custom") {
      b.classList.toggle("on", custom);
      b.textContent = custom ? state.lens : "+";
      b.title = custom ? `Custom lens ${state.lens} - click to change` : "Custom lens";
    } else {
      b.classList.toggle("on", b.dataset.v === state.lens);
    }
  });
}

const liveTC = (el) => {
  const bad = el.value.trim() !== "" && !validTC(el.value);
  el.classList.toggle("invalid", bad);
  return !bad;
};

function syncCamBtn() {
  const b = $("btn-cam");
  if (b) b.textContent = `${takeCam} ✎`;
}

// camera popup (rare change - kept out of the way on purpose)
function openCamPopup() {
  $("cam-input").value = takeCam;
  $("modal-cam").classList.remove("hidden");
  setTimeout(() => $("cam-input").focus(), 50);
}

const saveCam = () => {
  const v = $("cam-input").value.trim();
  if (v) takeCam = v;
  syncCamBtn();
  $("modal-cam").classList.add("hidden");
  sndClick();
};

export async function replaceCamAll() {
  const v = $("cam-input").value.trim();
  if (!v) { toast("Enter a camera first"); return; }
  if (!state.activeProjectId) return;
  if (!(await confirmAsync(`Replace camera on all ${state.scenes.length} scenes with “${v}”?`, "Replace all", false))) return;
  try {
    const r = await api.setAllSceneCameras(state.activeProjectId, v);
    takeCam = v; syncCamBtn();
    $("modal-cam").classList.add("hidden");
    sndClick();
    toast(`Camera replaced on ${r.updated ?? state.scenes.length} scenes`);
    await deps.reloadScenes();
  } catch (e) { toast("Replace failed: " + e); }
}

// Take INT/EXT also persists to the scene so the header ("INT. TITLE - DAY")
// updates instantly and stays in sync with what you log.
async function persistTakeIntExt(v) {
  const sc = activeScene();
  if (!sc || sc.int_ext === v) return;
  const payload = scenePayload(sc, { int_ext: v });
  try { await api.updateScene(sc.id, payload); }
  catch (e) { toast("INT/EXT save failed: " + e); return; }
  sc.int_ext = v;
  deps.renderScenes(); deps.renderHead();
}

export async function logTake() {
  const sc = activeScene(); if (!sc) { toast("Create a scene first"); return; }
  const tc = S.manualTC ? $("take-tc").value.trim() : nowTC();
  if (S.manualTC && !liveTC($("take-tc"))) { toast("Timecode must look like HH:MM:SS"); $("take-tc").focus(); return; }
  const dur = timing ? (performance.now() - timing) / 1000 : (state.lastDuration || 0);
  const payload = {
    scene_id: sc.id,
    tc_in: tc,
    cam: takeCam || sc.camera_default || "A",
    lens: fmtLens(state.lens || "35"), rating: state.rating,
    int_ext: state.takeIntExt || sc.int_ext || "INT",
    day: sc.day ?? 1,
    duration_sec: Math.round(dur * 10) / 10,
    setup_id: state.takeSetupId,
    cam_file: $("take-camfile").value.trim(), audio_file: $("take-audiofile").value.trim(),
    tags: [...state.tags].join(", "), note: $("note").value || [...state.tags].join(", "),
  };
  try {
    const saved = await api.logTake(payload);
    state.takes.push(saved); state.takeNo = saved.take_no + 1;
  } catch (e) { toast("Log failed: " + e); return; }
  $("take-no").textContent = pad(state.takeNo);
  $("note").value = "";
  $("take-camfile").value = S.autoBump ? bumpName(payload.cam_file) : "";
  $("take-audiofile").value = S.autoBump ? bumpName(payload.audio_file) : "";
  if (S.manualTC) $("take-tc").value = nowTC();
  resetTimerUI();
  state.lastDuration = 0;
  sndLog(payload.rating);
  await loadAllTakes(); deps.renderScenes(); deps.renderHead(); deps.refreshStats();
  toast(`Take ${pad(state.takeNo - 1)} · ${payload.rating} logged`);
}

export function resetTimerUI() {
  timing = null;
  clearInterval(tickH);
  const b = $("btn-timer"), t = $("take-timer"), l = $("btn-log");
  if (b) b.textContent = "⏱ Start timer";
  if (t) t.textContent = "00:00";
  if (l) l.textContent = "Log take";
}

export function toggleTimer() {
  if (timing) {
    const s = (performance.now() - timing) / 1000;
    resetTimerUI();
    $("take-timer").textContent = fmtDur(s);
    toast(`Timed ${s.toFixed(1)}s - will attach to the next logged take`);
    state.lastDuration = s;
    return;
  }
  timing = performance.now();
  state.lastDuration = 0;
  $("btn-timer").textContent = "◼ Stop";
  $("btn-log").textContent = "◼ Cut & Log";
  tickH = setInterval(() => { $("take-timer").textContent = fmtDur((performance.now() - timing) / 1000); }, 250);
  sndClick();
}

// Wire the static log-card controls. Called once at startup.
export function initTakes(d) {
  deps = { ...deps, ...d };
  $("btn-add-setup").onclick = () => {
    if (!activeScene()) { toast("Select a scene first"); return; }
    $("setup-input").value = "";
    $("modal-setup").classList.remove("hidden");
    setTimeout(() => $("setup-input").focus(), 50);
  };
  $("btn-save-setup").onclick = saveSetup;
  $("btn-cancel-setup").onclick = () => $("modal-setup").classList.add("hidden");
  $("btn-save-cam").onclick = saveCam;
  $("btn-replace-cam-all").onclick = replaceCamAll;
  $("btn-cam").onclick = openCamPopup;
  $("btn-cancel-cam").onclick = () => $("modal-cam").classList.add("hidden");
  seg("seg-rating", (v) => (state.rating = v));
  seg("seg-take-intext", (v) => { state.takeIntExt = v; persistTakeIntExt(v); });
  // lens presets + custom popup (presets untouched)
  document.querySelectorAll("#seg-lens button").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.v === "__custom") {
        $("lens-input").value = LENS_PRESETS.includes(state.lens) ? "" : state.lens;
        $("modal-lens").classList.remove("hidden");
        setTimeout(() => $("lens-input").focus(), 50);
        return;
      }
      state.lens = b.dataset.v; syncLensSeg(); sndClick();
    };
  });
  const saveLens = () => {
    const v = $("lens-input").value.trim();
    if (v) state.lens = v;
    syncLensSeg();
    $("modal-lens").classList.add("hidden");
    sndClick();
  };
  $("btn-save-lens").onclick = saveLens;
  $("btn-cancel-lens").onclick = () => { $("modal-lens").classList.add("hidden"); syncLensSeg(); };
  $("btn-log").onclick = logTake;
  $("btn-timer").onclick = toggleTimer;
  $("btn-cancel-take").onclick = () => $("modal-take").classList.add("hidden");
  $("btn-save-take").onclick = saveEditTake;
  $("take-tc").oninput = (e) => liveTC(e.target);
  $("e-tc").oninput = (e) => liveTC(e.target);
}
