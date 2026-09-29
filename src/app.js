// Slate Log - projects + scenes + takes. Empty start, no seed data.
const invoke = async (cmd, args = {}) => {
  if (window.__TAURI__?.core?.invoke) return window.__TAURI__.core.invoke(cmd, args);
  throw new Error("no-tauri");
};

const DEFAULT_QUICK = ["Clean take", "Boom in frame", "Focus soft", "Camera noise", "Actor flub", "Continuity break"];
const DEFAULT_SHORTCUTS = { logTake: "Space", rateGood: "KeyG", rateMaybe: "KeyM", rateBad: "KeyB", nextScene: "ArrowDown", prevScene: "ArrowUp", newScene: "KeyN" };
const SHORTCUT_DEFS = [
  { key: "logTake", label: "Log take" },
  { key: "rateGood", label: "Rate Good" },
  { key: "rateMaybe", label: "Rate Maybe" },
  { key: "rateBad", label: "Rate Bad" },
  { key: "nextScene", label: "Next scene" },
  { key: "prevScene", label: "Previous scene" },
  { key: "newScene", label: "New scene" },
];
const keyName = (code) => {
  const m = { Space: "Space", Escape: "Esc", Enter: "Enter", ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→", Tab: "Tab" };
  if (m[code]) return m[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
};
const DEFAULT_SETTINGS = {
  sounds: true, confirmDelete: true, manualTC: false,
  defaultRating: "Good", defaultLens: "35", defaultIntExt: "INT", defaultCam: "",
  quickNotes: [...DEFAULT_QUICK], exportGood: true, exportDays: true,
  autoBump: true, setPort: 17831, checkStartup: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
};
function loadSettings() {
  let s;
  try {
    const raw = JSON.parse(localStorage.getItem("slate-settings") || "null");
    s = raw && typeof raw === "object" ? { ...DEFAULT_SETTINGS, ...raw } : { ...DEFAULT_SETTINGS };
  } catch { /* fall through to legacy keys */ s = { ...DEFAULT_SETTINGS }; }
  if (localStorage.getItem("slate-sound") === "off") s.sounds = false;
  if (localStorage.getItem("slate-confirm") === "off") s.confirmDelete = false;
  s.shortcuts = { ...DEFAULT_SHORTCUTS, ...(s.shortcuts || {}) };
  return s;
}
const S = loadSettings();
function saveSettings() {
  try { localStorage.setItem("slate-settings", JSON.stringify(S)); } catch { /* ignore */ }
}
const state = {
  projects: [], activeProjectId: null,
  scenes: [], takes: [], allTakes: [], setups: [], photos: [], activeId: null,
  rating: S.defaultRating, lens: S.defaultLens, takeIntExt: S.defaultIntExt, tags: new Set(),
  takeNo: 1, takeSetupId: null, lastDuration: 0, filter: "", projectQuery: "", editingSceneId: null, editingProjectId: null, editingTakeId: null, lightboxId: null,
};
let takeCam = "A";
let timing = null, tickH = null;

// In-app confirm (reliable inside the Tauri webview, unlike native dialogs).
function confirmAsync(msg, okLabel = "Delete") {
  return new Promise((resolve) => {
    if (!S.confirmDelete) { resolve(true); return; }
    $("confirm-msg").textContent = msg;
    $("btn-confirm-ok").textContent = okLabel;
    $("modal-confirm").classList.remove("hidden");
    const done = (v) => {
      $("modal-confirm").classList.add("hidden");
      $("btn-confirm-ok").onclick = $("btn-confirm-cancel").onclick = null;
      resolve(v);
    };
    $("btn-confirm-ok").onclick = () => done(true);
    $("btn-confirm-cancel").onclick = () => done(false);
  });
}

const $ = (id) => document.getElementById(id);
// Escape all user data before innerHTML - the DB can hold arbitrary strings.
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const CAM_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
const nowTC = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const activeProject = () => state.projects.find((p) => p.id === state.activeProjectId);
const active = () => state.scenes.find((s) => s.id === state.activeId);

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 2600);
}

