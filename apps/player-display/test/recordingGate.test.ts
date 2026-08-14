import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { PlayerExperienceRecordingGate } from "@motion-levels-games/player-experience";
import { recordingGateDisplayProjection } from "../src/recordingGate.ts";

const gate = {
  id: "gate-1",
  state: "arming",
  scope: "run",
  runId: "run-1",
  captureId: "capture-1",
  attempt: 1,
  startedAtUnixMillis: 1_000,
  timeoutAtUnixMillis: 11_000,
} satisfies PlayerExperienceRecordingGate;

describe("player display recording gate", () => {
  it("projects every authoritative state in Spanish", () => {
    assert.deepEqual(recordingGateDisplayProjection(gate), {
      state: "arming",
      title: "Preparando GoPro",
      body: "La partida empezará cuando la cámara esté grabando",
      blocking: true,
    });
    assert.deepEqual(recordingGateDisplayProjection({ ...gate, state: "timed_out", reason: "timeout" }), {
      state: "timed_out",
      title: "La GoPro no responde",
      body: "Elige una opción en el menú",
      blocking: true,
    });
    assert.deepEqual(recordingGateDisplayProjection({ ...gate, state: "ready", readyAtUnixMillis: 2_000 }), {
      state: "ready",
      title: "GoPro lista",
      body: "Grabación iniciada",
      blocking: false,
    });
    assert.equal(recordingGateDisplayProjection(undefined), null);
  });

  it("renders one global non-interactive overlay with accessible live regions", () => {
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const overlaySource = readFileSync(new URL("../src/RecordingGateOverlay.tsx", import.meta.url), "utf8");
    const cssSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

    assert.match(appSource, /<RecordingGateDisplay gate=\{liveStatus\.recordingGate\}>\{display\}<\/RecordingGateDisplay>/u);
    assert.match(overlaySource, /role=\{projection\.state === "timed_out" \? "alert" : "status"\}/u);
    assert.match(overlaySource, /aria-live=\{projection\.state === "timed_out" \? "assertive" : "polite"\}/u);
    assert.doesNotMatch(overlaySource, /<button/u);
    assert.match(cssSource, /\.recording-gate-display-copy h1,[\s\S]*?white-space: normal;/u);
    assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/u);
  });
});
