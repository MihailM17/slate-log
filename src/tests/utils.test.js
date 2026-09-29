import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  esc, pad, keyName, fmtDur, fmtLens, validTC, bumpName, nextStatus,
  rateDot, photoCountText, calcProgress, mapScriptSceneForImport,
  clampSidebarWidth, scenePayload,
} from "../utils.js";

describe("esc", () => {
  it("escapes HTML specials", () => {
    assert.equal(esc(`<b>"a"&'b'</b>`), "&lt;b&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/b&gt;");
  });
  it("handles null/undefined", () => {
    assert.equal(esc(null), "");
    assert.equal(esc(undefined), "");
    assert.equal(esc(14), "14");
  });
});

describe("pad", () => {
  it("zero-pads", () => {
    assert.equal(pad(1), "01");
    assert.equal(pad(12), "12");
  });
});

describe("keyName", () => {
  it("names special keys", () => {
    assert.equal(keyName("Space"), "Space");
    assert.equal(keyName("Escape"), "Esc");
    assert.equal(keyName("ArrowDown"), "↓");
  });
  it("strips Key/Digit prefixes", () => {
    assert.equal(keyName("KeyG"), "G");
    assert.equal(keyName("Digit1"), "1");
  });
  it("passes the rest through", () => {
    assert.equal(keyName("F5"), "F5");
  });
});

describe("fmtDur", () => {
  it("formats m:ss", () => {
    assert.equal(fmtDur(0), "00:00");
    assert.equal(fmtDur(65), "01:05");
  });
});

describe("fmtLens", () => {
  it("appends mm when missing", () => {
    assert.equal(fmtLens("35"), "35mm");
    assert.equal(fmtLens(" 50 "), "50mm");
  });
  it("keeps an mm suffix as-is", () => {
    assert.equal(fmtLens("35mm"), "35mm");
    assert.equal(fmtLens("50MM"), "50MM");
  });
});

describe("validTC", () => {
  it("accepts HH:MM:SS", () => {
    assert.equal(validTC("12:34:56"), true);
    assert.equal(validTC("1:02:03"), true);
  });
  it("rejects the rest", () => {
    assert.equal(validTC(""), false);
    assert.equal(validTC("12:34"), false);
    assert.equal(validTC("abc"), false);
    assert.equal(validTC("12:3:00"), false);
    // NOTE: validTC only checks shape, not ranges — "12:99:00" passes here
    // and is rejected later by the Rust TC parser (EDL skips it).
    assert.equal(validTC("12:99:00"), true);
  });
});

describe("bumpName", () => {
  it("bumps keeping padding and extension", () => {
    assert.equal(bumpName("C0004.MP4"), "C0005.MP4");
    assert.equal(bumpName("A001C004"), "A001C005");
    assert.equal(bumpName("T01"), "T02");
  });
  it("leaves digit-less names alone", () => {
    assert.equal(bumpName("clip"), "clip");
    assert.equal(bumpName(""), "");
  });
});

describe("nextStatus", () => {
  it("cycles Not shot -> Partial -> Complete -> Not shot", () => {
    assert.equal(nextStatus("Not shot"), "Partial");
    assert.equal(nextStatus("Partial"), "Complete");
    assert.equal(nextStatus("Complete"), "Not shot");
  });
});

describe("rateDot", () => {
  it("maps ratings to dots", () => {
    assert.equal(rateDot("Good"), "●");
    assert.equal(rateDot("Maybe"), "◐");
    assert.equal(rateDot("Bad"), "○");
  });
});

describe("photoCountText", () => {
  it("labels counts", () => {
    assert.equal(photoCountText(0), "—");
    assert.equal(photoCountText(3), "📷 ×3 attached");
  });
});

describe("calcProgress", () => {
  it("handles empty", () => {
    assert.deepEqual(calcProgress([]), { done: 0, total: 0, pct: 0, remaining: 0 });
  });
  it("counts Complete only", () => {
    const scenes = [{ status: "Complete" }, { status: "Partial" }, {}];
    assert.deepEqual(calcProgress(scenes), { done: 1, total: 3, pct: 33, remaining: 2 });
  });
  it("caps at 100", () => {
    assert.equal(calcProgress([{ status: "Complete" }]).pct, 100);
  });
});

describe("mapScriptSceneForImport", () => {
  const parsed = { number: "14", title: "MEADOW", int_ext: "EXT", daypart: "Day", location: "", setups: ["WIDE SHOT - #1"] };
  it("leaves location empty by default", () => {
    assert.deepEqual(mapScriptSceneForImport(parsed, false), {
      number: "14", title: "MEADOW", int_ext: "EXT", daypart: "Day", location: "", setups: ["WIDE SHOT - #1"],
    });
  });
  it("fills location from title when enabled", () => {
    assert.equal(mapScriptSceneForImport(parsed, true).location, "MEADOW");
  });
  it("defaults missing setups", () => {
    assert.deepEqual(mapScriptSceneForImport({ ...parsed, setups: undefined }, false).setups, []);
  });
});

describe("clampSidebarWidth", () => {
  it("clamps to 200–520", () => {
    assert.equal(clampSidebarWidth(150), 200);
    assert.equal(clampSidebarWidth(600), 520);
    assert.equal(clampSidebarWidth(300.4), 300);
  });
});

describe("scenePayload", () => {
  const sc = { number: "2", title: "T", int_ext: "INT", daypart: "Night", day: 3, location: "L", status: "Partial", description: "D", camera_default: "A" };
  it("builds a full payload", () => {
    assert.deepEqual(scenePayload(sc), { ...sc });
  });
  it("applies overrides and defaults", () => {
    const bare = { number: "1", title: "", int_ext: "INT", daypart: "Day", description: "", camera_default: "" };
    assert.deepEqual(scenePayload(bare, { int_ext: "EXT" }), {
      number: "1", title: "", int_ext: "EXT", daypart: "Day", day: 1,
      location: "", status: "Not shot", description: "", camera_default: "",
    });
  });
});