// ---------- sounds (tiny WebAudio synth, no assets, works offline) ----------
let actx = null;
function ac() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (actx && actx.state === "suspended") actx.resume();
  return actx;
}
function tone(freq, dur = 0.09, type = "sine", vol = 0.12, delay = 0) {
  if (!S.sounds) return;
  const ctx = ac(); if (!ctx) return;
  try {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch { /* audio unavailable */ }
}
const sndClick = () => tone(620, 0.04, "sine", 0.06);
const sndLog = (r) => {
  if (r === "Good") { tone(660, 0.09); tone(880, 0.12, "sine", 0.12, 0.08); }
  else if (r === "Maybe") tone(440, 0.1);
  else tone(170, 0.16, "square", 0.07);
};
const sndDelete = () => tone(220, 0.12, "sawtooth", 0.06);
const sndExport = () => { tone(523, 0.09); tone(659, 0.09, "sine", 0.12, 0.08); tone(784, 0.14, "sine", 0.12, 0.16); };

// ---------- projects (DaVinci-style home screen) ----------
async function loadProjects() {
  try { state.projects = await invoke("list_projects"); }
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
    d.innerHTML = `<h3>${esc(p.film_name) || "Untitled film"}</h3>
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
    d.onclick = async (e) => {
      const act = e.target.dataset?.act || "open";
      if (act === "open") { await openProject(p.id); return; }
      e.stopPropagation();
      if (act === "edit") openEditProject(p);
      else if (act === "dup") await duplicateProject(p);
      else if (act === "exp") await exportExcel(p.id);
      else if (act === "del") await deleteProject(p);
    };
    grid.appendChild(d);
  });
}

function showView(name) {
  for (const v of ["home", "app", "report", "progress", "script"]) {
    $(`view-${v}`).classList.toggle("hidden", name !== v);
  }
}

async function openProject(id) {
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

// ---------- daily report (print / save as PDF) ----------
function openReport() {
  if (!state.activeProjectId) { toast("Open a project first"); return; }
  $("report-day").value = active()?.day ?? activeProject()?.shoot_day ?? 1;
  renderReport();
  showView("report");
}

async function renderReport() {
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
      try { photos = await invoke("list_photos", { sceneId: s.id }); } catch { continue; }
      if (!photos.length) continue;
      const thumbs = [];
      for (const ph of photos) {
        try { thumbs.push({ ph, src: await invoke("photo_data", { id: ph.id, thumb: true }) }); }
        catch { /* skip unreadable */ }
      }
      if (!thumbs.length) continue;
      sheet += `<h3>Scene ${esc(s.number)}${s.title ? " · " + esc(s.title) : ""}</h3><div class="thumbs">${thumbs.map(({ ph, src }) => `<figure><img src="${src}" alt="Continuity still"><figcaption>${esc(ph.caption) || esc(ph.setup_name) || ""}</figcaption></figure>`).join("")}</div>`;
    }
    const el = $("report-stills");
    if (el) el.innerHTML = sheet || "<p>No stills for this day yet.</p>";
  } catch { /* report stands without stills */ }
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

async function stepDay(delta) {
  const sc = active();
  if (sc) {
    // Day lives on the scene - the stepper is a quick way to set it.
    const day = Math.max(1, (sc.day || 1) + delta);
    const payload = { number: sc.number, title: sc.title, int_ext: sc.int_ext, daypart: sc.daypart, description: sc.description, camera_default: sc.camera_default, day, location: sc.location || "", status: sc.status || "Not shot" };
    try { await invoke("update_scene", { id: sc.id, scene: payload }); } catch (e) { toast("Day change failed: " + e); return; }
    sc.day = day;
    sndClick();
    renderScenes(); renderHead(); refreshStats();
    return;
  }
  const p = activeProject(); if (!p) return;
  const day = Math.max(1, (p.shoot_day || 1) + delta);
  try { await invoke("set_project_day", { id: p.id, day }); } catch (e) { toast("Day change failed: " + e); return; }
  p.shoot_day = day;
  sndClick();
  renderProjectHeader(); renderHead();
}

function syncCamBtn() {
  const b = $("btn-cam");
  if (b) b.textContent = `${takeCam} ✎`;
}

function openNewProject() {
  state.editingProjectId = null;
  $("project-modal-title").textContent = "New project";
  ["p-film","p-director","p-cameraop","p-location","p-unit"].forEach((id) => $(id).value = "");
  $("p-fps").value = "25";
  $("modal-project").classList.remove("hidden");
}

function openEditProject(p) {
  p = p || activeProject();
  if (!p) { toast("Create a project first"); return; }
  state.editingProjectId = p.id;
  $("project-modal-title").textContent = "Edit project";
  $("p-film").value = p.film_name; $("p-director").value = p.director; $("p-cameraop").value = p.camera_op;
  $("p-location").value = p.location; $("p-unit").value = p.unit;
  $("p-fps").value = String(p.fps ?? 25);
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
  };
  try {
    if (state.editingProjectId) {
      await invoke("update_project", { id: state.editingProjectId, project: p });
      state.activeProjectId = state.editingProjectId;
    } else {
      const created = await invoke("create_project", { project: p });
      state.activeProjectId = created.id;
    }
  } catch (e) { toast("Save failed: " + e); return; }
  $("modal-project").classList.add("hidden");
  await loadProjects();
}

async function deleteProject(p) {
  p = p || activeProject();
  if (!p) return;
  if (!(await confirmAsync(`Delete project “${p.film_name}” + all ${p.scene_count} scenes and ${p.take_count} takes?`))) return;
  try { await invoke("delete_project", { id: p.id }); } catch (e) { toast("Delete failed: " + e); return; }
  sndDelete();
  if (state.activeProjectId === p.id) { state.activeProjectId = null; state.activeId = null; }
  await loadProjects();
}

async function duplicateProject(p) {
  try {
    const copy = await invoke("duplicate_project", { id: p.id });
    sndClick();
    toast(`Duplicated as “${copy.film_name}”`);
  } catch (e) { toast("Duplicate failed: " + e); return; }
  await loadProjects();
}

// ---------- scenes + takes ----------
async function loadScenes() {
  const pid = state.activeProjectId; if (!pid) return;
  try { state.scenes = await invoke("list_scenes", { projectId: pid }); }
  catch { state.scenes = []; }
  if (!state.scenes.find((s) => s.id === state.activeId)) state.activeId = state.scenes[0]?.id ?? null;
  renderProjectHeader(); renderScenes();
  if (state.activeId) await loadTakes(); else { state.takes = []; state.takeNo = 1; renderHead(); }
  await loadAllTakes();
  refreshStats();
}

async function loadAllTakes() {
  if (!state.activeProjectId) { state.allTakes = []; renderTakes(); return; }
  try { state.allTakes = await invoke("list_project_takes", { projectId: state.activeProjectId }); }
  catch { state.allTakes = []; }
  renderTakes();
}

async function loadTakes() {
  const sc = active(); if (!sc) { state.takes = []; return; }
  resetTimerUI();
  state.lastDuration = 0;
  try {
    state.takes = await invoke("list_takes", { sceneId: sc.id });
    state.takeNo = await invoke("next_take", { sceneId: sc.id });
    state.setups = await invoke("list_setups", { sceneId: sc.id });
  } catch { state.takes = []; state.takeNo = 1; }
  // defaults for this take follow the scene but stay editable per take
  state.takeIntExt = sc.int_ext || "INT";
  state.takeSetupId = null;
  takeCam = sc.camera_default || S.defaultCam || "A";
  syncTakeSeg(); syncCamBtn(); syncLensSeg(); renderSetupChips();
  if (S.manualTC) $("take-tc").value = nowTC();
  await loadPhotos();
  // filenames continue from the last take of this scene (C0004 -> C0005)
  const last = [...state.takes].sort((a, b) => a.take_no - b.take_no).pop();
  $("take-camfile").value = S.autoBump && last?.cam_file ? bumpName(last.cam_file) : "";
  $("take-audiofile").value = S.autoBump && last?.audio_file ? bumpName(last.audio_file) : "";
}

async function refreshStats() {
  if (!state.activeProjectId) return;
  try {
    const s = await invoke("get_stats", { projectId: state.activeProjectId });
    $("stat-total").textContent = `${s.total} takes logged`;
    $("stat-rate").textContent = `${s.good_rate ?? s.print_rate ?? 0}% good`;
  } catch { /* ignore */ }
}

function renderScenes() {
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
    d.innerHTML = `<span class="num">${esc(s.number)}</span><div><div class="t">${esc(s.title) || "(untitled)"}</div><div class="m"><span class="badge">${esc(s.int_ext)}</span><span>${esc(s.daypart)} · Day ${s.day ?? 1} · ${s.take_count ?? 0} takes${s.location ? " · " + esc(s.location) : ""}${s.status && s.status !== "Not shot" ? " · " + esc(s.status) : ""}</span></div></div>
      <div class="row-actions"><button class="mini-btn" data-act="edit" title="Edit scene">✎</button><button class="mini-btn danger" data-act="del" title="Delete scene + its takes">×</button></div>`;
    d.onclick = async (e) => {
      const act = e.target.dataset?.act;
      if (act === "del") { e.stopPropagation(); await deleteScene(s); return; }
      if (act === "edit") { e.stopPropagation(); openEditScene(s); return; }
      state.activeId = s.id; await loadTakes(); renderScenes(); renderHead(); pushSceneToServer();
    };
    list.appendChild(d);
  });
}

async function deleteScene(s) {
  if (!(await confirmAsync(`Delete scene ${s.number} “${s.title}” + its ${s.take_count ?? 0} takes?`))) return;
  try { await invoke("delete_scene", { id: s.id }); } catch (e) { toast("Delete failed: " + e); return; }
  sndDelete();
  if (state.activeId === s.id) state.activeId = null;
  await loadScenes();
}

function openNewScene() {
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

function renderHead() {
  const s = active();
  if (!s) { $("scene-head").innerHTML = `<p class="empty-hint">Select or create a scene to start logging.</p>`; return; }
  const p = activeProject();
  $("scene-head").innerHTML = `<h2><span class="n">${esc(s.number)}</span>${esc(s.int_ext)}. ${esc(s.title || "").toUpperCase()} - ${esc(s.daypart).toUpperCase()}<button class="scene-edit-btn" id="btn-edit-scene">✎ Edit</button><button class="status-btn ${esc(s.status || "Not shot").replace(" ", "")}" id="btn-status" title="Tap to cycle shoot status">${esc(s.status || "Not shot")}</button></h2>
    <div class="meta"><span>Day ${s.day ?? "–"}</span>${s.location ? `<span>${esc(s.location)}</span>` : ""}<span>${state.takes.length} takes logged</span><span>Camera ${esc(s.camera_default) || "-"}</span></div>
    <p class="desc">${esc(s.description) || ""}</p>`;
  $("take-no").textContent = pad(state.takeNo);
  $("btn-edit-scene").onclick = () => openEditScene(s);
  $("btn-status").onclick = () => cycleStatus(s);
  renderProjectHeader();
}

const nextStatus = (s) => (s === "Not shot" ? "Partial" : s === "Partial" ? "Complete" : "Not shot");

async function cycleStatus(s) {
  const payload = {
    number: s.number, title: s.title, int_ext: s.int_ext, daypart: s.daypart,
    day: s.day ?? 1, location: s.location || "", status: nextStatus(s.status || "Not shot"),
    description: s.description, camera_default: s.camera_default,
  };
  try { await invoke("update_scene", { id: s.id, scene: payload }); }
  catch (e) { toast("Save failed: " + e); return; }
  s.status = payload.status;
  sndClick();
  renderScenes(); renderHead();
}

function renderTakes() {
  const tb = $("takes-body"); tb.innerHTML = "";
  const rows = [...state.allTakes];
  $("takes-count").textContent = `${rows.length} takes`;
  rows.forEach((t) => {
    const tr = document.createElement("tr");
    const dot = t.rating === "Good" ? "●" : t.rating === "Maybe" ? "◐" : "○";
    tr.innerHTML = `<td><b>${esc(t.scene_number)}</b> <span class="dim">${esc(t.scene_title) || ""}</span></td><td>${esc(t.setup_name) || ""}</td><td>${t.day ?? ""}</td><td>${pad(t.take_no)}</td><td>${esc(t.tc_in)}${t.duration_sec > 0 ? `<br><span class="dim">${Math.round(t.duration_sec * 10) / 10}s</span>` : ""}</td><td>${esc(t.cam)}</td><td>${esc(t.int_ext)}</td><td>${esc(t.lens)}</td><td class="mono">${esc(t.cam_file) || ""}</td><td class="mono">${esc(t.audio_file) || ""}</td>
      <td><span class="pill ${t.rating}">${dot} ${esc(t.rating)}</span></td><td>${esc(t.tags) || ""}</td><td>${esc(t.note) || ""}</td>
      <td class="rowbtns"><button class="mini-btn" data-act="edit" title="Edit take">✎</button><button class="del" title="Delete take">×</button></td>`;
    tr.querySelector('[data-act="edit"]').onclick = () => openEditTake(t);
    tr.querySelector(".del").onclick = async () => {
      if (!(await confirmAsync(`Delete take ${pad(t.take_no)} of scene ${t.scene_number}?`))) return;
      try { await invoke("delete_take", { takeId: t.id }); } catch (e) { toast("Delete failed: " + e); return; }
      sndDelete();
      if (t.scene_id === state.activeId) await loadTakes();
      await loadAllTakes(); renderScenes(); renderHead(); refreshStats();
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
  invoke("list_setups", { sceneId: t.scene_id }).then((fresh) => {
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

async function saveEditTake() {
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
  try { await invoke("update_take", { id: state.editingTakeId, take: payload }); }
  catch (e) { toast("Save failed: " + e); return; }
  $("modal-take").classList.add("hidden");
  sndClick();
  if (editedSceneId === state.activeId) await loadTakes();
  await loadAllTakes(); renderScenes(); renderHead(); refreshStats();
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
      try { await invoke("delete_setup", { id: u.id }); } catch (err) { toast("Delete failed: " + err); return; }
      sndDelete();
      if (state.takeSetupId === u.id) state.takeSetupId = null;
      await loadTakes(); renderSetupChips(); await loadAllTakes(); renderScenes();
    };
    s.appendChild(x);
    c.appendChild(s);
  });
}

async function saveSetup() {
  const sc = active(); if (!sc) return;
  const name = $("setup-input").value.trim();
  if (!name) { toast("Give the setup a name"); return; }
  try {
    const created = await invoke("create_setup", { sceneId: sc.id, name });
    state.takeSetupId = created.id;
  } catch (e) { toast("Save failed: " + e); return; }
  $("setup-input").value = "";
  $("modal-setup").classList.add("hidden");
  sndClick();
  await loadTakes(); renderSetupChips();
}

// ---------- continuity stills ----------
async function loadPhotos() {
  const sc = active();
  if (!sc) { state.photos = []; renderPhotos(); return; }
  try { state.photos = await invoke("list_photos", { sceneId: sc.id }); }
  catch { state.photos = []; }
  renderPhotos();
}

function renderPhotos() {
  const w = $("photos");
  const sc = active();
  if (!sc) { w.innerHTML = ""; return; }
  w.innerHTML = `<div class="photos-head"><strong>Continuity stills</strong><span>${state.photos.length}</span><button id="btn-add-photo" class="addphoto" title="Import a still into this scene">+ Add photo</button><span class="camwrap"><button id="btn-set" class="btn ghost iconbtn" title="Set mode: phones on this WiFi push stills + takes live">${CAM_SVG} Set</button></span></div><div class="photo-grid" id="photo-grid"></div>`;
  $("btn-add-photo").onclick = addPhoto;
  $("btn-set").onclick = openSetMode;
  const g = $("photo-grid");
  state.photos.forEach((p) => {
    const cell = document.createElement("div");
    cell.className = "photo-cell";
    cell.title = "Open still";
    cell.innerHTML = `<img alt="Continuity still"><button class="px" title="Delete this still">×</button><div class="cap">${esc(p.caption) || esc(p.setup_name) || "-"}</div>`;
    cell.querySelector("img").onclick = () => openLightbox(p.id);
    cell.querySelector(".px").onclick = async (e) => {
      e.stopPropagation();
      if (!(await confirmAsync("Delete this still?"))) return;
      try { await invoke("delete_photo", { id: p.id }); } catch (err) { toast("Delete failed: " + err); return; }
      sndDelete();
      if (state.lightboxId === p.id) { state.lightboxId = null; $("modal-lightbox").classList.add("hidden"); }
      await loadPhotos();
    };
    invoke("photo_data", { id: p.id, thumb: true })
      .then((src) => { const im = cell.querySelector("img"); if (im) im.src = src; })
      .catch(() => {});
    g.appendChild(cell);
  });
}

async function addPhoto() {
  const sc = active(); if (!sc) return;
  try {
    await invoke("add_photo", { sceneId: sc.id, setupId: state.takeSetupId });
    sndClick(); toast("Photo added");
    await loadPhotos();
  } catch (e) {
    if (!String(e).includes("cancelled")) toast("Photo failed: " + e);
  }
}

async function openLightbox(id) {
  state.lightboxId = id;
  const p = state.photos.find((x) => x.id === id);
  $("lightbox-cap").value = p?.caption || "";
  $("lightbox-img").removeAttribute("src");
  $("modal-lightbox").classList.remove("hidden");
  try { $("lightbox-img").src = await invoke("photo_data", { id, thumb: false }); }
  catch (e) { toast("Could not load photo: " + e); }
}

// ---------- stopwatch ----------
const fmtDur = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;

function resetTimerUI() {
  timing = null;
  clearInterval(tickH);
  const b = $("btn-timer"), t = $("take-timer"), l = $("btn-log");
  if (b) b.textContent = "⏱ Start timer";
  if (t) t.textContent = "00:00";
  if (l) l.textContent = "Log take";
}

function toggleTimer() {
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

// ---------- wrap progress board ----------
function openProgress() {
  if (!state.activeProjectId) { toast("Open a project first"); return; }
  renderProgress();
  showView("progress");
}

function renderProgress() {
  const p = activeProject(); if (!p) return;
  $("progress-sub").textContent = `${p.film_name || "Untitled film"} - wrap progress`;
  const days = [...new Set(state.scenes.map((s) => s.day ?? 1))].sort((a, b) => a - b);
  const done = state.scenes.filter((s) => s.status === "Complete").length;
  const pct = state.scenes.length ? Math.round((done * 100) / state.scenes.length) : 0;
  const good = state.allTakes.filter((t) => t.rating === "Good").length;
  let html = `<div class="meta"><span>${done}/${state.scenes.length} scenes complete</span><span>${state.allTakes.length} takes · ${good} good</span></div><div class="prog-bar"><i style="width:${pct}%"></i></div>`;
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

function renderChips() {  const c = $("chips"); c.innerHTML = "";
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

const LENS_PRESETS = ["24", "35", "50", "85"];
function syncLensSeg() {
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
const fmtLens = (v) => (/mm\s*$/i.test(v.trim()) ? v.trim() : v.trim() + "mm");
const validTC = (v) => /^\d{1,2}:\d{2}:\d{2}$/.test(v.trim());
const liveTC = (el) => {
  const bad = el.value.trim() !== "" && !validTC(el.value);
  el.classList.toggle("invalid", bad);
  return !bad;
};
// Bump trailing run of digits, keeping padding and extension: C0004.MP4 -> C0005.MP4
const bumpName = (v) => {
  const m = String(v || "").match(/^(.*?)(\d+)(\.[A-Za-z0-9]+)?$/);
  if (!m) return v || "";
  const next = String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0");
  return m[1] + next + (m[3] || "");
};

// ---------- actions ----------
async function logTake() {
  const sc = active(); if (!sc) { toast("Create a scene first"); return; }
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
    const saved = await invoke("log_take", { take: payload });
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
  await loadAllTakes(); renderScenes(); renderHead(); refreshStats();
  toast(`Take ${pad(state.takeNo - 1)} · ${payload.rating} logged`);
}

async function exportExcel(projectId) {
  projectId = projectId || state.activeProjectId;
  if (!projectId) return;
  try {
    const path = await invoke("export_excel", {
      projectId,
      includeGood: S.exportGood, includeDays: S.exportDays,
    });
    sndExport();
    toast(`Exported → ${path}`);
  } catch (e) { toast("Export failed: " + e); }
}

// ---------- keyboard shortcuts (remappable) ----------
let capturing = null;

function renderShortcutRows() {
  const w = $("shortcut-rows"); w.innerHTML = "";
  SHORTCUT_DEFS.forEach((d) => {
    const row = document.createElement("div");
    row.className = "sc-row";
    const lab = document.createElement("span");
    lab.textContent = d.label;
    const b = document.createElement("button");
    b.className = "btn ghost sc-key";
    b.textContent = keyName(S.shortcuts[d.key] || DEFAULT_SHORTCUTS[d.key]);
    b.onclick = () => { capturing = d.key; b.textContent = "press keys…"; };
    row.appendChild(lab); row.appendChild(b);
    w.appendChild(row);
  });
}

function renderKeysHint() {
  const k = (a) => keyName(S.shortcuts[a] || DEFAULT_SHORTCUTS[a]);
  const el = $("keys-hint");
  if (el) el.textContent = `${k("logTake")} log · ${k("rateGood")} good · ${k("rateMaybe")} maybe · ${k("rateBad")} bad · ${k("prevScene")}/${k("nextScene")} scene`;
}

// ---------- modal keyboard system: Enter submits, Esc closes ----------
const modalOpen = () => !!document.querySelector(".modal:not(.hidden)");

const ENTER_SUBMIT = {
  "modal": "btn-create",
  "modal-take": "btn-save-take",
  "modal-project": "btn-save-project",
  "modal-cam": "btn-save-cam",
  "modal-lens": "btn-save-lens",
  "modal-setup": "btn-save-setup",
  "modal-settings": "btn-close-settings",
  "modal-confirm": "btn-confirm-ok",
  "modal-lightbox": "btn-lightbox-save",
};

function submitOpenModal() {
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
  for (const mid of ["modal-confirm", "modal-lightbox", "modal-setup", "modal-lens", "modal-cam", "modal-take", "modal", "modal-project", "modal-settings", "modal-set"]) {
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
function applySettingsToUI() {
  state.rating = S.defaultRating;
  state.lens = S.defaultLens;
  document.querySelectorAll("#seg-rating button").forEach((b) =>
    b.classList.toggle("on", b.dataset.v === state.rating));
  syncLensSeg();
  $("take-tc").classList.toggle("hidden", !S.manualTC);
  $("tc-now").style.display = S.manualTC ? "none" : "";
  renderChips();
  renderKeysHint();
}
// (btn-set lives in the stills header and is wired in renderPhotos)
$("btn-close-set").onclick = () => closeSetMode();
$("btn-settings").onclick = () => {
  $("set-sound").checked = S.sounds;
  $("set-confirm").checked = S.confirmDelete;
  $("set-manual-tc").checked = S.manualTC;
  $("set-def-rating").value = S.defaultRating;
  $("set-def-lens").value = S.defaultLens;
  $("set-def-intext").value = S.defaultIntExt;
  $("set-def-cam").value = S.defaultCam;
  $("set-quick").value = S.quickNotes.join("\n");
  $("set-exp-good").checked = S.exportGood;
  $("set-exp-days").checked = S.exportDays;
  $("set-autobump").checked = S.autoBump;
  $("set-port").value = S.setPort;
  $("set-check-startup").checked = S.checkStartup;
  $("update-status").textContent = "";
  renderShortcutRows();
  $("modal-settings").classList.remove("hidden");
};
$("set-sound").onchange = (e) => {
  S.sounds = e.target.checked; saveSettings();
  if (S.sounds) sndClick();
};
$("set-confirm").onchange = (e) => { S.confirmDelete = e.target.checked; saveSettings(); };
$("set-manual-tc").onchange = (e) => {
  S.manualTC = e.target.checked; saveSettings(); applySettingsToUI();
  if (S.manualTC) $("take-tc").value = nowTC();
};
$("set-def-rating").onchange = (e) => {
  S.defaultRating = e.target.value; state.rating = S.defaultRating; saveSettings(); applySettingsToUI(); sndClick();
};
$("set-def-lens").onchange = (e) => {
  S.defaultLens = e.target.value.trim() || "35"; state.lens = S.defaultLens; saveSettings(); applySettingsToUI(); sndClick();
};
$("set-def-intext").onchange = (e) => { S.defaultIntExt = e.target.value; saveSettings(); sndClick(); };
$("set-def-cam").onchange = (e) => { S.defaultCam = e.target.value.trim(); saveSettings(); };
$("set-quick").onchange = (e) => {
  S.quickNotes = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!S.quickNotes.length) S.quickNotes = [...DEFAULT_QUICK];
  saveSettings(); renderChips(); sndClick();
};
$("set-exp-good").onchange = (e) => { S.exportGood = e.target.checked; saveSettings(); };
$("set-exp-days").onchange = (e) => { S.exportDays = e.target.checked; saveSettings(); };
$("set-autobump").onchange = (e) => { S.autoBump = e.target.checked; saveSettings(); sndClick(); };
$("set-port").onchange = (e) => {
  const p = parseInt(e.target.value);
  S.setPort = p >= 1024 && p <= 65535 ? p : 17831;
  e.target.value = S.setPort;
  saveSettings(); sndClick();
};
$("set-check-startup").onchange = (e) => { S.checkStartup = e.target.checked; saveSettings(); };
// ---------- updates (manual button + silent boot check) ----------
async function checkForUpdates(manual) {
  const el = $("update-status");
  try {
    if (manual) el.textContent = "Checking…";
    const r = await invoke("check_update");
    if (r.available) {
      el.innerHTML = "";
      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = `Install v${r.version} & restart`;
      b.onclick = async () => {
        el.textContent = "Downloading…";
        try { await invoke("install_update"); }
        catch (e) { el.textContent = "Install failed: " + e; }
      };
      el.appendChild(document.createTextNode(`v${r.version} available. `));
      el.appendChild(b);
      if (!manual) toast(`Slate Log v${r.version} is ready - see Settings → Updates`);
    } else if (manual) {
      const v = await invoke("app_version").catch(() => "");
      el.textContent = `You're on the latest${v ? " (v" + v + ")" : ""}.`;
    }
  } catch (e) {
    if (manual) el.textContent = "Check failed (offline?): " + e;
  }
}
$("btn-check-updates").onclick = () => checkForUpdates(true);
$("btn-defaults").onclick = () => {
  Object.assign(S, { ...DEFAULT_SETTINGS, quickNotes: [...DEFAULT_QUICK], shortcuts: { ...DEFAULT_SHORTCUTS } });
  saveSettings(); applySettingsToUI(); renderKeysHint();
  $("btn-settings").click(); // re-open to refresh all controls
  toast("Settings restored to defaults");
};
$("btn-shortcut-reset").onclick = () => {
  S.shortcuts = { ...DEFAULT_SHORTCUTS };
  saveSettings(); renderShortcutRows(); renderKeysHint(); sndClick();
  toast("Shortcuts reset");
};
$("btn-close-settings").onclick = () => $("modal-settings").classList.add("hidden");
// ---------- set mode (phone snap page over LAN) ----------
let setPollH = null;

