import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
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
  replayPartAssetId,
  RunReplayArchive
} from "../src/runReplayArchive.ts";
import { SessionHistoryRecorder } from "../src/sessionHistoryRecorder.ts";
import { SessionHistoryStore, type SessionHistoryStoreDiagnostics } from "../src/sessionHistoryStore.ts";

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
  const oldAsset = store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-old");
  const newAsset = store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-new");
  assert.equal(oldAsset?.status, "pending_upload", JSON.stringify(oldAsset));
  assert.equal(newAsset?.status, "pending_upload", JSON.stringify(newAsset));
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
  assert.equal(asset?.status, "partial", JSON.stringify(asset));
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

test("multipart capture rolls at 10,000 frames without losing or duplicating the 10,001st presentation", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-multipart"]);
  const archive = new RunReplayArchive(store, { now: () => 3_500 });
  archive.start({ ...startInput("run-multipart", 1n), width: 1, height: 1 });
  for (let index = 1; index <= 9_999; index += 1) {
    archive.observePresentedFrame(smallFrame(BigInt(index), BigInt(index), index), index * 20);
  }
  assert.equal(store.getVisit("visit-replay").recordings.length, 1);
  archive.observePresentedFrame(smallFrame(10_000n, 10_000n, 10_000), 200_000);
  assert.equal(store.getVisit("visit-replay").recordings.length, 1);
  archive.observePresentedFrame(smallFrame(10_001n, 10_001n, 10_001), 200_020);
  assert.equal(store.getVisit("visit-replay").recordings.length, 2);
  archive.requestFinish("run-multipart", "finished", 10_001n);
  archive.observePresentedFrame(smallFrame(10_002n, 10_002n, 0), 200_040);
  await archive.drain();

  const first = replayRecords(root, "run-multipart", 0);
  const second = replayRecords(root, "run-multipart", 1);
  const firstHeader = first[0];
  const secondHeader = second[0];
  const firstFooter = first.at(-1);
  const secondFooter = second.at(-1);
  assert.equal(firstHeader?.type, "header");
  assert.equal(secondHeader?.type, "header");
  if (firstHeader?.type === "header" && secondHeader?.type === "header") {
    assert.equal(firstHeader.assetId, replayPartAssetId("run-multipart", 0));
    assert.equal(firstHeader.partIndex, 0);
    assert.equal(firstHeader.runFrameOffset, 0);
    assert.equal(secondHeader.assetId, replayPartAssetId("run-multipart", 1));
    assert.equal(secondHeader.partIndex, 1);
    assert.equal(secondHeader.runFrameOffset, 10_000);
  }
  assert.equal(firstFooter?.type, "footer");
  assert.equal(secondFooter?.type, "footer");
  if (firstFooter?.type === "footer" && secondFooter?.type === "footer") {
    assert.equal(firstFooter.frameCount, 10_000);
    assert.equal(firstFooter.outcome, "continued");
    assert.equal(firstFooter.partial, false);
    assert.equal(firstFooter.isFinalPart, false);
    assert.equal(firstFooter.partCount, undefined);
    assert.equal(secondFooter.frameCount, 1);
    assert.equal(secondFooter.isFinalPart, true);
    assert.equal(secondFooter.partCount, 2);
  }
  const secondFrame = second.find((record) => record.type === "frame");
  assert.equal(secondFrame?.type, "frame");
  if (secondFrame?.type === "frame") {
    assert.equal(secondFrame.presentationSequence, "10001");
    assert.equal(secondFrame.rgb.encoding, "keyframe");
    assert.equal(secondFrame.pressure.encoding, "keyframe");
  }
  assert.deepEqual(
    [...first, ...second].filter((record) => record.type === "frame")
      .map((record) => record.presentationSequence),
    Array.from({ length: 10_001 }, (_value, index) => String(index + 1))
  );
});

test("multipart capture rolls before body-record and JSONL byte limits", async (context) => {
  const recordRoot = temporaryRoot(context);
  const recordStore = historyStore(recordRoot, ["run-record-limit"]);
  const recordArchive = new RunReplayArchive(recordStore, {
    now: () => 3_600,
    maxPartBodyRecords: 3
  });
  recordArchive.start(startInput("run-record-limit", 1n));
  for (let index = 1; index <= 3; index += 1) {
    recordArchive.observeInput("run-record-limit", {
      source: "remote",
      x: index,
      y: 0,
      pressed: true,
      occurredAtUnixMillis: 3_600 + index,
      engineAtMillis: index
    });
  }
  recordArchive.forceFinishAll("runtime_interrupted");
  await recordArchive.drain();
  assert.equal(recordStore.getVisit("visit-replay").recordings.length, 2);
  assert.equal([...replayRecords(recordRoot, "run-record-limit", 0), ...replayRecords(recordRoot, "run-record-limit", 1)]
    .filter((record) => record.type === "input").length, 3);

  const byteRoot = temporaryRoot(context);
  const byteStore = historyStore(byteRoot, ["run-byte-limit"]);
  const byteArchive = new RunReplayArchive(byteStore, {
    now: () => 3_700,
    maxPartJsonlBytes: 1_800
  });
  byteArchive.start(startInput("run-byte-limit", 1n));
  for (let index = 0; index < 20; index += 1) {
    byteArchive.observeInput("run-byte-limit", {
      source: "remote",
      x: index % floorWidth,
      y: 0,
      pressed: index % 2 === 0,
      occurredAtUnixMillis: 3_700 + index,
      engineAtMillis: index
    });
  }
  byteArchive.forceFinishAll("runtime_interrupted");
  await byteArchive.drain();
  const byteAssets = byteStore.getVisit("visit-replay").recordings;
  assert.ok(byteAssets.length > 1);
  const capturedInputs = byteAssets.flatMap((_asset, partIndex) => replayRecords(byteRoot, "run-byte-limit", partIndex))
    .filter((record) => record.type === "input");
  assert.equal(capturedInputs.length, 20);
});

