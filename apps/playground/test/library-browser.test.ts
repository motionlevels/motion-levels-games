import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { animationLibrary } from "@motion-levels-games/animation-runtime";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const animationsManifestSource = readFileSync(new URL("../../../games/animations/src/manifest.ts", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("local browser discovers games and native animations", () => {
  assert.match(animationsManifestSource, /slug: "animations"/);
  assert.ok(animationLibrary.length >= 24);
  assert.match(appSource, /Local content browser/);
  assert.match(appSource, /visibleLibraryGames/);
  assert.match(appSource, /visibleLibraryAnimations/);
  assert.match(appSource, /selectAnimation\(animation\.id\)/);
  assert.match(appSource, /animationMediaURL\(animation\.id, "animation", animationMediaBundleRootURL\)/);
  assert.match(appSource, /onError=\{\(event\) => \{ event\.currentTarget\.hidden = true; \}\}/);
});

test("library is searchable, filterable, responsive, and pauses the runtime", () => {
  assert.match(appSource, /setInteractionPauseState\("library-dialog", open\)/);
  assert.match(appSource, /type="search"/);
  assert.match(appSource, /\["all", "games", "animations"\]/);
  assert.match(styleSource, /\.library-browser\s*\{/);
  assert.match(styleSource, /@media \(max-width: 720px\)[\s\S]*?\.library-browser\s*\{/);
});
