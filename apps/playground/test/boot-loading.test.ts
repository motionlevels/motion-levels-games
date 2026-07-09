import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

test("hard refresh starts behind an inline loading screen", () => {
  assert.match(htmlSource, /<style id="playground-boot-styles">/);
  assert.match(htmlSource, /html:not\(\.playground-ready\) #root\s*\{[^}]*visibility:\s*hidden;/s);
  assert.match(htmlSource, /id="app-loading-screen"[^>]*role="status"/);
  assert.match(htmlSource, /class="app-loading-spinner"/);
  assert.match(htmlSource, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the playground is revealed only after fonts and two stable paints", () => {
  assert.match(mainSource, /await document\.fonts\.ready/);
  assert.equal(mainSource.match(/await afterNextPaint\(\)/g)?.length, 2);
  assert.match(mainSource, /classList\.add\("playground-ready"\)/);
  assert.match(mainSource, /setAttribute\("aria-busy", "false"\)/);
  assert.match(mainSource, /getElementById\("app-loading-screen"\)\?\.remove\(\)/);
});
