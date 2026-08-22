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
  RUN_REPLAY_CONTRACT_VERSION,
  RUN_REPLAY_MAX_PART_BODY_RECORDS,
  RUN_REPLAY_MAX_PART_FRAMES,
  RUN_REPLAY_MAX_PART_JSONL_BYTES,
  RUN_REPLAY_SCHEMA,
  decodeRunReplayByteField,
  decodeRunReplayRecords,
  encodeRunReplayByteField,
  encodeRunReplayRecord,
  type RunReplayHeaderRecord,
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

test("run replay byte deltas reconstruct exact RGB and pressure payloads", () => {
  const previous = new Uint8Array(64);
  const current = previous.slice();
  current.set([1, 2, 3], 7);
  current.set([9, 8], 44);
  const field = encodeRunReplayByteField(current, previous);
  assert.equal(field.encoding, "delta");
  assert.deepEqual(decodeRunReplayByteField(field, current.byteLength, previous), current);
  assert.deepEqual(
    decodeRunReplayByteField(encodeRunReplayByteField(current, undefined), current.byteLength),
    current
  );
});

test("run replay NDJSON requires a final footer with coherent counts", () => {
  const runHeader: RunReplayHeaderRecord = {
    type: "header",
    schema: RUN_REPLAY_SCHEMA,
    contractVersion: RUN_REPLAY_CONTRACT_VERSION,
    sessionId: "visit-1",
    selectionId: "selection-1",
    runId: "run-1",
    gameId: "ping-pong-v2",
    engineGame: "motion-levels-games:ping-pong-v2",
    sourceRevision: "1".repeat(40),
    width: 16,
    height: 32,
    pixelFormat: "rgb24",
    pressureFormat: "row-major-bitset-lsb0",
    frameSource: "presented-frame",
    firstDesiredSequence: "1",
    startedAtUnixMillis: 1_000
  };
  const headerLine = encodeRunReplayRecord(runHeader);
  assert.throws(() => decodeRunReplayRecords(headerLine), /footer is missing/u);
  const invalidFooter = encodeRunReplayRecord({
    type: "footer",
    recordSequence: 1,
    endedAtUnixMillis: 2_000,
    outcome: "finished",
    partial: false,
    frameCount: 1,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 0
  });
  assert.throws(() => decodeRunReplayRecords(headerLine + invalidFooter), /counts do not match/u);
  const outsideInput = encodeRunReplayRecord({
    type: "input",
    recordSequence: 1,
    occurredAtUnixMillis: 1_500,
    engineAtMillis: 500,
    source: "physical",
    x: 16,
    y: 0,
    pressed: true
  });
  const inputFooter = encodeRunReplayRecord({
    type: "footer",
    recordSequence: 2,
    endedAtUnixMillis: 2_000,
    outcome: "finished",
    partial: false,
    frameCount: 0,
    inputCount: 1,
    eventCount: 0,
    checkpointCount: 0
  });
  assert.throws(() => decodeRunReplayRecords(headerLine + outsideInput + inputFooter), /outside the declared floor/u);
});

test("multipart run replay fields and footer semantics are strict and backward compatible", () => {
  const assetId = `run-replay-${"a".repeat(64)}-part-000000`;
  const multipartHeader: RunReplayHeaderRecord = {
    type: "header",
    schema: RUN_REPLAY_SCHEMA,
    contractVersion: RUN_REPLAY_CONTRACT_VERSION,
    sessionId: "visit-multipart",
    selectionId: "selection-multipart",
    runId: "run-multipart",
    gameId: "ping-pong-v2",
    engineGame: "motion-levels-games:ping-pong-v2",
    sourceRevision: "1".repeat(40),
    width: 1,
    height: 1,
    pixelFormat: "rgb24",
    pressureFormat: "row-major-bitset-lsb0",
    frameSource: "presented-frame",
    firstDesiredSequence: "1",
    startedAtUnixMillis: 1_000,
    assetId,
    partIndex: 0,
    runFrameOffset: 0
  };
  const frame = encodeRunReplayRecord({
    type: "frame",
    recordSequence: 1,
    presentationSequence: "1",
    desiredSequence: "1",
    presentedUnixNanos: "1000000",
    engineAtMillis: 0,
    fadeRatio: 0,
    rgb: { encoding: "keyframe", dataBase64: "AAAA" },
    pressure: { encoding: "keyframe", dataBase64: "AA==" }
  });
  const finalFooter = encodeRunReplayRecord({
    type: "footer",
    recordSequence: 2,
    endedAtUnixMillis: 2_000,
    outcome: "finished",
    partial: false,
    frameCount: 1,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 0,
    firstPresentationSequence: "1",
    lastPresentationSequence: "1",
    partIndex: 0,
    isFinalPart: true,
    partCount: 1
  });
  assert.equal(decodeRunReplayRecords(encodeRunReplayRecord(multipartHeader) + frame + finalFooter).length, 3);
  assert.throws(() => encodeRunReplayRecord({ ...multipartHeader, assetId: undefined }), /present together/u);
  assert.throws(() => encodeRunReplayRecord({
    ...multipartHeader,
    assetId: `run-replay-${"a".repeat(64)}-part-000001`
  }), /suffix does not match/u);
  assert.throws(() => decodeRunReplayRecords(encodeRunReplayRecord(multipartHeader) + encodeRunReplayRecord({
    type: "frame",
    recordSequence: 1,
    presentationSequence: "1",
    desiredSequence: "1",
    presentedUnixNanos: "1000000",
    engineAtMillis: 0,
    fadeRatio: 0,
    rgb: { encoding: "delta", dataBase64: "" },
    pressure: { encoding: "delta", dataBase64: "" }
  }) + finalFooter), /begin with a keyframe/u);
  assert.throws(() => encodeRunReplayRecord({
    type: "footer",
    recordSequence: 1,
    endedAtUnixMillis: 2_000,
    outcome: "continued",
    partial: false,
    frameCount: 0,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 0,
    partIndex: 0,
    isFinalPart: true,
    partCount: 1
  }), /final part outcome/u);
  assert.throws(() => encodeRunReplayRecord({
    type: "footer",
    recordSequence: 1,
    endedAtUnixMillis: 2_000,
    outcome: "finished",
    partial: false,
    frameCount: 0,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 0,
    partIndex: 0,
    isFinalPart: true,
    partCount: 2
  }), /partCount is invalid/u);
  assert.throws(() => encodeRunReplayRecord({
    type: "footer",
    recordSequence: 1,
    endedAtUnixMillis: 2_000,
    outcome: "finished",
    partial: false,
    frameCount: 0,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 0,
    partIndex: 0,
    isFinalPart: false
  }), /continued part footer/u);
});

