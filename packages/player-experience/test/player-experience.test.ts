import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  acceptsPlayerExperienceState,
  controlsForState,
  lifecycleFromRuntime,
  PlayerExperienceStateGate,
  playerExperienceView,
  type PlayerExperienceState,
} from "../src/index.ts";

const base = {
  contractVersion: 1,
  revision: 1,
  runId: "run-1",
  lifecycle: "running",
  allowedControls: [],
  currentGame: "ping-pong",
  venueSessionId: "venue-1",
  sessionId: "engine-1",
  label: "Ping Pong",
  phase: "running",
  difficulty: "medium",
  teamName: "Equipo",
  playerCount: 2,
  players: [],
  score: 0,
  lives: -1,
  music: "",
  musicVolume: 0,
  audioEnabled: true,
  audioMuted: false,
  paused: false,
  success: false,
  startedUnix: 1,
  endsUnix: 0,
  elapsedMillis: 0,
  remainingMillis: 0,
  introRemainingMillis: 0,
  countdownRemainingMillis: 0,
  activeTargets: 0,
  lastEventUnixNanos: 0,
  lastEventCue: "",
  lastEventMessage: "",
  lastPressureUnix: 1,
  catalog: [],
} satisfies PlayerExperienceState;

describe("canonical player experience", () => {
  it("normalizes runtime phases once", () => {
    assert.equal(lifecycleFromRuntime(base), "running");
    assert.equal(lifecycleFromRuntime({ ...base, paused: true }), "paused");
    assert.equal(lifecycleFromRuntime({ ...base, phase: "countdown" }), "starting");
    assert.equal(lifecycleFromRuntime({ ...base, phase: "idle" }), "waiting");
    assert.equal(lifecycleFromRuntime({ ...base, currentGame: "salvapantallas", phase: "running" }), "idle");
    assert.equal(lifecycleFromRuntime({
      ...base,
      recordingGate: {
        id: "gate-1",
        state: "arming",
        scope: "run",
        runId: "engine-1",
        captureId: "capture-1",
        attempt: 1,
        startedAtUnixMillis: 1,
        timeoutAtUnixMillis: 10,
      },
    }), "launching");
  });

  it("never accepts an equal, stale, invalid, or incompatible revision", () => {
    assert.equal(acceptsPlayerExperienceState(null, base), true);
    assert.equal(acceptsPlayerExperienceState(base, { ...base, revision: 2 }), true);
    assert.equal(acceptsPlayerExperienceState({ ...base, revision: 3 }, { ...base, revision: 2 }), false);
    assert.equal(acceptsPlayerExperienceState(base, { ...base, revision: 1 }), false);
    assert.equal(acceptsPlayerExperienceState(base, { ...base, revision: 1.5 }), false);
    assert.equal(
      acceptsPlayerExperienceState({ ...base, revision: 99 }, { ...base, revision: 1, runId: "run-after-restart" }),
      true,
      "a new runtime process owns a fresh monotonic revision sequence"
    );
  });

  it("cannot roll a restarted runtime back to a retired process", () => {
    const gate = new PlayerExperienceStateGate();
    const oldRuntime = { ...base, revision: 99, runId: "runtime-old" };
    const restartedRuntime = { ...base, revision: 1, runId: "runtime-new" };

    assert.equal(gate.accepts(oldRuntime, restartedRuntime), true);
    assert.equal(gate.accepts(restartedRuntime, { ...oldRuntime, revision: 100 }), false);
    assert.equal(gate.accepts(restartedRuntime, { ...restartedRuntime, revision: 2 }), true);
  });

  it("derives menu routing and controls from canonical state", () => {
    assert.equal(playerExperienceView(base).screen, "game");
    assert.equal(playerExperienceView({ ...base, lifecycle: "idle" }).screen, "browse");
    assert.equal(playerExperienceView({ ...base, phase: "ambient" }).screen, "browse");
    assert.equal(playerExperienceView({ ...base, phase: "ambient" }).lifecycle, "running");
    assert.deepEqual(controlsForState(base), ["pause", "restart", "exit", "narration", "mute", "toggle_mute"]);
    assert.deepEqual(controlsForState({ ...base, lifecycle: "paused" }), ["resume", "restart", "exit", "narration", "mute", "toggle_mute"]);
    const recordingGate = {
      id: "gate-1",
      scope: "run" as const,
      runId: "engine-1",
      captureId: "capture-1",
      attempt: 1,
      startedAtUnixMillis: 1,
      timeoutAtUnixMillis: 10,
    };
    assert.deepEqual(controlsForState({ ...base, lifecycle: "launching", recordingGate: { ...recordingGate, state: "arming" } }), []);
    assert.deepEqual(
      controlsForState({ ...base, lifecycle: "launching", recordingGate: { ...recordingGate, state: "timed_out", reason: "timeout" } }),
      ["recording_retry", "recording_continue_without", "recording_cancel"],
    );
    assert.deepEqual(
      controlsForState({ ...base, recordingGate: { ...recordingGate, state: "ready", readyAtUnixMillis: 9 } }),
      ["pause", "restart", "exit", "narration", "mute", "toggle_mute"],
    );
    assert.equal(playerExperienceView({ ...base, lifecycle: "launching", recordingGate: { ...recordingGate, state: "arming" } }).pending, true);
  });

  it("publishes the optional strict run-recording gate in the JSON contract", () => {
    const schema = JSON.parse(readFileSync(new URL("../schema/player-experience-state.schema.json", import.meta.url), "utf8")) as {
      properties?: Record<string, unknown>;
      $defs?: Record<string, { properties?: Record<string, { const?: string; enum?: string[] }>; required?: string[] }>;
    };
    const gate = schema.$defs?.recordingGate;
    assert.ok(schema.properties?.recordingGate);
    assert.deepEqual(gate?.properties?.state?.enum, ["arming", "timed_out", "ready"]);
    assert.equal(gate?.properties?.scope?.const, "run");
    assert.deepEqual(gate?.properties?.reason?.enum, ["timeout", "unavailable", "start_rejected", "start_unconfirmed"]);
    assert.ok(gate?.required?.includes("captureId"));
  });
});
