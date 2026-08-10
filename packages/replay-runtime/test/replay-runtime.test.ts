import assert from "node:assert/strict";
import test from "node:test";
import {
  REPLAY_SCHEMA_VERSION,
  ReplayPlayer,
  ReplayRecorder,
  anonymizeReplay,
  createGhostTrack,
  decodeReplay,
  encodeReplay,
  replayChecksum,
  runHeadlessReplay,
  stableStringify,
  verifyHeadlessReplay,
  type ReplayHeader
} from "../src/index.ts";
import {
  createFrame,
  gameEvent,
  paintFrameCell,
  type GameConfig,
  type GameInstance,
  type GameSnapshot,
  type PressEvent,
  type TickEvent
} from "@motion-levels-games/game-sdk";

const header: ReplayHeader = {
  schemaVersion: REPLAY_SCHEMA_VERSION,
  gameId: "replay-test",
  gameVersion: "1.0.0",
  simulationVersion: "1",
  brainVersions: { bot: "1" },
  seed: "137",
  tickRate: 50,
  startedAt: "2026-08-10T10:00:00.000Z"
};

test("stable JSON and checksums ignore object insertion order", () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(replayChecksum({ b: 2, a: 1 }), replayChecksum({ a: 1, b: 2 }));
  assert.throws(() => stableStringify({ invalid: Number.NaN }), /non-finite/);
});

test("recorder writes periodic snapshots and returns defensive copies", () => {
  const recorder = new ReplayRecorder(header, { snapshotIntervalTicks: 2 });
  recorder.record({
    tick: 0,
    inputs: [{ kind: "press", x: 1, y: 2, sourceId: "person-1" }],
    actions: [{ agentId: "bot-1", action: { kind: "move" } }],
    events: [gameEvent("hit", "Objetivo", 0)],
    agents: [{ id: "bot-1", position: { x: 1, y: 2 }, facingRadians: 0, action: "move" }],
    state: { score: 1 }
  });
  recorder.record({ tick: 1, state: { score: 2 } });
  recorder.record({ tick: 2, state: { score: 3 } });
  const replay = recorder.finish();
  assert.equal(replay.frames.length, 3);
  assert.deepEqual(replay.snapshots.map((snapshot) => snapshot.tick), [0, 2]);
  assert.equal(replay.frames[0]?.checksum, replayChecksum({ score: 1 }));
  replay.frames[0]!.inputs[0]!.x = 99;
  assert.equal(recorder.finish().frames[0]?.inputs[0]?.x, 1);
  assert.throws(() => recorder.record({ tick: 2, state: {} }), /strictly increasing/);
});

test("player supports pause, speed, seek, and snapshot-assisted replay", () => {
  const recorder = new ReplayRecorder(header, { snapshotIntervalTicks: 2 });
  for (let tick = 0; tick <= 6; tick += 1) recorder.record({ tick, state: { tick } });
  const player = new ReplayPlayer(recorder.finish());
  assert.equal(player.advance(2).length, 0);
  player.play();
  player.setSpeed(2);
  assert.deepEqual(player.advance(1).map((frame) => frame.tick), [1, 2]);
  const seek = player.seek(5);
  assert.equal(seek.snapshot?.tick, 4);
  assert.deepEqual(seek.frames.map((frame) => frame.tick), [5], "post-tick snapshots must not replay their own frame");
  player.pause();
  assert.equal(player.state.paused, true);
  assert.throws(() => player.setSpeed(0), /greater than zero/);
});

test("player accumulates fractional slow-motion progress", () => {
  const recorder = new ReplayRecorder(header);
  for (let tick = 0; tick <= 3; tick += 1) recorder.record({ tick, state: { tick } });
  const player = new ReplayPlayer(recorder.finish());
  player.setSpeed(0.5);
  player.play();
  assert.deepEqual(player.advance(1), []);
  assert.deepEqual(player.advance(1).map((frame) => frame.tick), [1]);
  assert.deepEqual(player.advance(1), []);
  assert.deepEqual(player.advance(1).map((frame) => frame.tick), [2]);
  assert.equal(player.state.tick, 2);
});

test("ghost tracks preserve deterministic logical samples", () => {
  const recorder = new ReplayRecorder(header);
  recorder.record({
    tick: 0,
    agents: [{ id: "ghost", position: { x: 1, y: 2 }, facingRadians: 0.5, action: "run" }],
    state: {}
  });
  recorder.record({
    tick: 1,
    agents: [{ id: "ghost", position: { x: 2, y: 2 }, facingRadians: 1, action: "run" }],
    state: {}
  });
  const track = createGhostTrack(recorder.finish(), "ghost");
  assert.deepEqual(track.samples.map((sample) => [sample.tick, sample.position.x]), [[0, 1], [1, 2]]);
});

test("anonymization aliases identities, removes time, and filters private state", () => {
  const recorder = new ReplayRecorder({
    ...header,
    config: { difficulty: "medium", privateName: "Alice" },
    initialState: { id: "alice", privateName: "Alice" }
  });
  recorder.record({
    tick: 0,
    inputs: [{ kind: "press", x: 1, y: 2, sourceId: "alice" }],
    actions: [{ agentId: "alice", action: { kind: "wait", privateName: "Alice" } }],
    events: [gameEvent("hit", "Alice scored", 0)],
    agents: [{
      id: "alice",
      position: { x: 1, y: 2 },
      facingRadians: 0,
      action: "wait",
      state: { intention: "wait", privateName: "Alice" }
    }],
    state: { agents: [{ id: "alice", privateName: "Alice" }] }
  });
  const anonymous = anonymizeReplay(recorder.finish(), {
    salt: "test-salt",
    retainAgentStateKeys: ["intention"],
    retainConfigKeys: ["difficulty"]
  });
  const agent = anonymous.frames[0]!.agents![0]!;
  assert.match(agent.id, /^agent-[0-9a-f]{8}$/);
  assert.equal(anonymous.frames[0]!.inputs[0]!.sourceId, agent.id);
  assert.deepEqual(agent.state, { intention: "wait" });
  assert.equal(anonymous.header.startedAt, undefined);
  assert.deepEqual(anonymous.header.config, { difficulty: "medium" });
  assert.equal(anonymous.header.initialState, undefined);
  assert.deepEqual(anonymous.frames[0]!.actions, []);
  assert.deepEqual(anonymous.frames[0]!.events, []);
  assert.deepEqual(anonymous.snapshots, []);
  assert.equal(anonymous.frames[0]!.checksum, undefined);
  assert.doesNotMatch(JSON.stringify(anonymous), /\balice\b|Alice/u);
});

