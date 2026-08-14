import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  RUN_REPLAY_CONTRACT_VERSION,
  RUN_REPLAY_SCHEMA,
  decodeRunReplayRecords,
  encodeRunReplayRecord
} from "@motion-levels-games/replay-runtime";
import type { GameSessionState } from "@motion-levels-games/runtime";
import {
  SESSION_HISTORY_CONTRACT_VERSION,
  SESSION_HISTORY_SCHEMA,
  type SessionHistoryVisit
} from "@motion-levels-games/session-history";
import { floorHeight, floorRgbBytes, floorWidth, pressureBitsetBytes, type PresentedFrame } from "../src/controllerProtocol.ts";
import {
  defaultReplayMaxLocalBytes,
  normalizeReplayMaxLocalBytes,
  RunReplayArchive
} from "../src/runReplayArchive.ts";
import { SessionHistoryRecorder } from "../src/sessionHistoryRecorder.ts";
import { SessionHistoryStore } from "../src/sessionHistoryStore.ts";

const revision = "1".repeat(40);

test("presented frames stay in their desired-sequence run across late and repeated boundaries", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-old", "run-new"]);
  const archive = new RunReplayArchive(store, { now: () => 2_000 });
  archive.start(startInput("run-old", 10n));
  archive.requestFinish("run-old", "finished", 10n);

  archive.observePresentedFrame(frame(1n, 10n, 0x11), 100);
  archive.observePresentedFrame(frame(2n, 10n, 0x22), 100);
  archive.start(startInput("run-new", 11n));
  archive.observePresentedFrame(frame(3n, 10n, 0x33), 100);
  archive.observePresentedFrame(frame(4n, 11n, 0x44), 0);
  archive.requestFinish("run-new", "finished", 11n);
  archive.observePresentedFrame(frame(5n, 12n, 0x55), 0);
  await archive.drain();

  const oldRecords = replayRecords(root, "run-old");
  const newRecords = replayRecords(root, "run-new");
  assert.deepEqual(oldRecords.filter((record) => record.type === "frame").map((record) => record.presentationSequence), ["1", "2", "3"]);
  assert.deepEqual(newRecords.filter((record) => record.type === "frame").map((record) => record.presentationSequence), ["4"]);
  assert.equal(oldRecords.at(-1)?.type, "footer");
  assert.equal(newRecords.at(-1)?.type, "footer");
  assert.equal(store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-old")?.status, "pending_upload");
  assert.equal(store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-new")?.status, "pending_upload");
});

test("shutdown finalizes a run without controller acknowledgement as a recoverable partial", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-force"]);
  const archive = new RunReplayArchive(store, { now: () => 3_000 });
  archive.start(startInput("run-force", 1n));
  archive.observePresentedFrame(frame(1n, 1n, 0xaa), 20);
  archive.forceFinishAll();
  await archive.drain();

  const records = replayRecords(root, "run-force");
  const footer = records.at(-1);
  assert.equal(footer?.type, "footer");
  if (footer?.type === "footer") {
    assert.equal(footer.partial, true);
    assert.equal(footer.frameCount, 1);
  }
  const asset = store.getVisit("visit-replay").recordings.find((candidate) => candidate.runId === "run-force");
  assert.equal(asset?.status, "partial");
  assert.match(asset?.sha256 ?? "", /^[0-9a-f]{64}$/u);
});

test("implicit supersede keeps late old-run presentations through the new run boundary", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-implicit-old", "run-implicit-new"]);
  const archive = new RunReplayArchive(store, { now: () => 2_500 });
  archive.start(startInput("run-implicit-old", 10n));
  archive.start(startInput("run-implicit-new", 20n));
  archive.observePresentedFrame(frame(1n, 19n, 0x11), 90);
  archive.observePresentedFrame(frame(2n, 19n, 0x22), 90);
  archive.observePresentedFrame(frame(3n, 20n, 0x33), 0);
  archive.requestFinish("run-implicit-new", "finished", 20n);
  archive.observePresentedFrame(frame(4n, 21n, 0x44), 0);
  await archive.drain();

  assert.deepEqual(replayRecords(root, "run-implicit-old")
    .filter((record) => record.type === "frame")
    .map((record) => record.presentationSequence), ["1", "2"]);
  assert.deepEqual(replayRecords(root, "run-implicit-new")
    .filter((record) => record.type === "frame")
    .map((record) => record.presentationSequence), ["3"]);
});