test("rollover syncs the predecessor before publishing its successor and recovers a fault at that boundary", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-rollover-order"]);
  const stages: string[] = [];
  let interrupt = true;
  const archive = new RunReplayArchive(store, {
    now: () => 3_800,
    maxPartFrames: 1,
    onDurabilityStage(stage, part) {
      stages.push(`${stage}:${part.partIndex}`);
      if (interrupt && stage === "part_manifest_persisted" && part.partIndex === 1) {
        interrupt = false;
        throw new Error("simulated exit after successor manifest");
      }
    }
  });
  archive.start({ ...startInput("run-rollover-order", 1n), width: 1, height: 1 });
  archive.observePresentedFrame(smallFrame(1n, 1n, 1), 20);
  archive.observePresentedFrame(smallFrame(2n, 2n, 2), 40);
  await archive.drain();

  const boundary = stages.slice(stages.indexOf("predecessor_synced:0"));
  assert.deepEqual(boundary, [
    "predecessor_synced:0",
    "part_header_synced:1",
    "part_manifest_persisted:1"
  ]);
  const interrupted = store.getVisit("visit-replay").recordings
    .filter((asset) => asset.runId === "run-rollover-order");
  assert.deepEqual(interrupted.map((asset) => asset.status), ["failed", "failed"]);

  const recoveredStore = new SessionHistoryStore(root, () => 3_900);
  const recovered = new RunReplayArchive(recoveredStore, { now: () => 3_900 });
  await recovered.drain();
  const first = replayRecords(root, "run-rollover-order", 0);
  const second = replayRecords(root, "run-rollover-order", 1);
  const firstFooter = first.at(-1);
  const secondHeader = second[0];
  const secondFooter = second.at(-1);
  assert.equal(firstFooter?.type, "footer");
  assert.equal(secondHeader?.type, "header");
  assert.equal(secondFooter?.type, "footer");
  if (firstFooter?.type === "footer" && secondHeader?.type === "header" && secondFooter?.type === "footer") {
    assert.equal(firstFooter.frameCount, 1);
    assert.equal(firstFooter.outcome, "continued");
    assert.equal(secondHeader.runFrameOffset, 1);
    assert.equal(secondFooter.frameCount, 0);
    assert.equal(secondFooter.partial, true);
    assert.equal(secondFooter.partCount, 2);
  }
});

test("a manifest checkpoint failure after the history WAL preserves the durable journal for recovery", async (context) => {
  const root = temporaryRoot(context);
  let failAfterJournal = false;
  const store = historyStore(root, ["run-post-wal-fault"], {
    onTransitionStage(stage) {
      if (stage === "after_journal" && failAfterJournal) {
        failAfterJournal = false;
        throw new Error("simulated manifest checkpoint failure");
      }
    }
  });
  const runId = "run-post-wal-fault";
  const assetId = replayPartAssetId(runId, 0);
  const journalPath = join(root, "visit-replay", "replays", `${assetId}.mlrun.jsonl.partial`);
  failAfterJournal = true;
  const archive = new RunReplayArchive(store, { now: () => 3_950 });
  assert.equal(archive.start(startInput(runId, 1n)), null);
  assert.equal(existsSync(journalPath), true, "the header journal survives the failed manifest checkpoint");
  assert.equal(store.getVisit("visit-replay").recordings.find((asset) => asset.id === assetId)?.status, "failed");

  const recoveredStore = new SessionHistoryStore(root, () => 4_000);
  const recovered = new RunReplayArchive(recoveredStore, { now: () => 4_000 });
  await recovered.drain();
  const recoveredAsset = recoveredStore.getVisit("visit-replay").recordings.find((asset) => asset.id === assetId);
  assert.equal(recoveredAsset?.status, "partial");
  assert.equal(existsSync(journalPath), false);
  const footer = replayRecords(root, runId).at(-1);
  assert.equal(footer?.type, "footer");
  if (footer?.type === "footer") assert.equal(footer.partial, true);
});

test("startup recovery never captures a run created and finalized after the archive constructor", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-after-constructor"]);
  const archive = new RunReplayArchive(store, { now: () => 4_025 });
  const started = archive.start(startInput("run-after-constructor", 1n));
  assert.ok(started);
  archive.forceFinishAll();
  await archive.drain();

  const assets = store.getVisit("visit-replay").recordings.filter((asset) => asset.id === started.id);
  assert.equal(assets.length, 1);
  assert.equal(assets[0]?.status, "partial");
  assert.equal(assets[0]?.metadata?.compressionError, undefined);
  const matchingFiles = readdirSync(join(root, "visit-replay", "replays"))
    .filter((name) => name.startsWith(started.id));
  assert.deepEqual(matchingFiles, [`${started.id}.mlrun.jsonl.gz`]);
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
  const records = legacyReplayRecords(root, "run-crash");
  const footer = records.at(-1);
  assert.equal(footer?.type, "footer");
  if (footer?.type === "footer") assert.equal(footer.partial, true);
  assert.equal(store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-crash")?.status, "partial");
  const legacyRead = recovered.read("visit-replay", "run-crash");
  closeSync(legacyRead.fd);
});

