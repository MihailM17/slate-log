// Slate Log — settings feature: modal, tabs, shortcuts window, updates.
// Owns everything under "App settings". The take card follows defaults
// through applySettingsToUI (subscribed below); takes-domain refreshes
// (renderChips, syncLensSeg) arrive via initSettings deps so this module
// never reaches into another feature's code.

import {
  S, state, DEFAULT_QUICK, DEFAULT_SHORTCUTS, DEFAULT_SETTINGS,
  updateSettings, subscribe,
} from "../store.js";
import * as api from "../api.js";
import { keyName, nowTC } from "../utils.js";
import { $, toast, sndClick } from "../ui.js";

const SHORTCUT_DEFS = [
  { key: "logTake", label: "Log take" },
  { key: "rateGood", label: "Rate Good" },
  { key: "rateMaybe", label: "Rate Maybe" },
  { key: "rateBad", label: "Rate Bad" },
  { key: "nextScene", label: "Next scene" },
  { key: "prevScene", label: "Previous scene" },
  { key: "newScene", label: "New scene" },
];

let capturing = null;
let deps = { renderChips() {}, syncLensSeg() {} };

export function renderShortcutRows() {
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

export function renderKeysHint() {
  const k = (a) => keyName(S.shortcuts[a] || DEFAULT_SHORTCUTS[a]);
  const el = $("keys-hint");
  if (el) el.textContent = `${k("logTake")} log · ${k("rateGood")} good · ${k("rateMaybe")} maybe · ${k("rateBad")} bad · ${k("prevScene")}/${k("nextScene")} scene`;
}

// Called first by the global keydown handler. Returns true when a remap
// capture consumed the key (app.js must stop there).
export function handleCaptureKey(e) {
  if (!capturing) return false;
  e.preventDefault();
  e.stopPropagation();
  if (e.code !== "Escape") {
    const clash = SHORTCUT_DEFS.find((d) => d.key !== capturing && (S.shortcuts[d.key] || DEFAULT_SHORTCUTS[d.key]) === e.code);
    if (clash) {
      toast(`Already used by ${clash.label}`);
    } else {
      updateSettings({ shortcuts: { ...S.shortcuts, [capturing]: e.code } });
      renderKeysHint(); sndClick();
    }
  }
  capturing = null;
  renderShortcutRows();
  return true;
}

export function applySettingsToUI() {
  state.rating = S.defaultRating;
  state.lens = S.defaultLens;
  document.querySelectorAll("#seg-rating button").forEach((b) =>
    b.classList.toggle("on", b.dataset.v === state.rating));
  deps.syncLensSeg();
  $("take-tc").classList.toggle("hidden", !S.manualTC);
  $("tc-now").style.display = S.manualTC ? "none" : "";
  deps.renderChips();
  renderKeysHint();
}

function openSettings() {
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
  $("set-fill-location").checked = !!S.fillLocation;
  $("set-port").value = S.setPort;
  $("set-check-startup").checked = S.checkStartup;
  $("update-status").textContent = "";
  // Always land on the first tab (silent reset, no click sound on open).
  document.querySelectorAll("#set-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === "general"));
  document.querySelectorAll(".set-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== "general"));
  $("modal-settings").classList.remove("hidden");
}

// ---------- updates (manual button + silent boot check) ----------
export async function checkForUpdates(manual) {
  const el = $("update-status");
  try {
    if (manual) el.textContent = "Checking…";
    const r = await api.checkUpdate();
    if (r.available) {
      el.innerHTML = "";
      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = `Install v${r.version} & restart`;
      b.onclick = async () => {
        el.textContent = "Downloading…";
        try { await api.installUpdate(); }
        catch (e) { el.textContent = "Install failed: " + e; }
      };
      el.appendChild(document.createTextNode(`v${r.version} available. `));
      el.appendChild(b);
      if (!manual) toast(`Slate Log v${r.version} is ready - see Settings → Updates`);
    } else if (manual) {
      const v = await api.appVersion().catch(() => "");
      el.textContent = `You're on the latest${v ? " (v" + v + ")" : ""}.`;
    }
  } catch (e) {
    if (manual) el.textContent = "Check failed (offline?): " + e;
  }
}

// Wire every control in the settings + shortcuts modals. Takes-domain
// refresh callbacks arrive as deps; settings state stays in the store.
export function initSettings(d) {
  deps = { ...deps, ...d };
  $("btn-settings").onclick = openSettings;
  $("btn-open-shortcuts").onclick = () => {
    renderShortcutRows();
    $("modal-shortcuts").classList.remove("hidden");
  };
  $("btn-close-shortcuts").onclick = () => $("modal-shortcuts").classList.add("hidden");
  document.querySelectorAll("#set-tabs button").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("#set-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      document.querySelectorAll(".set-pane").forEach((p) =>
        p.classList.toggle("hidden", p.dataset.pane !== b.dataset.tab));
      sndClick();
    };
  });
  $("set-sound").onchange = (e) => {
    updateSettings({ sounds: e.target.checked });
    if (S.sounds) sndClick();
  };
  $("set-confirm").onchange = (e) => { updateSettings({ confirmDelete: e.target.checked }); };
  $("set-manual-tc").onchange = (e) => {
    updateSettings({ manualTC: e.target.checked });
    if (S.manualTC) $("take-tc").value = nowTC();
  };
  $("set-def-rating").onchange = (e) => {
    updateSettings({ defaultRating: e.target.value }); state.rating = S.defaultRating; sndClick();
  };
  $("set-def-lens").onchange = (e) => {
    updateSettings({ defaultLens: e.target.value.trim() || "35" }); state.lens = S.defaultLens; sndClick();
  };
  $("set-def-intext").onchange = (e) => { updateSettings({ defaultIntExt: e.target.value }); sndClick(); };
  $("set-def-cam").onchange = (e) => { updateSettings({ defaultCam: e.target.value.trim() }); };
  $("set-quick").onchange = (e) => {
    const quickNotes = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
    updateSettings({ quickNotes: quickNotes.length ? quickNotes : [...DEFAULT_QUICK] });
    sndClick();
  };
  $("set-exp-good").onchange = (e) => { updateSettings({ exportGood: e.target.checked }); };
  $("set-exp-days").onchange = (e) => { updateSettings({ exportDays: e.target.checked }); };
  $("set-autobump").onchange = (e) => { updateSettings({ autoBump: e.target.checked }); sndClick(); };
  $("set-fill-location").onchange = (e) => { updateSettings({ fillLocation: e.target.checked }); sndClick(); };
  $("set-port").onchange = (e) => {
    const p = parseInt(e.target.value);
    updateSettings({ setPort: p >= 1024 && p <= 65535 ? p : 17831 });
    e.target.value = S.setPort;
    sndClick();
  };
  $("set-check-startup").onchange = (e) => { updateSettings({ checkStartup: e.target.checked }); };
  $("btn-check-updates").onclick = () => checkForUpdates(true);
  $("btn-defaults").onclick = () => {
    updateSettings({ ...DEFAULT_SETTINGS, quickNotes: [...DEFAULT_QUICK], shortcuts: { ...DEFAULT_SHORTCUTS } });
    $("btn-settings").click(); // re-open to refresh all controls
    toast("Settings restored to defaults");
  };
  $("btn-shortcut-reset").onclick = () => {
    updateSettings({ shortcuts: { ...DEFAULT_SHORTCUTS } });
    renderShortcutRows(); renderKeysHint(); sndClick();
    toast("Shortcuts reset");
  };
  $("btn-close-settings").onclick = () => $("modal-settings").classList.add("hidden");
  subscribe((evt) => { if (evt === "settings") applySettingsToUI(); });
  if (S.checkStartup) setTimeout(() => checkForUpdates(false), 5000);
}