test("shared run replay decoder enforces the browser-safe multipart profile", () => {
  const assetId = `run-replay-${"b".repeat(64)}-part-000000`;
  const headerLine = encodeRunReplayRecord({
    type: "header",
    schema: RUN_REPLAY_SCHEMA,
    contractVersion: RUN_REPLAY_CONTRACT_VERSION,
    sessionId: "visit-limits",
    selectionId: "selection-limits",
    runId: "run-limits",
    gameId: "ping-pong-v2",
    engineGame: "motion-levels-games:ping-pong-v2",
    sourceRevision: "1".repeat(40),
    width: 1,
    height: 1,
    pixelFormat: "rgb24",
    pressureFormat: "row-major-bitset-lsb0",
    frameSource: "presented-frame",
    firstDesiredSequence: "1",
    startedAtUnixMillis: 1_000,
    assetId,
    partIndex: 0,
    runFrameOffset: 0
  });
  const frames = Array.from({ length: RUN_REPLAY_MAX_PART_FRAMES + 1 }, (_value, index) => encodeRunReplayRecord({
    type: "frame",
    recordSequence: index + 1,
    presentationSequence: String(index + 1),
    desiredSequence: String(index + 1),
    presentedUnixNanos: String((index + 1) * 1_000_000),
    engineAtMillis: index,
    fadeRatio: 0,
    rgb: index === 0
      ? { encoding: "keyframe" as const, dataBase64: "AAAA" }
      : { encoding: "delta" as const, dataBase64: "" },
    pressure: index === 0
      ? { encoding: "keyframe" as const, dataBase64: "AA==" }
      : { encoding: "delta" as const, dataBase64: "" }
  })).join("");
  const frameFooter = encodeRunReplayRecord({
    type: "footer",
    recordSequence: RUN_REPLAY_MAX_PART_FRAMES + 2,
    endedAtUnixMillis: 2_000,
    outcome: "finished",
    partial: false,
    frameCount: RUN_REPLAY_MAX_PART_FRAMES + 1,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 0,
    firstPresentationSequence: "1",
    lastPresentationSequence: String(RUN_REPLAY_MAX_PART_FRAMES + 1),
    partIndex: 0,
    isFinalPart: true,
    partCount: 1
  });
  assert.throws(() => decodeRunReplayRecords(headerLine + frames + frameFooter), /maximum frame count/u);

  const inputs = Array.from({ length: RUN_REPLAY_MAX_PART_BODY_RECORDS + 1 }, (_value, index) => encodeRunReplayRecord({
    type: "input",
    recordSequence: index + 1,
    occurredAtUnixMillis: 1_000 + index,
    engineAtMillis: index,
    source: "remote",
    x: 0,
    y: 0,
    pressed: index % 2 === 0
  })).join("");
  const inputFooter = encodeRunReplayRecord({
    type: "footer",
    recordSequence: RUN_REPLAY_MAX_PART_BODY_RECORDS + 2,
    endedAtUnixMillis: 2_000,
    outcome: "finished",
    partial: false,
    frameCount: 0,
    inputCount: RUN_REPLAY_MAX_PART_BODY_RECORDS + 1,
    eventCount: 0,
    checkpointCount: 0,
    partIndex: 0,
    isFinalPart: true,
    partCount: 1
  });
  assert.throws(() => decodeRunReplayRecords(headerLine + inputs + inputFooter), /maximum body record count/u);
  assert.throws(() => decodeRunReplayRecords("x".repeat(RUN_REPLAY_MAX_PART_JSONL_BYTES + 1)), /maximum encoded size/u);
});

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