test("recovery does not treat a manifest-only successor as durable", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-phantom"]);
  store.upsertRecording("visit-replay", multipartAsset("run-phantom", 0, 0));
  store.upsertRecording("visit-replay", multipartAsset("run-phantom", 1, 0));
  writeMultipartJournal(root, "run-phantom", 0, 0);

  const recovered = new RunReplayArchive(store, { now: () => 4_100 });
  await recovered.drain();
  const assets = store.getVisit("visit-replay").recordings
    .filter((asset) => asset.runId === "run-phantom")
    .sort((left, right) => Number(left.metadata?.partIndex) - Number(right.metadata?.partIndex));
  assert.equal(assets[0]?.status, "partial");
  assert.equal(assets[0]?.metadata?.isFinalPart, true);
  assert.equal(assets[0]?.metadata?.partCount, 1);
  assert.equal(assets[1]?.status, "failed");
  const footer = replayRecords(root, "run-phantom", 0).at(-1);
  assert.equal(footer?.type, "footer");
  if (footer?.type === "footer") {
    assert.equal(footer.isFinalPart, true);
    assert.equal(footer.partCount, 1);
    assert.equal(footer.partial, true);
  }
});

test("recovery adopts a header-only journal left before its manifest asset", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-orphan-header"]);
  const runId = "run-orphan-header";
  writeMultipartJournal(root, runId, 0, 0);
  const assetId = replayPartAssetId(runId, 0);
  const journalPath = join(root, "visit-replay", "replays", `${assetId}.mlrun.jsonl.partial`);
  assert.equal(store.getVisit("visit-replay").recordings.some((asset) => asset.id === assetId), false);

  const recovered = new RunReplayArchive(store, { now: () => 4_150 });
  await recovered.drain();
  const assets = store.getVisit("visit-replay").recordings.filter((asset) => asset.id === assetId);
  assert.equal(assets.length, 1);
  assert.equal(assets[0]?.status, "partial");
  assert.equal(assets[0]?.metadata?.recoveredOrphanJournal, true);
  assert.equal(assets[0]?.metadata?.isFinalPart, true);
  assert.equal(assets[0]?.metadata?.partCount, 1);
  assert.equal(existsSync(journalPath), false, "the adopted journal must not leak beside its final gzip");
  const footer = replayRecords(root, runId, 0).at(-1);
  assert.equal(footer?.type, "footer");
  if (footer?.type === "footer") {
    assert.equal(footer.outcome, "runtime_interrupted");
    assert.equal(footer.partial, true);
    assert.equal(footer.isFinalPart, true);
    assert.equal(footer.partCount, 1);
  }
});

test("a torn unowned part-zero header is removed and the same run start retries without leaking it", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-torn-orphan-start"]);
  const runId = "run-torn-orphan-start";
  const assetId = replayPartAssetId(runId, 0);
  const directory = join(root, "visit-replay", "replays");
  const journalPath = join(directory, `${assetId}.mlrun.jsonl.partial`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(journalPath, '{"type":"header"', { mode: 0o600 });

  const archive = new RunReplayArchive(store, { now: () => 4_175 });
  assert.equal(archive.start(startInput(runId, 1n))?.id, assetId);
  archive.forceFinishAll();
  await archive.drain();

  assert.equal(existsSync(journalPath), false);
  assert.equal(readdirSync(directory).filter((name) => name.startsWith(assetId)).length, 1);
  const assets = store.getVisit("visit-replay").recordings.filter((asset) => asset.id === assetId);
  assert.equal(assets.length, 1);
  assert.equal(assets[0]?.status, "partial");
  assert.equal(assets[0]?.metadata?.compressionError, undefined);
  const footer = replayRecords(root, runId, 0).at(-1);
  assert.equal(footer?.type, "footer");
  if (footer?.type === "footer") assert.equal(footer.partial, true);
});

test("recovery discards a stale noncontiguous orphan part instead of adopting it", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-stale-orphan"]);
  const runId = "run-stale-orphan";
  const assetId = replayPartAssetId(runId, 2);
  writeMultipartJournal(root, runId, 2, 0);
  const journalPath = join(root, "visit-replay", "replays", `${assetId}.mlrun.jsonl.partial`);

  const recovered = new RunReplayArchive(store, { now: () => 4_180 });
  await recovered.drain();

  assert.equal(store.getVisit("visit-replay").recordings.some((asset) => asset.id === assetId), false);
  assert.equal(existsSync(journalPath), false);
  assert.equal(readdirSync(join(root, "visit-replay", "replays"))
    .some((name) => name.startsWith(`${assetId}.mlrun.jsonl.partial.rejected-`)), true);
});

