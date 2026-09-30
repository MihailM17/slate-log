// Slate Log — photos feature: continuity stills grid, lightbox, add/delete.
//
// Stills belong to the active scene. The takes table + Excel read the same
// scene photo set via loadAllTakes (imported from takes.js, one direction
// only). The Set-mode button that lives in the stills header arrives via
// initPhotos deps so this module never reaches into set-mode code.

import { state } from "../store.js";
import * as api from "../api.js";
import { esc } from "../utils.js";
import { $, toast, sndClick, sndDelete, confirmAsync } from "../ui.js";
import { loadAllTakes } from "./takes.js";

const activeScene = () => state.scenes.find((s) => s.id === state.activeId);

const CAM_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1-2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

let deps = {
  openSetMode() {},
};

export async function loadPhotos() {
  const sc = activeScene();
  if (!sc) { state.photos = []; renderPhotos(); return; }
  try { state.photos = await api.listPhotos(sc.id); }
  catch { state.photos = []; }
  renderPhotos();
}

function renderPhotos() {
  const w = $("photos");
  const sc = activeScene();
  if (!sc) { w.innerHTML = ""; return; }
  w.innerHTML = `<div class="photos-head"><strong>Continuity stills</strong><span>${state.photos.length}</span><button id="btn-add-photo" class="addphoto" title="Import a still into this scene">+ Add photo</button><span class="camwrap"><button id="btn-set" class="btn ghost iconbtn" title="Set mode: phones on this WiFi push stills + takes live">${CAM_SVG} Set</button></span></div><div class="photo-grid" id="photo-grid"></div>`;
  $("btn-add-photo").onclick = addPhoto;
  $("btn-set").onclick = () => deps.openSetMode();
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
      try { await api.deletePhoto(p.id); } catch (err) { toast("Delete failed: " + err); return; }
      sndDelete();
      if (state.lightboxId === p.id) { state.lightboxId = null; $("modal-lightbox").classList.add("hidden"); }
      await loadPhotos();
      await loadAllTakes();
    };
    api.photoData(p.id, true)
      .then((src) => { const im = cell.querySelector("img"); if (im) im.src = src; })
      .catch(() => {});
    g.appendChild(cell);
  });
}

async function addPhoto() {
  const sc = activeScene(); if (!sc) return;
  try {
    await api.addPhoto(sc.id, state.takeSetupId);
    sndClick(); toast("Photo added");
    await loadPhotos();
    await loadAllTakes();
  } catch (e) {
    if (!String(e).includes("cancelled")) toast("Photo failed: " + e);
  }
}

function openLightbox(id) {
  state.lightboxId = id;
  const p = state.photos.find((x) => x.id === id);
  $("lightbox-cap").value = p?.caption || "";
  $("lightbox-img").removeAttribute("src");
  $("modal-lightbox").classList.remove("hidden");
  api.photoData(id, false)
    .then((src) => { $("lightbox-img").src = src; })
    .catch((e) => { toast("Could not load photo: " + e); });
}

// Wire the lightbox modal. Called once at startup.
export function initPhotos(d) {
  deps = { ...deps, ...d };
  $("btn-lightbox-close").onclick = () => $("modal-lightbox").classList.add("hidden");
  $("btn-lightbox-save").onclick = async () => {
    if (!state.lightboxId) return;
    try { await api.updatePhotoCaption(state.lightboxId, $("lightbox-cap").value.trim()); }
    catch (e) { toast("Save failed: " + e); return; }
    sndClick();
    $("modal-lightbox").classList.add("hidden");
    await loadPhotos();
  };
  $("btn-lightbox-del").onclick = async () => {
    if (!state.lightboxId) return;
    if (!(await confirmAsync("Delete this still?"))) return;
    try { await api.deletePhoto(state.lightboxId); } catch (e) { toast("Delete failed: " + e); return; }
    sndDelete();
    state.lightboxId = null;
    $("modal-lightbox").classList.add("hidden");
    await loadPhotos();
    await loadAllTakes();
  };
}
