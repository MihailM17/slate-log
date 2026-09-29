// Slate Log — central store. Settings and app state live here, not in app.js.
//
// Reads: `import { S, state } from "./store.js"` (live bindings, same identity).
// Writes: settings go through updateSettings() so persistence + UI refresh
// happen in exactly one place. Covered by src/tests/store.test.js.
//
// Storage access is defensive (localStorage is absent in node/tests) and
// lazy-safe: nothing touches storage during module evaluation.

export const DEFAULT_QUICK = ["Clean take", "Boom in frame", "Focus soft", "Camera noise", "Actor flub", "Continuity break"];
export const DEFAULT_SHORTCUTS = { logTake: "Space", rateGood: "KeyG", rateMaybe: "KeyM", rateBad: "KeyB", nextScene: "ArrowDown", prevScene: "ArrowUp", newScene: "KeyN" };
export const DEFAULT_SETTINGS = {
  sounds: true, confirmDelete: true, manualTC: false,
  defaultRating: "Good", defaultLens: "35", defaultIntExt: "INT", defaultCam: "",
  quickNotes: [...DEFAULT_QUICK], exportGood: true, exportDays: true,
  autoBump: true, setPort: 17831, checkStartup: true,
  fillLocation: false,
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

function storageGet(key) {
  try { return globalThis.localStorage?.getItem(key) ?? null; }
  catch { return null; }
}

function storageSet(key, value) {
  try { globalThis.localStorage?.setItem(key, value); }
  catch { /* ignore (private mode, tests without storage) */ }
}

function loadSettings() {
  let s;
  try {
    const raw = JSON.parse(storageGet("slate-settings") || "null");
    s = raw && typeof raw === "object" ? { ...DEFAULT_SETTINGS, ...raw } : { ...DEFAULT_SETTINGS };
  } catch { /* fall through to legacy keys */ s = { ...DEFAULT_SETTINGS }; }
  if (storageGet("slate-sound") === "off") s.sounds = false;
  if (storageGet("slate-confirm") === "off") s.confirmDelete = false;
  s.shortcuts = { ...DEFAULT_SHORTCUTS, ...(s.shortcuts || {}) };
  return s;
}

// Live binding: importers always see the current object.
export let S = loadSettings();

export function saveSettings() {
  storageSet("slate-settings", JSON.stringify(S));
}

// Test-only: re-read settings (e.g. after swapping the storage backend).
export function _reloadSettings() {
  S = loadSettings();
  emit("settings", { ...S });
  return S;
}

export const state = {
  projects: [], activeProjectId: null,
  scenes: [], takes: [], allTakes: [], setups: [], photos: [], activeId: null,
  photoCounts: {}, photoLabels: [],
  rating: S.defaultRating, lens: S.defaultLens, takeIntExt: S.defaultIntExt, tags: new Set(),
  takeNo: 1, takeSetupId: null, lastDuration: 0, filter: "", projectQuery: "", editingSceneId: null, editingProjectId: null, editingTakeId: null, lightboxId: null,
  pendingPosterKey: null, posterRemove: false,
};

const listeners = new Set();

// Subscribe to store events ("settings"). Returns an unsubscribe function.
export function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit(evt, data) {
  for (const fn of [...listeners]) {
    try { fn(evt, data); }
    catch (e) { console.error(e); }
  }
}

// The only way settings should change: merges, persists, notifies.
export function updateSettings(patch) {
  Object.assign(S, patch);
  saveSettings();
  emit("settings", patch);
  return S;
}