test("recovery quarantines a nonempty orphan whose header does not match its hashed file identity", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-orphan-name", "run-orphan-header-body"]);
  const assetId = replayPartAssetId("run-orphan-name", 0);
  const directory = join(root, "visit-replay", "replays");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${assetId}.mlrun.jsonl.partial`),
    encodeRunReplayRecord(multipartHeader("run-orphan-header-body", 0, 0)), { mode: 0o600 });

  const recovered = new RunReplayArchive(store, { now: () => 4_190 });
  await recovered.drain();

  assert.equal(store.getVisit("visit-replay").recordings.some((asset) => asset.id === assetId), false);
  assert.equal(readdirSync(directory)
    .some((name) => name.startsWith(`${assetId}.mlrun.jsonl.partial.rejected-`)), true);
});

test("recovery closes a durable successor first and its predecessor as continued", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-rollover-crash"]);
  store.upsertRecording("visit-replay", { ...multipartAsset("run-rollover-crash", 0, 0), status: "failed" });
  store.upsertRecording("visit-replay", multipartAsset("run-rollover-crash", 1, 0));
  writeMultipartJournal(root, "run-rollover-crash", 0, 0);
  writeMultipartJournal(root, "run-rollover-crash", 1, 0);

  const recovered = new RunReplayArchive(store, { now: () => 4_200 });
  await recovered.drain();
  const firstFooter = replayRecords(root, "run-rollover-crash", 0).at(-1);
  const secondFooter = replayRecords(root, "run-rollover-crash", 1).at(-1);
  assert.equal(firstFooter?.type, "footer");
  assert.equal(secondFooter?.type, "footer");
  if (firstFooter?.type === "footer" && secondFooter?.type === "footer") {
    assert.equal(firstFooter.outcome, "continued");
    assert.equal(firstFooter.partial, false);
    assert.equal(firstFooter.isFinalPart, false);
    assert.equal(secondFooter.outcome, "runtime_interrupted");
    assert.equal(secondFooter.partial, true);
    assert.equal(secondFooter.isFinalPart, true);
    assert.equal(secondFooter.partCount, 2);
  }
});

test("a validated remote-only successor keeps its recovering predecessor non-final", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-remote-successor"]);
  const runId = "run-remote-successor";
  store.upsertRecording("visit-replay", multipartAsset(runId, 0, 0));
  writeMultipartJournal(root, runId, 0, 0);
  const successor = multipartAsset(runId, 1, 0);
  store.upsertRecording("visit-replay", {
    ...successor,
    status: "complete",
    localPath: undefined,
    byteSize: 123,
    sha256: "b".repeat(64),
    remoteUrl: "https://platform.example/api/recording-objects/upload-successor",
    downloadUrl: "https://platform.example/api/recording-objects/upload-successor/download",
    metadata: {
      ...successor.metadata,
      frameCount: 0,
      inputCount: 0,
      eventCount: 0,
      checkpointCount: 0,
      outcome: "finished",
      isFinalPart: true,
      partCount: 2,
      localComplete: true,
      localPruned: true
    }
  });

  const recovered = new RunReplayArchive(store, {
    now: () => 4_210,
    platformUrl: "https://platform.example"
  });
  await recovered.drain();

  const predecessorFooter = replayRecords(root, runId, 0).at(-1);
  assert.equal(predecessorFooter?.type, "footer");
  if (predecessorFooter?.type === "footer") {
    assert.equal(predecessorFooter.outcome, "continued");
    assert.equal(predecessorFooter.partial, false);
    assert.equal(predecessorFooter.isFinalPart, false);
    assert.equal(predecessorFooter.partCount, undefined);
  }
  const assets = store.getVisit("visit-replay").recordings.filter((asset) => asset.runId === runId);
  assert.equal(assets.length, 2);
  assert.equal(assets.find((asset) => asset.id === successor.id)?.status, "complete");
  assert.equal(assets.filter((asset) => asset.metadata?.isFinalPart === true).length, 1);
});

test("a successor that fails after continuity validation still keeps its predecessor continued", async (context) => {
  const root = temporaryRoot(context);
  let failSuccessorCheckpoint = false;
  const store = historyStore(root, ["run-successor-recovery-fault"], {
    onTransitionStage(stage) {
      if (stage === "after_journal" && failSuccessorCheckpoint) {
        failSuccessorCheckpoint = false;
        throw new Error("simulated successor recovery checkpoint failure");
      }
    }
  });
  const runId = "run-successor-recovery-fault";
  store.upsertRecording("visit-replay", multipartAsset(runId, 0, 0));
  store.upsertRecording("visit-replay", multipartAsset(runId, 1, 0));
  writeMultipartJournal(root, runId, 0, 0);
  writeMultipartJournal(root, runId, 1, 0);
  failSuccessorCheckpoint = true;

  const recovered = new RunReplayArchive(store, { now: () => 4_215 });
  await recovered.drain();

  const predecessorFooter = replayRecords(root, runId, 0).at(-1);
  const successorRecords = replayRecords(root, runId, 1);
  const successorFooter = successorRecords.at(-1);
  assert.equal(predecessorFooter?.type, "footer");
  assert.equal(successorFooter?.type, "footer");
  if (predecessorFooter?.type === "footer" && successorFooter?.type === "footer") {
    assert.equal(predecessorFooter.outcome, "continued");
    assert.equal(predecessorFooter.partial, false);
    assert.equal(predecessorFooter.isFinalPart, false);
    assert.equal(successorFooter.outcome, "runtime_interrupted");
    assert.equal(successorFooter.partial, true);
    assert.equal(successorFooter.partCount, 2);
  }
  const successor = store.getVisit("visit-replay").recordings
    .find((asset) => asset.id === replayPartAssetId(runId, 1));
  assert.equal(successor?.status, "failed");
  assert.equal(successor?.metadata?.frameCount, 0);
  assert.equal(readdirSync(join(root, "visit-replay", "replays"))
    .filter((name) => name.startsWith(replayPartAssetId(runId, 1))).length, 1,
  "recovery must not create a second terminal journal over the failed durable successor");
});

test("recovery quarantines a successor with a mismatched frame offset and terminates the valid prefix", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-offset-mismatch"]);
  const runId = "run-offset-mismatch";
  const predecessor = {
    ...multipartAsset(runId, 0, 0),
    status: "pending_upload" as const,
    metadata: {
      ...multipartAsset(runId, 0, 0).metadata,
      frameCount: 0,
      outcome: "continued",
      isFinalPart: false,
      localComplete: true
    }
  };
  const directory = join(root, "visit-replay", "replays");
  mkdirSync(directory, { recursive: true });
  const firstFooter = encodeRunReplayRecord({
    type: "footer",
    recordSequence: 1,
    endedAtUnixMillis: 4_225,
    outcome: "continued",
    partial: false,
    frameCount: 0,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 0,
    partIndex: 0,
    isFinalPart: false
  });
  const predecessorBytes = gzipSync(encodeRunReplayRecord(multipartHeader(runId, 0, 0)) + firstFooter);
  writeFileSync(join(root, "visit-replay", predecessor.localPath), predecessorBytes, { mode: 0o600 });
  store.upsertRecording("visit-replay", {
    ...predecessor,
    byteSize: predecessorBytes.byteLength,
    sha256: "0".repeat(64)
  });
  store.upsertRecording("visit-replay", multipartAsset(runId, 1, 9));
  writeMultipartJournal(root, runId, 1, 9);

  const recovered = new RunReplayArchive(store, { now: () => 4_250 });
  await recovered.drain();

  const terminal = store.getVisit("visit-replay").recordings
    .find((asset) => asset.id === replayPartAssetId(runId, 1));
  assert.equal(terminal?.status, "partial");
  assert.equal(terminal?.metadata?.runFrameOffset, 0);
  assert.equal(terminal?.metadata?.isFinalPart, true);
  const terminalHeader = replayRecords(root, runId, 1)[0];
  assert.equal(terminalHeader?.type, "header");
  if (terminalHeader?.type === "header") assert.equal(terminalHeader.runFrameOffset, 0);
  assert.equal(readdirSync(directory).some((name) => name.includes(".partial.rejected-")), true,
    "the rejected successor remains recoverable in quarantine");
});

test("recovery rolls an over-limit final footer into an empty terminal part", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-recovery-footer-rollover"]);
  const runId = "run-recovery-footer-rollover";
  store.upsertRecording("visit-replay", multipartAsset(runId, 0, 0));
  const headerLine = encodeRunReplayRecord(multipartHeader(runId, 0, 0));
  const checkpointLine = encodeRunReplayRecord({
    type: "checkpoint",
    recordSequence: 1,
    occurredAtUnixMillis: 4_250,
    engineAtMillis: 100,
    reason: "periodic",
    paused: false,
    snapshot: { padding: "x".repeat(1_000) }
  });
  const continuedFooterLine = encodeRunReplayRecord({
    type: "footer",
    recordSequence: 2,
    endedAtUnixMillis: 4_300,
    outcome: "continued",
    partial: false,
    frameCount: 0,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 1,
    partIndex: 0,
    isFinalPart: false
  });
  const finalFooterLine = encodeRunReplayRecord({
    type: "footer",
    recordSequence: 2,
    endedAtUnixMillis: 4_300,
    outcome: "runtime_interrupted",
    partial: true,
    frameCount: 0,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 1,
    partIndex: 0,
    isFinalPart: true,
    partCount: 1
  });
  const maximum = Buffer.byteLength(headerLine + checkpointLine + continuedFooterLine);
  assert.ok(Buffer.byteLength(headerLine + checkpointLine + finalFooterLine) > maximum);
  const directory = join(root, "visit-replay", "replays");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${replayPartAssetId(runId, 0)}.mlrun.jsonl.partial`),
    headerLine + checkpointLine, { mode: 0o600 });

  const recovered = new RunReplayArchive(store, { now: () => 4_300, maxPartJsonlBytes: maximum });
  await recovered.drain();
  const firstFooter = replayRecords(root, runId, 0).at(-1);
  const terminalRecords = replayRecords(root, runId, 1);
  const terminalFooter = terminalRecords.at(-1);
  assert.equal(firstFooter?.type, "footer");
  assert.equal(terminalFooter?.type, "footer");
  if (firstFooter?.type === "footer" && terminalFooter?.type === "footer") {
    assert.equal(firstFooter.outcome, "continued");
    assert.equal(firstFooter.isFinalPart, false);
    assert.equal(firstFooter.partial, false);
    assert.equal(terminalRecords.filter((record) => record.type === "frame").length, 0);
    assert.equal(terminalFooter.outcome, "runtime_interrupted");
    assert.equal(terminalFooter.isFinalPart, true);
    assert.equal(terminalFooter.partial, true);
    assert.equal(terminalFooter.partCount, 2);
  }
});

