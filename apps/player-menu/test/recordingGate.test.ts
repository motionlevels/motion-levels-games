import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerExperienceRecordingGate } from "@motion-levels-games/player-experience";
import {
  recordingGateActionLabel,
  recordingGateAllowsGameStarted,
  recordingGateBlocks,
  recordingGateMenuProjection,
} from "../src/recordingGate.ts";

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

describe("recording gate menu projection", () => {
  it("keeps arming and timeout blocked until the engine changes state", () => {
    assert.equal(recordingGateBlocks(gate), true);
    assert.deepEqual(recordingGateMenuProjection(gate), {
      state: "arming",
      title: "Preparando GoPro",
      body: "La partida empezará cuando la cámara confirme la grabación.",
      actions: [],
      blocking: true,
    });

    const timedOut = recordingGateMenuProjection(
      { ...gate, state: "timed_out", reason: "timeout" },
      ["recording_retry", "recording_continue_without", "recording_cancel"],
    );
    assert.equal(timedOut?.title, "La GoPro está tardando más de lo esperado");
    assert.deepEqual(timedOut?.actions, ["recording_retry", "recording_continue_without", "recording_cancel"]);
    assert.equal(timedOut?.blocking, true);
  });

  it("only exposes actions authorized by the current engine revision", () => {
    const projection = recordingGateMenuProjection(
      { ...gate, state: "timed_out", reason: "start_unconfirmed" },
      ["recording_retry", "pause"],
    );
    assert.equal(projection?.title, "La GoPro no confirmó la grabación");
    assert.deepEqual(projection?.actions, ["recording_retry"]);
  });

  it("treats ready as a non-blocking acknowledgement", () => {
    const projection = recordingGateMenuProjection({ ...gate, state: "ready", readyAtUnixMillis: 2_000 });
    assert.equal(recordingGateBlocks({ ...gate, state: "ready" }), false);
    assert.deepEqual(projection, {
      state: "ready",
      title: "GoPro lista",
      body: "Grabación iniciada",
      actions: [],
      blocking: false,
    });
  });

  it("only acknowledges game_started from an authoritative unblocked revision", () => {
    assert.equal(recordingGateAllowsGameStarted({ lifecycle: "launching", recordingGate: gate }), false);
    assert.equal(recordingGateAllowsGameStarted({
      lifecycle: "launching",
      recordingGate: { ...gate, state: "timed_out", reason: "timeout" },
    }), false);
    assert.equal(recordingGateAllowsGameStarted({
      lifecycle: "starting",
      recordingGate: { ...gate, state: "timed_out", reason: "timeout" },
    }), false);
    assert.equal(recordingGateAllowsGameStarted({
      lifecycle: "starting",
      recordingGate: { ...gate, state: "ready", readyAtUnixMillis: 2_000 },
    }), true);
    assert.equal(recordingGateAllowsGameStarted({ lifecycle: "running" }), true);
  });

  it("uses stable player-facing labels for transport-pending actions", () => {
    assert.equal(recordingGateActionLabel("recording_retry"), "Reintentar");
    assert.equal(recordingGateActionLabel("recording_retry", true), "Reintentando");
    assert.equal(recordingGateActionLabel("recording_continue_without"), "Jugar sin grabación");
    assert.equal(recordingGateActionLabel("recording_cancel", true), "Cancelando");
  });
});
