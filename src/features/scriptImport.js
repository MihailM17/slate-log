// Slate Log — screenplay import: PDF auto-import straight into scenes,
// with the review table + paste fallback when parsing fails. Scene creation
// goes through the scenes module's loader (dep) so this module never touches
// the scene list itself.

import { S, state } from "../store.js";
import * as api from "../api.js";
import { esc, mapScriptSceneForImport } from "../utils.js";
import { $, toast, sndClick, showView } from "../ui.js";

let parsedScript = [];

let deps = {
  loadScenes() {},
};

async function openScriptImport() {
  if (!state.activeProjectId) { toast("Open a project first"); return; }
  $("script-notice").textContent = "";
  $("script-paste-wrap").open = false;
  try {
    const r = await api.importScreenplayPdf();
    if (r.cancelled) { toast("Import cancelled"); return; }
    const scenes = r.scenes || [];
    if (!scenes.length) throw new Error("No scenes found");
    // Goal: point at a PDF and get scenes instantly — auto-create them.
    // Review screen stays as the fallback when parsing fails.
    const rows = scenes.map((s) => mapScriptSceneForImport(s, S.fillLocation));
    try {
      const done = await api.importParsedScenes(state.activeProjectId, rows);
      sndClick();
      toast(`Imported ${done.imported} scenes + ${done.setups || 0} setups${done.duplicates ? ` (${done.duplicates} duplicates skipped)` : ""}${done.skipped ? `, ${done.skipped} rows skipped` : ""}`);
      await deps.loadScenes();
      return;
    } catch (e) {
      // Auto-import failed (e.g. duplicates) — fall through to review.
      fillScriptReview(scenes, r.warnings || []);
    }
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
  // Review fallback: honour the fill-location setting (default OFF keeps location empty).
  parsedScript = (scenes || []).map((s) => ({ ...s, ...mapScriptSceneForImport(s, S.fillLocation) }));
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
    const r = await api.parseScreenplayText(text);
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
    const r = await api.importParsedScenes(
      state.activeProjectId,
      rows.map(({ checked, ...s }) => s),
    );
    sndClick();
    toast(`Imported ${r.imported} scenes + ${r.setups || 0} setups${r.duplicates ? ` (${r.duplicates} duplicates skipped)` : ""}${r.skipped ? `, ${r.skipped} rows skipped` : ""}`);
    showView("app");
    await deps.loadScenes();
  } catch (e) { toast("Import failed: " + e); }
}

// Wire the script buttons. Called once at startup.
export function initScriptImport(d) {
  deps = { ...deps, ...d };
  $("btn-script").onclick = openScriptImport;
  $("btn-script-back").onclick = () => showView("app");
  $("btn-script-import").onclick = importReviewedScript;
  $("btn-script-parse").onclick = parseScriptPaste;
}