test("recovery replaces a torn empty terminal orphan and closes the continued predecessor", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-torn-terminal"]);
  const runId = "run-torn-terminal";
  const predecessor = {
    ...multipartAsset(runId, 0, 0),
    status: "pending_upload" as const,
    metadata: {
      ...multipartAsset(runId, 0, 0).metadata,
      frameCount: 0,
      inputCount: 0,
      eventCount: 0,
      checkpointCount: 0,
      outcome: "continued",
      isFinalPart: false,
      localComplete: true
    }
  };
  const directory = join(root, "visit-replay", "replays");
  mkdirSync(directory, { recursive: true });
  const predecessorFooter = encodeRunReplayRecord({
    type: "footer",
    recordSequence: 1,
    endedAtUnixMillis: 4_275,
    outcome: "continued",
    partial: false,
    frameCount: 0,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 0,
    partIndex: 0,
    isFinalPart: false
  });
  const predecessorBytes = gzipSync(encodeRunReplayRecord(multipartHeader(runId, 0, 0)) + predecessorFooter);
  writeFileSync(join(root, "visit-replay", predecessor.localPath), predecessorBytes, { mode: 0o600 });
  store.upsertRecording("visit-replay", {
    ...predecessor,
    byteSize: predecessorBytes.byteLength,
    sha256: "0".repeat(64)
  });
  const terminalId = replayPartAssetId(runId, 1);
  const tornPath = join(directory, `${terminalId}.mlrun.jsonl.partial`);
  writeFileSync(tornPath, '{"type":"header"', { mode: 0o600 });

  const recovered = new RunReplayArchive(store, { now: () => 4_300 });
  await recovered.drain();

  assert.equal(existsSync(tornPath), false);
  const terminal = store.getVisit("visit-replay").recordings.find((asset) => asset.id === terminalId);
  assert.equal(terminal?.status, "partial");
  assert.equal(terminal?.metadata?.runFrameOffset, 0);
  assert.equal(terminal?.metadata?.partCount, 2);
  const terminalFooter = replayRecords(root, runId, 1).at(-1);
  assert.equal(terminalFooter?.type, "footer");
  if (terminalFooter?.type === "footer") {
    assert.equal(terminalFooter.outcome, "runtime_interrupted");
    assert.equal(terminalFooter.partial, true);
    assert.equal(terminalFooter.partCount, 2);
  }
});