async function openSetMode() {
  if (!state.activeProjectId) { toast("Open a project first"); return; }
  try {
    const r = await invoke("set_start", { sceneId: state.activeId, port: S.setPort });
    const svg = await invoke("set_qr");
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

async function refreshSetScene() {
  try {
    const info = await invoke("set_info");
    if (!info.running) { closeSetMode(true); return; }
    $("set-scene").textContent = info.scene_number ? `Scene ${info.scene_number} ${info.scene_title || ""}` : "-";
  } catch { /* server went away */ }
}

async function closeSetMode(silent) {
  clearInterval(setPollH);
  setPollH = null;
  try { await invoke("set_stop"); } catch { /* ignore */ }
  $("modal-set").classList.add("hidden");
  if (!silent) sndClick();
  // Phone may have pushed stills/takes while we were covered - refresh.
  if (state.activeProjectId) {
    await loadTakes();
    renderScenes(); renderHead();
    await loadAllTakes(); refreshStats();
  }
}

async function pushSceneToServer() {
  try { await invoke("set_scene", { sceneId: state.activeId }); } catch { /* server off */ }
  if (!$("modal-set").classList.contains("hidden")) refreshSetScene();
}

// ---------- screenplay import (parse, review, import) ----------
let parsedScript = [];

async function openScriptImport() {
  if (!state.activeProjectId) { toast("Open a project first"); return; }
  $("script-notice").textContent = "";
  $("script-paste-wrap").open = false;
  try {
    const r = await invoke("import_screenplay_pdf");
    if (r.cancelled) { toast("Import cancelled"); return; }
    fillScriptReview(r.scenes || [], r.warnings || []);
  } catch (e) {
    // Brittle PDF? Drop into paste mode — the parser works on any text.
    parsedScript = [];
    renderScriptReview();
    $("script-sub").textContent = "That PDF would not read - paste the script text below instead";
    $("script-notice").textContent = String(e);
    $("script-warn").textContent = "";
    $("script-paste-wrap").open = true;
    showView("script");
  }
}

function fillScriptReview(scenes, warnings) {
  parsedScript = scenes;
  if (!parsedScript.length) { toast("No scenes found"); return; }
  const nset = parsedScript.reduce((a, s) => a + (s.setups || []).length, 0);
  $("script-sub").textContent = `${parsedScript.length} scenes, ${nset} shot lines found - tick scenes to import; tick setups only for shots you want as setups (day defaults to 1)`;
  $("script-warn").textContent = (warnings || []).join(" · ");
  $("script-notice").textContent = "";
  renderScriptReview();
  showView("script");
}

async function parseScriptPaste() {
  const text = $("script-paste").value;
  try {
    const r = await invoke("parse_screenplay_text", { text });
    if (r.cancelled) return;
    fillScriptReview(r.scenes || [], r.warnings || []);
  } catch (e) { toast("Parse failed: " + e); }
}

function renderScriptReview() {
  const tb = $("script-body"); tb.innerHTML = "";
  parsedScript.forEach((s, i) => {
    const tr = document.createElement("tr");
    const names = s.setups || [];
    const setupTip = names.join("\n");
    const autoTick = names.length > 0 && names.length <= 8;
    const setupShort = names.length
      ? `${names.length} (${names.slice(0, 2).join(", ")}${names.length > 2 ? ", …" : ""})`
      : "—";
    tr.innerHTML = `<td><input type="checkbox" data-i="${i}" checked></td>
      <td><input data-f="number" data-i="${i}" value="${esc(s.number)}"></td>
      <td><input data-f="title" data-i="${i}" value="${esc(s.title)}"></td>
      <td><select data-f="int_ext" data-i="${i}"><option${s.int_ext === "INT" ? " selected" : ""}>INT</option><option${s.int_ext === "EXT" ? " selected" : ""}>EXT</option></select></td>
      <td><select data-f="daypart" data-i="${i}">${["Day", "Dusk", "Night", "Dawn"].map((d) => `<option${s.daypart === d ? " selected" : ""}>${d}</option>`).join("")}</select></td>
      <td><input data-f="location" data-i="${i}" value="${esc(s.location)}"></td>
      <td title="${esc(setupTip)}"><label class="check" style="margin:0"><input type="checkbox" data-setup-for="${i}"${autoTick ? " checked" : ""}> ${esc(setupShort)}</label></td>`;
    tb.appendChild(tr);
  });
}

async function importReviewedScript() {
  const rows = [...document.querySelectorAll("#script-body tr")].map((tr, i) => {
    const get = (f) => tr.querySelector(`[data-f="${f}"]`).value;
    const wantSetups = tr.querySelector(`[data-setup-for="${i}"]`)?.checked;
    return {
      checked: tr.querySelector("input[type=checkbox]").checked,
      number: get("number"), title: get("title"), int_ext: get("int_ext"),
      daypart: get("daypart"), location: get("location"),
      setups: wantSetups ? (parsedScript[i]?.setups || []) : [],
    };
  }).filter((r) => r.checked);
  if (!rows.length) { toast("Nothing checked"); return; }
  try {
    const r = await invoke("import_parsed_scenes", {
      projectId: state.activeProjectId,
      scenes: rows.map(({ checked, ...s }) => s),
    });
    sndClick();
    toast(`Imported ${r.imported} scenes + ${r.setups || 0} setups${r.duplicates ? ` (${r.duplicates} duplicates skipped)` : ""}${r.skipped ? `, ${r.skipped} rows skipped` : ""}`);
    showView("app");
    await loadScenes();
  } catch (e) { toast("Import failed: " + e); }
}

// ---------- wire ----------
$("btn-script").onclick = openScriptImport;
$("btn-script-back").onclick = () => showView("app");
$("btn-script-import").onclick = importReviewedScript;
$("btn-script-parse").onclick = parseScriptPaste;
$("btn-report").onclick = openReport;
$("btn-report-back").onclick = () => showView("app");
$("report-day").onchange = renderReport;
$("btn-print").onclick = () => window.print();
$("btn-import").onclick = async () => {
  if (!state.activeProjectId) { toast("Open a project first"); return; }
  try {
    const r = await invoke("import_scenes_csv", { projectId: state.activeProjectId });
    if (r.cancelled) { toast("Import cancelled"); return; }
    sndClick();
    toast(`Imported ${r.imported} scenes${r.duplicates ? ` (${r.duplicates} duplicates skipped)` : ""}${r.skipped ? `, ${r.skipped} rows skipped` : ""}`);
    await loadScenes();
  } catch (e) { toast("Import failed: " + e); }
};
$("btn-template").onclick = async () => {
  try {
    const path = await invoke("write_template_csv");
    sndClick();
    toast(`Template saved → ${path}`);
  } catch (e) { toast("Template failed: " + e); }
};
$("btn-add-setup").onclick = () => {
  if (!active()) { toast("Select a scene first"); return; }
  $("setup-input").value = "";
  $("modal-setup").classList.remove("hidden");
  setTimeout(() => $("setup-input").focus(), 50);
};
$("btn-save-setup").onclick = saveSetup;
$("btn-cancel-setup").onclick = () => $("modal-setup").classList.add("hidden");
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
$("btn-save-cam").onclick = saveCam;
$("btn-cam").onclick = openCamPopup;
$("btn-cancel-cam").onclick = () => $("modal-cam").classList.add("hidden");
seg("seg-rating", (v) => (state.rating = v));
seg("seg-take-intext", (v) => (state.takeIntExt = v));
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
$("btn-progress").onclick = openProgress;
$("btn-progress-back").onclick = () => showView("app");
$("btn-edl").onclick = async () => {
  if (!state.activeProjectId) return;
  try {
    const r = await invoke("export_edl", { projectId: state.activeProjectId });
    sndExport();
    toast(`EDL: ${r.events} events${r.skipped ? ` (${r.skipped} bad TC skipped)` : ""} → ${r.path}`);
  } catch (e) { toast("EDL failed: " + e); }
};
$("btn-pdf").onclick = async () => {
  if (!state.activeProjectId) return;
  const day = parseInt($("report-day").value) || 1;
  try {
    const path = await invoke("export_pdf", { projectId: state.activeProjectId, day });
    sndExport();
    toast(`PDF saved → ${path}`);
  } catch (e) { toast("PDF failed: " + e); }
};
$("btn-lightbox-close").onclick = () => $("modal-lightbox").classList.add("hidden");
$("btn-lightbox-save").onclick = async () => {
  if (!state.lightboxId) return;
  try { await invoke("update_photo_caption", { id: state.lightboxId, caption: $("lightbox-cap").value.trim() }); }
  catch (e) { toast("Save failed: " + e); return; }
  sndClick();
  $("modal-lightbox").classList.add("hidden");
  await loadPhotos();
};
$("btn-lightbox-del").onclick = async () => {
  if (!state.lightboxId) return;
  if (!(await confirmAsync("Delete this still?"))) return;
  try { await invoke("delete_photo", { id: state.lightboxId }); } catch (e) { toast("Delete failed: " + e); return; }
  sndDelete();
  state.lightboxId = null;
  $("modal-lightbox").classList.add("hidden");
  await loadPhotos();
};
$("btn-export").onclick = () => exportExcel();
$("take-tc").oninput = (e) => liveTC(e.target);
$("e-tc").oninput = (e) => liveTC(e.target);
$("filter").oninput = (e) => { state.filter = e.target.value; renderScenes(); };
$("btn-home").onclick = goHome;
$("btn-home-new").onclick = openNewProject;
$("btn-home-first").onclick = openNewProject;
$("project-search").oninput = (e) => { state.projectQuery = e.target.value; renderHome(); };
$("day-prev").onclick = () => stepDay(-1);
$("day-next").onclick = () => stepDay(1);
$("btn-new-scene").onclick = openNewScene;
$("btn-cancel").onclick = () => $("modal").classList.add("hidden");
$("btn-cancel-take").onclick = () => $("modal-take").classList.add("hidden");
$("btn-save-take").onclick = saveEditTake;
$("btn-create").onclick = async () => {
  const s = { number: $("f-number").value.trim() || "1", title: $("f-title").value.trim(), int_ext: $("f-intext").value, daypart: $("f-daypart").value, description: $("f-desc").value, camera_default: $("f-camera").value.trim(), day: parseInt($("f-day").value) || 1, location: $("f-location").value.trim(), status: $("f-status").value };
  try {
    if (state.editingSceneId) { await invoke("update_scene", { id: state.editingSceneId, scene: s }); state.activeId = state.editingSceneId; }
    else { const created = await invoke("create_scene", { projectId: state.activeProjectId, scene: s }); state.activeId = created.id; }
  } catch (e) { toast("Save failed: " + e); return; }
  $("modal").classList.add("hidden");
  sndClick();
  await loadScenes();
};
$("btn-cancel-project").onclick = () => $("modal-project").classList.add("hidden");
$("btn-save-project").onclick = saveProject;

document.addEventListener("keydown", (e) => {
  // Remap capture has first dibs on every key.
  if (capturing) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== "Escape") {
      const clash = SHORTCUT_DEFS.find((d) => d.key !== capturing && (S.shortcuts[d.key] || DEFAULT_SHORTCUTS[d.key]) === e.code);
      if (clash) {
        toast(`Already used by ${clash.label}`);
      } else {
        S.shortcuts[capturing] = e.code;
        saveSettings(); renderKeysHint(); sndClick();
      }
    }
    capturing = null;
    renderShortcutRows();
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
    if (state.scenes[n]) { state.activeId = state.scenes[n].id; loadTakes().then(() => { renderScenes(); renderHead(); pushSceneToServer(); }); }
  }
});

setInterval(() => { $("tc-now").textContent = nowTC(); }, 1000);
$("tc-now").textContent = nowTC();
applySettingsToUI();
loadProjects();
if (S.checkStartup) setTimeout(() => checkForUpdates(false), 5000);