test("recorder keeps full and game-authoritative checksums separate", () => {
  const recorder = new ReplayRecorder(header);
  const frame = recorder.record({
    tick: 0,
    state: { game: { score: 1 }, debug: { privateDecision: "left" } },
    authoritativeState: { score: 1 }
  });
  assert.equal(frame.checksum, replayChecksum({ game: { score: 1 }, debug: { privateDecision: "left" } }));
  assert.equal(frame.authoritativeChecksum, replayChecksum({ score: 1 }));
  assert.notEqual(frame.checksum, frame.authoritativeChecksum);
});

test("encoding is canonical and unsupported schemas fail explicitly", () => {
  const recorder = new ReplayRecorder(header);
  recorder.record({ tick: 0, state: { ready: true } });
  const encoded = encodeReplay(recorder.finish());
  assert.deepEqual(decodeReplay(encoded), recorder.finish());
  const invalid = JSON.parse(encoded) as { header: { schemaVersion: number } };
  invalid.header.schemaVersion = 99;
  assert.throws(() => decodeReplay(JSON.stringify(invalid)), /Unsupported replay schema/);
});

test("headless fixed-tick runs reproduce every checksum", () => {
  const result = runHeadlessReplay({
    createGame: createTestGame,
    config: { seed: 17, durationMillis: 1_000 },
    header: {
      gameId: "replay-test",
      gameVersion: "1",
      simulationVersion: "1",
      brainVersions: {}
    },
    tickRate: 10,
    ticks: 8,
    inputs: [
      { tick: 1, kind: "press", x: 2, y: 3, sourceId: "bot" },
      { tick: 4, kind: "release", x: 2, y: 3, sourceId: "bot" }
    ],
    snapshotIntervalTicks: 3
  });
  assert.equal(result.replay.frames.length, 9);
  assert.deepEqual(result.replay.snapshots.map((snapshot) => snapshot.tick), [0, 3, 6]);
  assert.equal(result.state.snapshot.score, 2);
  const verification = verifyHeadlessReplay(result.replay, createTestGame);
  assert.equal(verification.valid, true);
  assert.equal(verification.mismatches.length, 0);

  result.replay.frames[2]!.checksum = "deadbeef";
  assert.deepEqual(verifyHeadlessReplay(result.replay, createTestGame).mismatches, [
    { tick: 2, expected: "deadbeef", actual: verificationChecksum(result.replay, 2, createTestGame) }
  ]);
});

function verificationChecksum(
  replay: Parameters<typeof verifyHeadlessReplay>[0],
  tick: number,
  factory: (config: GameConfig) => GameInstance
): string {
  const original = replay.frames[tick]!.checksum;
  replay.frames[tick]!.checksum = undefined;
  const rerun = runHeadlessReplay({
    createGame: factory,
    config: { seed: Number(replay.header.seed), durationMillis: 1_000 },
    header: {
      gameId: replay.header.gameId,
      gameVersion: replay.header.gameVersion,
      simulationVersion: replay.header.simulationVersion,
      brainVersions: {}
    },
    tickRate: replay.header.tickRate,
    ticks: replay.frames.at(-1)!.tick,
    inputs: replay.frames.flatMap((frame) => frame.inputs.map((input) => ({ ...input, tick: frame.tick })))
  });
  replay.frames[tick]!.checksum = original;
  return rerun.replay.frames[tick]!.checksum!;
}

function createTestGame(config: GameConfig): GameInstance {
  let nowMillis = config.nowMillis ?? 0;
  let held = false;
  let score = 0;
  let lastMessage = "Listo";
  return {
    init(atMillis) {
      nowMillis = atMillis;
      return [gameEvent("start", "Listo", atMillis)];
    },
    press(event: PressEvent) {
      nowMillis = event.atMillis;
      held = true;
      lastMessage = "Pulsado";
      return [gameEvent("hit", lastMessage, event.atMillis)];
    },
    release(event: PressEvent) {
      nowMillis = event.atMillis;
      held = false;
      lastMessage = "Soltado";
      return [gameEvent("none", lastMessage, event.atMillis)];
    },
    tick(event: TickEvent) {
      if (held && event.atMillis > nowMillis) score += 1;
      nowMillis = event.atMillis;
      return [];
    },
    render() {
      const frame = createFrame();
      if (held) paintFrameCell(frame, 2, 3, "#ffffff");
      return frame;
    },
    snapshot(): GameSnapshot {
      return {
        currentGame: "replay-test",
        label: "Replay Test",
        phase: "running",
        playerCount: 1,
        players: [],
        score,
        lives: -1,
        elapsedMillis: nowMillis,
        remainingMillis: 0,
        activeTargets: held ? 1 : 0,
        success: false,
        lastEventCue: "none",
        lastEventMessage: lastMessage
      };
    },
    reset() {
      nowMillis = 0;
      held = false;
      score = 0;
      lastMessage = "Listo";
    }
  };
}