test("recovery can terminate a verified continued predecessor after its local part was pruned", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-remote-prefix"]);
  const runId = "run-remote-prefix";
  const predecessor = multipartAsset(runId, 0, 0);
  store.upsertRecording("visit-replay", {
    ...predecessor,
    status: "complete",
    localPath: undefined,
    startedAtUnixMillis: 4_300,
    byteSize: 123,
    sha256: "a".repeat(64),
    remoteUrl: "https://platform.example/api/recording-objects/upload-prefix",
    downloadUrl: "https://platform.example/api/recording-objects/upload-prefix/download",
    metadata: {
      ...predecessor.metadata,
      width: floorWidth,
      height: floorHeight,
      firstDesiredSequence: "1",
      frameCount: 7,
      inputCount: 0,
      eventCount: 0,
      checkpointCount: 0,
      outcome: "continued",
      isFinalPart: false,
      localComplete: true,
      localPruned: true
    }
  });

  const recovered = new RunReplayArchive(store, {
    now: () => 4_350,
    platformUrl: "https://platform.example"
  });
  await recovered.drain();

  const terminal = store.getVisit("visit-replay").recordings
    .find((asset) => asset.id === replayPartAssetId(runId, 1));
  assert.equal(terminal?.status, "partial");
  assert.equal(terminal?.metadata?.runFrameOffset, 7);
  assert.equal(terminal?.metadata?.partCount, 2);
  const header = replayRecords(root, runId, 1)[0];
  assert.equal(header?.type, "header");
  if (header?.type === "header") {
    assert.equal(header.runFrameOffset, 7);
    assert.equal(header.gameId, "ping-pong");
    assert.equal(header.sourceRevision, revision);
  }
});

