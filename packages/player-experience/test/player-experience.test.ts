import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptsPlayerExperienceState,
  controlsForState,
  lifecycleFromRuntime,
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
  });

  it("never accepts an equal, stale, invalid, or incompatible revision", () => {
    assert.equal(acceptsPlayerExperienceState(null, base), true);
    assert.equal(acceptsPlayerExperienceState(base, { ...base, revision: 2 }), true);
    assert.equal(acceptsPlayerExperienceState({ ...base, revision: 3 }, { ...base, revision: 2 }), false);
    assert.equal(acceptsPlayerExperienceState(base, { ...base, revision: 1 }), false);
    assert.equal(acceptsPlayerExperienceState(base, { ...base, revision: 1.5 }), false);
  });

  it("derives menu routing and controls from canonical state", () => {
    assert.equal(playerExperienceView(base).screen, "game");
    assert.equal(playerExperienceView({ ...base, lifecycle: "idle" }).screen, "browse");
    assert.deepEqual(controlsForState(base), ["pause", "restart", "exit", "narration", "mute", "toggle_mute"]);
    assert.deepEqual(controlsForState({ ...base, lifecycle: "paused" }), ["resume", "restart", "exit", "narration", "mute", "toggle_mute"]);
  });
});