test("startup truncates a torn journal and publishes a partial gzip replay", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-crash"]);
  store.upsertRecording("visit-replay", {
    id: "run-replay-run-crash",
    scope: "run",
    status: "recording",
    selectionId: "selection-replay",
    runId: "run-crash",
    linkedRunIds: ["run-crash"],
    backend: "venue-runtime-replay",
    localPath: "replays/run-crash.mlrun.jsonl.gz",
    fileName: "run-crash.mlrun.jsonl.gz",
    contentType: "application/vnd.motion-levels.run-replay+jsonl"
  });
  const directory = join(root, "visit-replay", "replays");
  mkdirSync(directory, { recursive: true });
  const header = encodeRunReplayRecord({
    type: "header",
    schema: RUN_REPLAY_SCHEMA,
    contractVersion: RUN_REPLAY_CONTRACT_VERSION,
    sessionId: "visit-replay",
    selectionId: "selection-replay",
    runId: "run-crash",
    gameId: "ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceRevision: revision,
    width: floorWidth,
    height: floorHeight,
    pixelFormat: "rgb24",
    pressureFormat: "row-major-bitset-lsb0",
    frameSource: "presented-frame",
    firstDesiredSequence: "1",
    startedAtUnixMillis: 1_000
  });
  writeFileSync(join(directory, "run-crash.mlrun.jsonl.partial"), `${header}{"type":"frame"`, { mode: 0o600 });

  const recovered = new RunReplayArchive(store, { now: () => 4_000 });
  await recovered.drain();
  const records = replayRecords(root, "run-crash");
  const footer = records.at(-1);
  assert.equal(footer?.type, "footer");
  if (footer?.type === "footer") assert.equal(footer.partial, true);
  assert.equal(store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-crash")?.status, "partial");
});

test("camera recovery never treats an open gameplay replay as a camera capture", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-not-camera"]);
  store.upsertRecording("visit-replay", {
    id: "run-replay-run-not-camera",
    scope: "run",
    status: "recording",
    selectionId: "selection-replay",
    runId: "run-not-camera",
    linkedRunIds: ["run-not-camera"],
    backend: "venue-runtime-replay",
    localPath: "replays/run-not-camera.mlrun.jsonl.gz",
    fileName: "run-not-camera.mlrun.jsonl.gz",
    contentType: "application/vnd.motion-levels.run-replay+jsonl"
  });
  let cameraBoundaries = 0;
  const recorder = new SessionHistoryRecorder(store, {
    recordingClient: {
      onBoundary() {
        cameraBoundaries += 1;
        return null;
      }
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recorder.health().recordingConfigured, true);
  assert.equal(cameraBoundaries, 0);
});

test("startup prunes only integrity-checked complete replays already synced to the HTTPS platform", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-synced"]);
  const writer = new RunReplayArchive(store, { now: () => 5_000 });
  writer.start(startInput("run-synced", 1n));
  writer.observePresentedFrame(frame(1n, 1n, 0x77), 20);
  writer.requestFinish("run-synced", "finished", 1n);
  writer.observePresentedFrame(frame(2n, 2n, 0x88), 40);
  await writer.drain();
  const local = store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-synced");
  assert.ok(local?.localPath && local.sha256 && local.byteSize);
  store.upsertRecording("visit-replay", {
    ...local,
    status: "complete",
    remoteUrl: "https://platform.example/api/recording-objects/upload-1",
    downloadUrl: "https://platform.example/api/recording-objects/upload-1/download"
  });

  const recovered = new RunReplayArchive(store, {
    now: () => 6_000,
    maxLocalBytes: 1,
    platformUrl: "https://platform.example"
  });
  await recovered.drain();
  const pruned = store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-synced");
  assert.equal(pruned?.status, "complete");
  assert.equal(pruned?.localPath, undefined);
  assert.equal(pruned?.metadata?.localPruned, true);
  assert.throws(() => recovered.read("visit-replay", "run-synced"), /not found/u);

  recovered.reconcileRecording(pruned!);
  recovered.reconcileRecording(pruned!);
  await recovered.drain();
  assert.equal(store.getVisit("visit-replay").recordings.filter((asset) => asset.runId === "run-synced").length, 1);
});