test("recovery adopts a durable terminal journal created before its manifest asset", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-terminal-orphan"]);
  const predecessor = {
    ...multipartAsset("run-terminal-orphan", 0, 0),
    status: "pending_upload" as const,
    metadata: {
      ...multipartAsset("run-terminal-orphan", 0, 0).metadata,
      isFinalPart: false,
      outcome: "continued",
      frameCount: 12,
      inputCount: 3,
      eventCount: 4,
      checkpointCount: 5,
      firstPresentationSequence: "41",
      lastPresentationSequence: "42",
      partCount: 1,
      localComplete: true,
      platformUpload: { uploadId: "upload-predecessor", objectKey: "stale" }
    }
  };
  const directory = join(root, "visit-replay", "replays");
  mkdirSync(directory, { recursive: true });
  const predecessorHeader = multipartHeader("run-terminal-orphan", 0, 0);
  const predecessorFooter = encodeRunReplayRecord({
    type: "footer",
    recordSequence: 1,
    endedAtUnixMillis: 4_250,
    outcome: "continued",
    partial: false,
    frameCount: 0,
    inputCount: 0,
    eventCount: 0,
    checkpointCount: 0,
    partIndex: 0,
    isFinalPart: false
  });
  const predecessorBytes = gzipSync(encodeRunReplayRecord(predecessorHeader) + predecessorFooter);
  writeFileSync(join(root, "visit-replay", predecessor.localPath), predecessorBytes, { mode: 0o600 });
  store.upsertRecording("visit-replay", {
    ...predecessor,
    byteSize: predecessorBytes.byteLength,
    sha256: "0".repeat(64)
  });
  writeMultipartJournal(root, "run-terminal-orphan", 1, 0);
  const terminalUpserts: SessionHistoryVisit["recordings"] = [];
  const upsertRecording = store.upsertRecording.bind(store);
  store.upsertRecording = (sessionId, asset) => {
    if (asset.id === replayPartAssetId("run-terminal-orphan", 1)) terminalUpserts.push(structuredClone(asset));
    return upsertRecording(sessionId, asset);
  };

  const recovered = new RunReplayArchive(store, { now: () => 4_300 });
  await recovered.drain();
  const initialTerminal = terminalUpserts[0];
  assert.equal(initialTerminal?.status, "recording");
  assert.equal(initialTerminal?.metadata?.frameCount, undefined);
  assert.equal(initialTerminal?.metadata?.inputCount, undefined);
  assert.equal(initialTerminal?.metadata?.eventCount, undefined);
  assert.equal(initialTerminal?.metadata?.checkpointCount, undefined);
  assert.equal(initialTerminal?.metadata?.firstPresentationSequence, undefined);
  assert.equal(initialTerminal?.metadata?.lastPresentationSequence, undefined);
  assert.equal(initialTerminal?.metadata?.localComplete, undefined);
  assert.equal(initialTerminal?.metadata?.platformUpload, undefined);
  const terminal = store.getVisit("visit-replay").recordings
    .find((asset) => asset.id === replayPartAssetId("run-terminal-orphan", 1));
  assert.equal(terminal?.status, "partial");
  assert.equal(terminal?.metadata?.isFinalPart, true);
  assert.equal(terminal?.metadata?.frameCount, 0);
  assert.equal(terminal?.metadata?.firstPresentationSequence, undefined);
  assert.equal(terminal?.metadata?.lastPresentationSequence, undefined);
  assert.equal(terminal?.metadata?.localComplete, true);
  assert.equal(terminal?.metadata?.partCount, 2);
  const footer = replayRecords(root, "run-terminal-orphan", 1).at(-1);
  assert.equal(footer?.type, "footer");
  if (footer?.type === "footer") assert.equal(footer.partCount, 2);
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

test("pruning preserves a concurrent remote reconciliation observed after hashing", async (context) => {
  const root = temporaryRoot(context);
  const store = historyStore(root, ["run-prune-race"]);
  const writer = new RunReplayArchive(store, { now: () => 6_100 });
  writer.start(startInput("run-prune-race", 1n));
  writer.forceFinishAll();
  await writer.drain();
  const local = store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-prune-race");
  assert.ok(local?.localPath && local.sha256 && local.byteSize);
  const initial = store.upsertRecording("visit-replay", {
    ...local!,
    status: "complete",
    remoteUrl: "https://platform.example/api/recording-objects/upload-old",
    downloadUrl: "https://platform.example/api/recording-objects/upload-old/download",
    metadata: { ...(local?.metadata ?? {}), platformUpload: { uploadId: "upload-old" } }
  });
  const localPath = join(root, "visit-replay", initial.localPath!);
  let reconciliations = 0;
  const pruner = new RunReplayArchive(store, {
    now: () => 6_200,
    maxLocalBytes: 1,
    platformUrl: "https://platform.example",
    afterPruneHash(asset) {
      if (asset.id !== initial.id || reconciliations > 0) return;
      reconciliations += 1;
      const current = store.getVisit("visit-replay").recordings.find((candidate) => candidate.id === asset.id)!;
      store.upsertRecording("visit-replay", {
        ...current,
        remoteUrl: "https://platform.example/api/recording-objects/upload-new",
        downloadUrl: "https://platform.example/api/recording-objects/upload-new/download",
        metadata: { ...(current.metadata ?? {}), platformUpload: { uploadId: "upload-new" } }
      });
    }
  });
  await pruner.drain();

  const reconciled = store.getVisit("visit-replay").recordings.find((asset) => asset.id === initial.id);
  assert.equal(reconciliations, 1);
  assert.equal(existsSync(localPath), true);
  assert.equal(reconciled?.localPath, initial.localPath);
  assert.equal(reconciled?.remoteUrl, "https://platform.example/api/recording-objects/upload-new");
  assert.equal(reconciled?.metadata?.platformUpload &&
    (reconciled.metadata.platformUpload as Record<string, unknown>).uploadId, "upload-new");
  assert.equal(reconciled?.metadata?.localPruned, undefined);
});

test("local retention fails closed for invalid limits and prunes a verified uploaded partial", async (context) => {
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
  const pruned = store.getVisit("visit-replay").recordings.find((asset) => asset.runId === "run-partial-uploaded");
  assert.equal(pruned?.localPath, undefined);
  assert.equal(pruned?.metadata?.localPruned, true);
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

test("download and recovery refuse replay file symlinks", async (context) => {
  const root = temporaryRoot(context);
  const outside = temporaryRoot(context);
  const store = historyStore(root, ["run-file-symlink"]);
  const archive = new RunReplayArchive(store, { now: () => 9_100 });
  archive.start(startInput("run-file-symlink", 1n));
  archive.observePresentedFrame(frame(1n, 1n, 0x45), 20);
  archive.requestFinish("run-file-symlink", "finished", 1n);
  archive.observePresentedFrame(frame(2n, 2n, 0x46), 40);
  await archive.drain();
  const asset = store.getVisit("visit-replay").recordings.find((candidate) => candidate.runId === "run-file-symlink");
  assert.ok(asset?.localPath);
  const finalPath = join(root, "visit-replay", asset.localPath!);
  const outsidePath = join(outside, "outside-replay.gz");
  writeFileSync(outsidePath, "outside", { mode: 0o600 });
  unlinkSync(finalPath);
  symlinkSync(outsidePath, finalPath);
  assert.throws(() => archive.read("visit-replay", "run-file-symlink", asset!.id), /not found/u);

  store.upsertRecording("visit-replay", { ...asset!, status: "finalizing" });
  const recovered = new RunReplayArchive(store, { now: () => 9_200 });
  await recovered.drain();
  assert.equal(store.getVisit("visit-replay").recordings.find((candidate) => candidate.id === asset!.id)?.status, "failed");
});

test("download refuses a symlinked replay parent directory", async (context) => {
  const root = temporaryRoot(context);
  const outside = temporaryRoot(context);
  const store = historyStore(root, ["run-parent-symlink"]);
  const archive = new RunReplayArchive(store, { now: () => 9_300 });
  archive.start(startInput("run-parent-symlink", 1n));
  archive.forceFinishAll();
  await archive.drain();
  const asset = store.getVisit("visit-replay").recordings.find((candidate) => candidate.runId === "run-parent-symlink");
  assert.ok(asset?.localPath);
  const replayDirectory = join(root, "visit-replay", "replays");
  rmSync(replayDirectory, { recursive: true });
  mkdirSync(join(outside, "replays"));
  writeFileSync(join(outside, "replays", asset!.fileName!), "outside", { mode: 0o600 });
  symlinkSync(join(outside, "replays"), replayDirectory);
  assert.throws(() => archive.read("visit-replay", "run-parent-symlink", asset!.id), /not found/u);
});

function temporaryRoot(context: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "motion-levels-run-replay-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function historyStore(
  root: string,
  runIds: string[],
  diagnostics: SessionHistoryStoreDiagnostics = {}
): SessionHistoryStore {
  const store = new SessionHistoryStore(root, () => 1_000, diagnostics);
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

function multipartAsset(runId: string, partIndex: number, runFrameOffset: number) {
  const assetId = replayPartAssetId(runId, partIndex);
  return {
    id: assetId,
    scope: "run" as const,
    status: "recording" as const,
    selectionId: "selection-replay",
    runId,
    linkedRunIds: [runId],
    backend: "venue-runtime-replay",
    localPath: `replays/${assetId}.mlrun.jsonl.gz`,
    fileName: `${assetId}.mlrun.jsonl.gz`,
    contentType: "application/vnd.motion-levels.run-replay+jsonl",
    metadata: {
      schema: RUN_REPLAY_SCHEMA,
      contractVersion: RUN_REPLAY_CONTRACT_VERSION,
      compression: "gzip",
      partIndex,
      runFrameOffset,
      isFinalPart: false,
      partial: false
    }
  };
}

function writeMultipartJournal(root: string, runId: string, partIndex: number, runFrameOffset: number): void {
  const directory = join(root, "visit-replay", "replays");
  mkdirSync(directory, { recursive: true });
  const assetId = replayPartAssetId(runId, partIndex);
  writeFileSync(join(directory, `${assetId}.mlrun.jsonl.partial`), encodeRunReplayRecord(
    multipartHeader(runId, partIndex, runFrameOffset)
  ), { mode: 0o600 });
}

function multipartHeader(runId: string, partIndex: number, runFrameOffset: number) {
  const assetId = replayPartAssetId(runId, partIndex);
  return {
    type: "header",
    schema: RUN_REPLAY_SCHEMA,
    contractVersion: RUN_REPLAY_CONTRACT_VERSION,
    sessionId: "visit-replay",
    selectionId: "selection-replay",
    runId,
    gameId: "ping-pong",
    engineGame: "motion-levels-games:ping-pong",
    sourceRevision: revision,
    width: floorWidth,
    height: floorHeight,
    pixelFormat: "rgb24",
    pressureFormat: "row-major-bitset-lsb0",
    frameSource: "presented-frame",
    firstDesiredSequence: "1",
    startedAtUnixMillis: 1_000,
    assetId,
    partIndex,
    runFrameOffset
  } as const;
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

function smallFrame(presentationSequence: bigint, desiredSequence: bigint, value: number): PresentedFrame {
  const byte = value & 0xff;
  return {
    presentationSequence,
    desiredSequence,
    presentedUnixNanos: presentationSequence * 20_000_000n,
    width: 1,
    height: 1,
    rgb: Uint8Array.of(byte, byte ^ 0x55, byte ^ 0xaa),
    pressureBits: Uint8Array.of(byte & 1),
    fadeRatio: 0
  };
}

function replayRecords(root: string, runId: string, partIndex = 0) {
  const assetId = replayPartAssetId(runId, partIndex);
  const bytes = readFileSync(join(root, "visit-replay", "replays", `${assetId}.mlrun.jsonl.gz`));
  return decodeRunReplayRecords(gunzipSync(bytes).toString("utf8"));
}

function legacyReplayRecords(root: string, runId: string) {
  const bytes = readFileSync(join(root, "visit-replay", "replays", `${runId}.mlrun.jsonl.gz`));
  return decodeRunReplayRecords(gunzipSync(bytes).toString("utf8"));
}
