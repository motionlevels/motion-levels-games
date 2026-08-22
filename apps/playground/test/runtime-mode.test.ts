import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readPlaygroundRuntimeMode,
  searchForPlaygroundRuntimeMode,
} from "../src/runtimeMode.ts";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("integrated playground defaults to venue while standalone stays sandboxed", () => {
  assert.equal(readPlaygroundRuntimeMode("", true), "venue");
  assert.equal(readPlaygroundRuntimeMode("", false), "sandbox");
  assert.equal(readPlaygroundRuntimeMode("?runtime=venue", false), "sandbox");
});

test("sandbox selection is explicit and recording URLs always use it", () => {
  assert.equal(readPlaygroundRuntimeMode("?runtime=sandbox", true), "sandbox");
  assert.equal(readPlaygroundRuntimeMode("?recordScenario=victory", true), "sandbox");
  assert.equal(readPlaygroundRuntimeMode("?recordScenario=victory&runtime=venue", true), "sandbox");
});

test("runtime mode URLs preserve unrelated development parameters", () => {
  assert.equal(
    searchForPlaygroundRuntimeMode("?floorRotation=90", "sandbox", true),
    "?floorRotation=90&runtime=sandbox",
  );
  assert.equal(
    searchForPlaygroundRuntimeMode("?floorRotation=90&runtime=sandbox", "venue", true),
    "?floorRotation=90",
  );
  assert.equal(
    searchForPlaygroundRuntimeMode("?recordScenario=victory", "sandbox", true),
    "?recordScenario=victory&runtime=sandbox",
  );
});

test("one playground origin exposes an explicit and isolated runtime selector", () => {
  assert.match(appSource, /aria-label="Runtime mode"/);
  assert.match(appSource, /changeRuntimeMode\("venue"\)/);
  assert.match(appSource, /changeRuntimeMode\("sandbox"\)/);
  assert.match(appSource, /runtimeModeRef\.current === "venue" \? venueDisplayRef\.current : null/);
  assert.match(appSource, /if \(runtimeModeRef\.current !== "sandbox"\)/);
  assert.match(appSource, /<PlayerMenuPreview active=\{venueModeActive && primaryScreen === "menu"\}/);
  assert.doesNotMatch(appSource, /pauseVenueForSandbox|sandboxPauseRequestRunRef/);
  assert.match(appSource, /Manual pause belongs to the mode in which it was requested/);
  assert.match(appSource, /if \(venueRuntimeActive && venueDisplay\) \{\s*audioOutput\.sync\(venueDisplay\);\s*\} else \{\s*audioOutput\.suspend\(\);/);
  assert.match(appSource, /onClick=\{\(\) => setManuallyPausedState\(!pausedRef\.current\)\}/);
  assert.match(styleSource, /\.runtime-mode-toggle\[data-runtime-mode="sandbox"\]/);
  assert.match(
    styleSource,
    /@media \(orientation: landscape\) and \(min-width: 1201px\) and \(max-width: 1550px\)[\s\S]*?"surface-actions surface-actions"/,
  );
});