test("local retention fails closed for invalid limits and never prunes an uploaded partial", async (context) => {
  assert.equal(normalizeReplayMaxLocalBytes(0), defaultReplayMaxLocalBytes);
  assert.equal(normalizeReplayMaxLocalBytes("broken"), defaultReplayMaxLocalBytes);
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-partial-uploaded"]);
  const archive = new RunReplayArchive(store, {
    now: () => 7_000,
    maxLocalBytes: 1,
    platformUrl: "https://platform.example"
  });
  archive.start(startInput("run-partial-uploaded", 1n));
  archive.observePresentedFrame(frame(1n, 1n, 0x99), 20);
  archive.forceFinishAll();
  await archive.drain();
  const partial = store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-partial-uploaded");
  assert.ok(partial?.localPath);
  const uploaded = store.upsertRecording("visit-replay", {
    ...partial!,
    status: "complete",
    remoteUrl: "https://platform.example/api/recording-objects/upload-partial",
    downloadUrl: "https://platform.example/api/recording-objects/upload-partial/download"
  });
  archive.reconcileRecording(uploaded);
  await archive.drain();
  assert.ok(store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-partial-uploaded")?.localPath);
});

test("startup repairs a complete remote asset left with a stale localPath after unlink", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-prune-repair"]);
  const writer = new RunReplayArchive(store, { now: () => 8_000 });
  writer.start(startInput("run-prune-repair", 1n));
  writer.observePresentedFrame(frame(1n, 1n, 0x66), 20);
  writer.requestFinish("run-prune-repair", "finished", 1n);
  writer.observePresentedFrame(frame(2n, 2n, 0x77), 40);
  await writer.drain();
  const local = store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-prune-repair");
  assert.ok(local?.localPath);
  const complete = store.upsertRecording("visit-replay", {
    ...local!,
    status: "complete",
    remoteUrl: "https://platform.example/api/recording-objects/upload-repair",
    downloadUrl: "https://platform.example/api/recording-objects/upload-repair/download"
  });
  unlinkSync(join(root, "visit-replay", complete.localPath!));

  const recovered = new RunReplayArchive(store, {
    now: () => 9_000,
    platformUrl: "https://platform.example"
  });
  await recovered.drain();
  const repaired = store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-prune-repair");
  assert.equal(repaired?.localPath, undefined);
  assert.equal(repaired?.metadata?.localPruned, true);
  assert.equal(repaired?.metadata?.localPruneRecovered, true);
});

function temporaryRoot(context: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "motion-levels-run-replay-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function historyStore(root: string, runIds: string[]): SessionHistoryStore {
  const store = new SessionHistoryStore(root, () => 1_000);
  const visit: SessionHistoryVisit = {
    schema: SESSION_HISTORY_SCHEMA,
    contractVersion: SESSION_HISTORY_CONTRACT_VERSION,
    id: "visit-replay",
    status: "active",
    startedAtUnixMillis: 1_000,
    updatedAtUnixMillis: 1_000,
    teamName: "Equipo",
    players: [],
    recordingPolicy: { scope: "off" },
    selections: [{
      id: "selection-replay",
      ordinal: 1,
      gameId: "ping-pong",
      engineGame: "motion-levels-games:ping-pong",
      manifestId: "ping-pong",
      label: "Ping pong",
      sourceKind: "motion_levels_games",
      sourceRevision: revision,
      difficulty: "medium",
      config: {},
      teamName: "Equipo",
      players: [],
      selectedAtUnixMillis: 1_000,
      runs: runIds.map((id, index) => ({
        id,
        ordinal: index + 1,
        reason: index === 0 ? "initial" : "restart",
        status: "running",
        startedAtUnixMillis: 1_000,
        engineElapsedMillis: 0,
        gameplayElapsedMillis: 0,
        pausedMillis: 0,
        phaseDurations: {}
      }))
    }],
    recordings: [],
    activeSelectionId: "selection-replay",
    activeRunId: runIds.at(-1),
    lastSequence: 0
  };
  store.createVisit(visit);
  return store;
}

function startInput(runId: string, firstDesiredSequence: bigint) {
  return {
    sessionId: "visit-replay",
    selectionId: "selection-replay",
    runId,
    gameId: "ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceRevision: revision,
    width: floorWidth,
    height: floorHeight,
    firstDesiredSequence,
    state: state(0)
  };
}

function state(clockMillis: number): GameSessionState {
  return {
    gameId: "ping-pong",
    clockMillis,
    paused: false,
    frame: { width: floorWidth, height: floorHeight, cells: [] },
    snapshot: {
      currentGame: "ping-pong",
      label: "Ping pong",
      phase: "running",
      score: 0,
      lives: -1,
      elapsedMillis: clockMillis,
      remainingMillis: 60_000 - clockMillis,
      playerCount: 0,
      players: [],
      activeTargets: 0,
      success: false,
      lastEventCue: "none",
      lastEventMessage: ""
    },
    events: []
  };
}

function frame(presentationSequence: bigint, desiredSequence: bigint, byte: number): PresentedFrame {
  const rgb = new Uint8Array(floorRgbBytes);
  rgb.fill(byte);
  const pressureBits = new Uint8Array(pressureBitsetBytes);
  pressureBits[0] = byte;
  return {
    presentationSequence,
    desiredSequence,
    presentedUnixNanos: presentationSequence * 20_000_000n,
    width: floorWidth,
    height: floorHeight,
    rgb,
    pressureBits,
    fadeRatio: 0
  };
}

function replayRecords(root: string, runId: string) {
  const bytes = readFileSync(join(root, "visit-replay", "replays", `${runId}.mlrun.jsonl.gz`));
  return decodeRunReplayRecords(gunzipSync(bytes).toString("utf8"));
}
