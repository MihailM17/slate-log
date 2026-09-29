// Slate Log — shared UI primitives: element lookup, toast, sounds, confirm.
// No app state here; confirmAsync reads the settings toggle from the store.
// Safe to import in node (DOM/audio are touched only when called).

import { S } from "./store.js";

export const $ = (id) => document.getElementById(id);

export function showView(name) {
  for (const v of ["home", "app", "report", "progress", "script"]) {
    $(`view-${v}`).classList.toggle("hidden", name !== v);
  }
}

export function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 2600);
}

// ---------- sounds (tiny WebAudio synth, no assets, works offline) ----------
let actx = null;
function ac() {
  if (!actx) { try { actx = new (globalThis.AudioContext || globalThis.webkitAudioContext)(); } catch { return null; } }
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
export const sndClick = () => tone(620, 0.04, "sine", 0.06);
export const sndLog = (r) => {
  if (r === "Good") { tone(660, 0.09); tone(880, 0.12, "sine", 0.12, 0.08); }
  else if (r === "Maybe") tone(440, 0.1);
  else tone(170, 0.16, "square", 0.07);
};
export const sndDelete = () => tone(220, 0.12, "sawtooth", 0.06);
export const sndExport = () => { tone(523, 0.09); tone(659, 0.09, "sine", 0.12, 0.08); tone(784, 0.14, "sine", 0.12, 0.16); };

// In-app confirm (reliable inside the Tauri webview, unlike native dialogs).
// force=true bypasses the settings toggle — used for project deletes which
// always require a double check.
export function confirmAsync(msg, okLabel = "Delete", force = false) {
  return new Promise((resolve) => {
    if (!S.confirmDelete && !force) { resolve(true); return; }
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
