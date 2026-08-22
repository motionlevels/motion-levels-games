import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeScenarioRecordingOptions,
  scenarioContactSheetIndices,
  scenarioRecordingTimeline
} from "../src/scenarioRecordingTimeline.ts";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("scenario recording timeline includes lead-in and stops before reset boundary", () => {
  const options = normalizeScenarioRecordingOptions({
    durationMillis: 5_000,
    frameIntervalMillis: 100,
    leadInMillis: 400
  });

  const timeline = scenarioRecordingTimeline(options);
  assert.equal(timeline.length, 54);
  assert.deepEqual(timeline.slice(0, 5), [-400, -300, -200, -100, 0]);
  assert.equal(timeline.at(-1), 4_900);
});

test("scenario contact sheet samples the complete recording evenly", () => {
  assert.deepEqual(scenarioContactSheetIndices(54), [0, 11, 21, 32, 42, 53]);
  assert.deepEqual(scenarioContactSheetIndices(3), [0, 1, 2]);
  assert.deepEqual(scenarioContactSheetIndices(0), []);
});

test("scenario recording rejects excessive frame counts", () => {
  assert.throws(
    () => normalizeScenarioRecordingOptions({ durationMillis: 20_000, frameIntervalMillis: 50 }),
    /at most 240 frames/
  );
});

test("URL-driven recordings use a contained review layout instead of overlapping the workbench", () => {
  assert.match(appSource, /scenarioReviewMode \? "is-scenario-review" : ""/);
  assert.match(appSource, /aria-busy=\{scenarioRecordingActive\}/);
  assert.match(appSource, /<span>Animated review<\/span>/);
  assert.match(appSource, /<span>Keyframes<\/span>/);
  assert.match(
    styleSource,
    /\.playground-shell\.is-scenario-review > \.playground-header\s*\{[^}]*display:\s*none;/s,
    "recording review must not leave the developer header visible"
  );
  assert.match(
    styleSource,
    /\.playground-shell\.is-scenario-review > \.playground-grid\s*\{[^}]*left:\s*-10000px;[^}]*position:\s*fixed;/s,
    "capture surfaces must remain mounted but outside the review viewport"
  );
  assert.match(
    styleSource,
    /\.scenario-recording-review-media img\s*\{[^}]*max-width:\s*100%;[^}]*width:\s*100%;/s,
    "recording assets must stay inside their review cards"
  );
});
