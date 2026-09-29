// Slate Log — pure helpers (no DOM, no Tauri). Covered by src/tests/.
// Anything here must stay importable in plain node for `npm test`.

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const pad = (n) => String(n).padStart(2, "0");

export const keyName = (code) => {
  const m = { Space: "Space", Escape: "Esc", Enter: "Enter", ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→", Tab: "Tab" };
  if (m[code]) return m[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
};

export const nowTC = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

export const fmtDur = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;

export const fmtLens = (v) => (/mm\s*$/i.test(v.trim()) ? v.trim() : v.trim() + "mm");

// Shape + ranges: hours can run long on multi-day shoots, minutes/seconds
// must be real clock values (the EDL writer rejects the rest downstream).
export const validTC = (v) => /^\d{1,2}:[0-5]\d:[0-5]\d$/.test(v.trim());

// Bump trailing run of digits, keeping padding and extension: C0004.MP4 -> C0005.MP4
export const bumpName = (v) => {
  const m = String(v || "").match(/^(.*?)(\d+)(\.[A-Za-z0-9]+)?$/);
  if (!m) return v || "";
  const next = String(parseInt(m[2], 10) + 1).padStart(m[2].length, "0");
  return m[1] + next + (m[3] || "");
};

export const nextStatus = (s) => (s === "Not shot" ? "Partial" : s === "Partial" ? "Complete" : "Not shot");

export const rateDot = (rating) => (rating === "Good" ? "●" : rating === "Maybe" ? "◐" : "○");

export const photoCountText = (n) => (n > 0 ? `📷 ×${n} attached` : "—");

export function calcProgress(scenes) {
  const total = scenes.length;
  const done = scenes.filter((s) => (s.status || "Not shot") === "Complete").length;
  const pct = total ? Math.max(0, Math.min(100, Math.round((done * 100) / total))) : 0;
  return { done, total, pct, remaining: total - done };
}

// Shape a parsed screenplay scene for import_parsed_scenes.
// Location stays empty unless the fill-location setting is on.
export function mapScriptSceneForImport(s, fillLocation) {
  return {
    number: s.number,
    title: s.title,
    int_ext: s.int_ext,
    daypart: s.daypart,
    location: fillLocation ? (s.location || s.title || "") : "",
    setups: s.setups || [],
  };
}

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 520;
export const clampSidebarWidth = (w) => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(w)));

// Full NewScene payload from a scene row, with overrides (int_ext, day, status…).
export function scenePayload(sc, overrides = {}) {
  return {
    number: sc.number,
    title: sc.title,
    int_ext: sc.int_ext,
    daypart: sc.daypart,
    day: sc.day ?? 1,
    location: sc.location || "",
    status: sc.status || "Not shot",
    description: sc.description,
    camera_default: sc.camera_default,
    ...overrides,
  };
}
