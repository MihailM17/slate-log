import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every $("id") / getElementById("id") in shipped JS must resolve to an
// element: either static in index.html or created dynamically in JS
// templates (id="x"). A typo here is a silently dead button — the exact
// failure mode that shipped a blank app once.

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "..");

const html = fs.readFileSync(path.join(srcDir, "index.html"), "utf8");
const htmlIds = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));

const jsFiles = [];
for (const entry of fs.readdirSync(srcDir)) {
  const full = path.join(srcDir, entry);
  if (entry.endsWith(".js") && fs.statSync(full).isFile()) jsFiles.push(full);
}
for (const entry of fs.readdirSync(path.join(srcDir, "features"))) {
  jsFiles.push(path.join(srcDir, "features", entry));
}

const dynamicIds = new Set();
const lookedUp = new Set();
for (const file of jsFiles) {
  const code = fs.readFileSync(file, "utf8");
  for (const m of code.matchAll(/id="([\w-]+)"/g)) dynamicIds.add(m[1]);
  for (const m of code.matchAll(/\$\("([\w-]+)"\)/g)) lookedUp.add(m[1]);
  for (const m of code.matchAll(/getElementById\("([\w-]+)"\)/g)) lookedUp.add(m[1]);
}
// showView() builds view-* ids dynamically.
for (const v of ["home", "app", "report", "progress", "script"]) {
  assert.ok(htmlIds.has(`view-${v}`), `view-${v} exists in index.html`);
}

describe("element id wiring", () => {
  it("every looked-up id exists in HTML or a JS template", () => {
    const known = new Set([...htmlIds, ...dynamicIds]);
    const missing = [...lookedUp].filter((id) => !known.has(id));
    assert.deepEqual(missing, []);
  });

  it("every ENTER_SUBMIT target button exists", () => {
    const known = new Set([...htmlIds, ...dynamicIds]);
    for (const m of fs.readFileSync(path.join(srcDir, "app.js"), "utf8").matchAll(/"([\w-]+)":\s*"([\w-]+)"/g)) {
      assert.ok(known.has(m[1]), `modal ${m[1]} exists`);
      assert.ok(known.has(m[2]), `button ${m[2]} exists`);
    }
  });
});
