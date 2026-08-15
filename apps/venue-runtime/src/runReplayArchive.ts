import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  fdatasyncSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  readSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import {
  RUN_REPLAY_COMPRESSION,
  RUN_REPLAY_CONTENT_TYPE,
  RUN_REPLAY_CONTRACT_VERSION,
  RUN_REPLAY_FILE_EXTENSION,
  RUN_REPLAY_MAX_PART_BODY_RECORDS,
  RUN_REPLAY_MAX_PART_FRAMES,
  RUN_REPLAY_MAX_PART_INDEX,
  RUN_REPLAY_MAX_PART_JSONL_BYTES,
  RUN_REPLAY_SCHEMA,
  decodeRunReplayRecord,
  encodeRunReplayByteField,
  encodeRunReplayRecord,
  type RunReplayCheckpointRecord,
  type RunReplayFooterRecord,
  type RunReplayFrameRecord,
  type RunReplayHeaderRecord,
  type RunReplayJsonObject,
  type RunReplayRecord
} from "@motion-levels-games/replay-runtime";
import type { GameSessionState } from "@motion-levels-games/runtime";
import type { RecordingAsset, SessionHistoryVisit } from "@motion-levels-games/session-history";
import type { PresentedFrame } from "./controllerProtocol.ts";
import {
  SessionHistoryConflictError,
  SessionHistoryNotFoundError,
  type SessionHistoryStore
} from "./sessionHistoryStore.ts";

const replayBackend = "venue-runtime-replay";
const journalSuffix = ".mlrun.jsonl.partial";
const keyframeInterval = 250;
const checkpointIntervalMillis = 1_000;
const dataSyncIntervalMillis = 1_000;
const safeRunId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const replayPartJournalNamePattern = /^(run-replay-[0-9a-f]{64}-part-[0-9]{6})\.mlrun\.jsonl\.partial$/u;
export const defaultReplayMaxLocalBytes = 512 * 1024 * 1024;

export type RunReplayStart = {
  sessionId: string;
  selectionId: string;
  runId: string;
  gameId: string;
  engineGame: string;
  sourceRevision: string;
  contentRevision?: string;
  width: number;
  height: number;
  firstDesiredSequence: bigint;
  state: GameSessionState;
};

export type RunReplayRead = {
  path: string;
  fd: number;
  asset: RecordingAsset;
};

type PendingClose = {
  outcome: string;
  lastDesiredSequence: bigint;
};

type ActiveWriter = {
  input: RunReplayStart;
  asset: RecordingAsset;
  fd: number;
  journalPath: string;
  finalPath: string;
  partIndex: number;
  runFrameOffset: number;
  previousRgb?: Uint8Array;
  previousPressure?: Uint8Array;
  recordSequence: number;
  frameCount: number;
  inputCount: number;
  eventCount: number;
  checkpointCount: number;
  bodyRecordCount: number;
  jsonlBytes: number;
  firstPresentationSequence?: string;
  lastPresentationSequence?: string;
  lastCheckpointEngineMillis: number;
  lastPhase: string;
  lastSyncAtUnixMillis: number;
  pendingClose?: PendingClose;
};

type ReplayScan = {
  header: RunReplayHeaderRecord;
  footer?: RunReplayFooterRecord;
  jsonlBytes: number;
  lastRecordSequence: number;
  frameCount: number;
  inputCount: number;
  eventCount: number;
  checkpointCount: number;
  firstPresentationSequence?: string;
  lastPresentationSequence?: string;
};

type ReplayPartLimits = {
  frames: number;
  bodyRecords: number;
  jsonlBytes: number;
};

type ReplayPartSpan = {
  partIndex: number;
  runFrameOffset: number;
  frameCount: number;
  isFinalPart?: boolean;
};

class ReplayOrphanContinuityError extends Error {}

/** Durable, infrastructure-neutral run replay ownership. The archive writes
 * only inside the session history root and exposes files to the authenticated
 * local API; upload and remote object lifecycle remain venue-owned. */
export class RunReplayArchive {
  private readonly writers = new Map<string, ActiveWriter>();
  private activeRunId = "";
  private operations: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: SessionHistoryStore,
    private readonly options: {
      now?: () => number;
      log?: (message: string, error?: unknown) => void;
      maxLocalBytes?: number;
      platformUrl?: string;
      maxPartFrames?: number;
      maxPartBodyRecords?: number;
      maxPartJsonlBytes?: number;
      onDurabilityStage?: (
        stage: "predecessor_synced" | "part_header_synced" | "part_manifest_persisted",
        part: { runId: string; assetId: string; partIndex: number }
      ) => void;
      afterPruneHash?: (asset: RecordingAsset) => void | Promise<void>;
    } = {}
  ) {
    this.recover();
  }

  start(input: RunReplayStart): RecordingAsset | null {
    if (!safeRunId.test(input.runId)) throw new Error("run replay id is invalid");
    if (this.activeRunId && this.activeRunId !== input.runId) {
      this.requestFinish(this.activeRunId, "superseded", input.firstDesiredSequence - 1n);
    }
    if (this.writers.has(input.runId)) return { ...this.writers.get(input.runId)!.asset };
    const visit = this.store.getVisit(input.sessionId);
    const selection = visit.selections.find((candidate) => candidate.id === input.selectionId);
    if (!selection?.runs.some((run) => run.id === input.runId)) {
      throw new SessionHistoryConflictError("run replay does not belong to the requested selection");
    }
    try {
      let writer: ActiveWriter;
      try {
        writer = this.openPart(input, 0, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !this.removeTornInitialJournal(input)) throw error;
        writer = this.openPart(input, 0, 0);
      }
      this.writers.set(input.runId, writer);
      this.activeRunId = input.runId;
      this.observeState(input.runId, input.state, "initial");
      return { ...writer.asset };
    } catch (error) {
      this.options.log?.("run replay start failed", error);
      return null;
    }
  }

  /** A process can exit after O_EXCL creates part zero but before its header
   * reaches the terminating newline. There is no durable replay record to
   * adopt in that case, so remove only the repaired-empty, unowned journal and
   * let the same start retry its deterministic asset id. */
  private removeTornInitialJournal(input: RunReplayStart): boolean {
    const assetId = replayPartAssetId(input.runId, 0);
    if (this.store.getVisit(input.sessionId).recordings.some((asset) => asset.id === assetId)) return false;
    const paths = replayPartPaths(this.store.rootDir, input.sessionId, assetId);
    try {
      assertReplayFile(this.store.rootDir, input.sessionId, paths.journalPath);
      repairJournal(paths.journalPath);
      if (lstatSync(paths.journalPath).size !== 0) return false;
      unlinkSync(paths.journalPath);
      fsyncDirectory(dirname(paths.journalPath));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      return false;
    }
  }

  private openPart(
    input: RunReplayStart,
    partIndex: number,
    runFrameOffset: number,
    inherited?: Pick<ActiveWriter, "lastCheckpointEngineMillis" | "lastPhase" | "pendingClose">
  ): ActiveWriter {
    if (!Number.isSafeInteger(partIndex) || partIndex < 0 || partIndex > RUN_REPLAY_MAX_PART_INDEX) {
      throw new Error("run replay part index is exhausted");
    }
    const assetId = replayPartAssetId(input.runId, partIndex);
    const paths = replayPartPaths(this.store.rootDir, input.sessionId, assetId);
    ensureReplayDirectory(this.store.rootDir, input.sessionId, dirname(paths.finalPath));
    const at = this.now();
    const asset: RecordingAsset = {
      id: assetId,
      scope: "run",
      status: "recording",
      selectionId: input.selectionId,
      runId: input.runId,
      linkedRunIds: [input.runId],
      startedAtUnixMillis: at,
      backend: replayBackend,
      localPath: paths.localPath,
      fileName: basename(paths.finalPath),
      contentType: RUN_REPLAY_CONTENT_TYPE,
      metadata: replayMetadata(input, partIndex, runFrameOffset, false, false)
    };
    let fd: number | undefined;
    let created = false;
    let headerDurable = false;
    try {
      fd = openSync(paths.journalPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL
        | fsConstants.O_NOFOLLOW, 0o600);
      created = true;
      const writer: ActiveWriter = {
        input: { ...input },
        asset,
        fd,
        journalPath: paths.journalPath,
        finalPath: paths.finalPath,
        partIndex,
        runFrameOffset,
        recordSequence: 0,
        frameCount: 0,
        inputCount: 0,
        eventCount: 0,
        checkpointCount: 0,
        bodyRecordCount: 0,
        jsonlBytes: 0,
        lastCheckpointEngineMillis: inherited?.lastCheckpointEngineMillis ?? input.state.clockMillis,
        lastPhase: inherited?.lastPhase ?? String(input.state.snapshot.phase || ""),
        lastSyncAtUnixMillis: at,
        ...(inherited?.pendingClose ? { pendingClose: { ...inherited.pendingClose } } : {})
      };
      this.appendRaw(writer, encodeRunReplayRecord(replayHeader(input, assetId, partIndex, runFrameOffset, at)), true);
      fsyncDirectory(dirname(paths.journalPath));
      headerDurable = true;
      this.options.onDurabilityStage?.("part_header_synced", { runId: input.runId, assetId, partIndex });
      this.store.upsertRecording(input.sessionId, asset);
      this.options.onDurabilityStage?.("part_manifest_persisted", { runId: input.runId, assetId, partIndex });
      return writer;
    } catch (error) {
      if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
      const persisted = this.store.getVisit(input.sessionId).recordings.some((candidate) => candidate.id === asset.id);
      if (persisted) this.markFailed(input.sessionId, asset, error);
      else if (created && !headerDurable) {
        try {
          unlinkSync(paths.journalPath);
          fsyncDirectory(dirname(paths.journalPath));
        } catch { /* a failed open or encode may not have created the journal */ }
      }
      throw error;
    }
  }

  observeState(runId: string, state: GameSessionState, forcedReason?: RunReplayCheckpointRecord["reason"]): void {
    const initialWriter = this.writers.get(runId);
    if (!initialWriter || initialWriter.pendingClose) return;
    let writer: ActiveWriter = initialWriter;
    const at = this.now();
    for (const event of state.events) {
      const appended = this.append(writer, (_target, recordSequence) => ({
        type: "game-event",
        recordSequence,
        occurredAtUnixMillis: at,
        engineAtMillis: state.clockMillis,
        eventAtMillis: event.atMillis,
        cue: event.cue,
        message: event.message
      }), true);
      if (!appended) return;
      writer = appended.writer;
    }
    const phase = String(state.snapshot.phase || "");
    const reason = forcedReason
      ?? (phase === "finished" ? "terminal"
        : phase !== writer.lastPhase ? "phase"
          : state.events.length ? "event"
            : state.clockMillis - writer.lastCheckpointEngineMillis >= checkpointIntervalMillis ? "periodic"
              : undefined);
    writer.lastPhase = phase;
    if (!reason) return;
    const snapshot = replayJsonObject(state.snapshot);
    const appended = this.append(writer, (_target, recordSequence) => ({
      type: "checkpoint",
      recordSequence,
      occurredAtUnixMillis: at,
      engineAtMillis: state.clockMillis,
      reason,
      paused: state.paused,
      snapshot
    }), reason !== "periodic");
    if (!appended) return;
    writer = appended.writer;
    writer.lastCheckpointEngineMillis = state.clockMillis;
  }

  observeInput(
    runId: string,
    input: { source: "physical" | "remote" | "restored"; x: number; y: number; pressed: boolean; occurredAtUnixMillis: number; engineAtMillis: number }
  ): void {
    const writer = this.writers.get(runId);
    if (!writer || writer.pendingClose) return;
    this.append(writer, (_target, recordSequence) => ({
      type: "input",
      recordSequence,
      ...input
    }), true);
  }

  observePresentedFrame(frame: PresentedFrame, engineAtMillis: number): void {
    for (const candidate of [...this.writers.values()]) {
      if (candidate.pendingClose && frame.desiredSequence > candidate.pendingClose.lastDesiredSequence) {
        this.finalize(candidate, candidate.pendingClose.outcome, false);
      }
    }
    const writer = [...this.writers.values()].find((candidate) => frame.desiredSequence >= candidate.input.firstDesiredSequence
      && (!candidate.pendingClose || frame.desiredSequence <= candidate.pendingClose.lastDesiredSequence));
    if (writer) {
      const appended = this.append(writer, (target, recordSequence): RunReplayFrameRecord => ({
        type: "frame",
        recordSequence,
        presentationSequence: frame.presentationSequence.toString(),
        desiredSequence: frame.desiredSequence.toString(),
        presentedUnixNanos: frame.presentedUnixNanos.toString(),
        engineAtMillis,
        fadeRatio: frame.fadeRatio,
        rgb: encodeRunReplayByteField(
          frame.rgb,
          target.previousRgb,
          target.frameCount === 0 || target.frameCount % keyframeInterval === 0
        ),
        pressure: encodeRunReplayByteField(
          frame.pressureBits,
          target.previousPressure,
          target.frameCount === 0 || target.frameCount % keyframeInterval === 0
        )
      }), false);
      if (!appended) return;
      appended.writer.previousRgb = frame.rgb.slice();
      appended.writer.previousPressure = frame.pressureBits.slice();
    }
  }

  requestFinish(runId: string, outcome: string, lastDesiredSequence: bigint): void {
    const writer = this.writers.get(runId);
    if (!writer) return;
    writer.pendingClose = { outcome, lastDesiredSequence };
    if (lastDesiredSequence < writer.input.firstDesiredSequence) this.finalize(writer, outcome, false);
    if (this.activeRunId === runId) this.activeRunId = "";
  }

  forceFinishAll(outcome = "runtime_interrupted"): void {
    for (const writer of [...this.writers.values()]) this.finalize(writer, outcome, true);
    this.activeRunId = "";
  }

  drain(): Promise<void> {
    return this.operations;
  }

  reconcileRecording(recording: RecordingAsset): void {
    if (recording.backend !== replayBackend) return;
    this.enqueue(() => this.pruneLocalReplays());
  }

  read(sessionId: string, runId: string, assetId?: string): RunReplayRead {
    if (!safeRunId.test(runId)) throw new SessionHistoryNotFoundError("run replay not found");
    const visit = this.store.getVisit(sessionId);
    const expectedId = assetId ?? legacyReplayAssetId(runId);
    const asset = visit.recordings.find((candidate) => candidate.id === expectedId
      && candidate.backend === replayBackend && candidate.runId === runId);
    if (!asset?.localPath) throw new SessionHistoryNotFoundError("run replay not found");
    let expectedPaths;
    try {
      expectedPaths = recoveryReplayPaths(this.store.rootDir, sessionId, asset);
    } catch {
      throw new SessionHistoryNotFoundError("run replay not found");
    }
    if (assetId) {
      const partIndex = replayPartIndex(asset);
      if (partIndex === null || asset.id !== replayPartAssetId(runId, partIndex)) {
        throw new SessionHistoryNotFoundError("run replay not found");
      }
      if (asset.localPath !== expectedPaths.localPath) throw new SessionHistoryNotFoundError("run replay not found");
    }
    const path = safeLocalPath(this.store.rootDir, sessionId, asset.localPath);
    if (path !== expectedPaths.finalPath) throw new SessionHistoryNotFoundError("run replay not found");
    try {
      const fd = openReplayReadFile(this.store.rootDir, sessionId, path);
      return { path, fd, asset: structuredClone(asset) };
    } catch (error) {
      if (error instanceof SessionHistoryNotFoundError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SessionHistoryConflictError("run replay is not finalized");
      }
      throw error;
    }
  }

  private append<T extends Exclude<RunReplayRecord, RunReplayHeaderRecord | RunReplayFooterRecord>>(
    writer: ActiveWriter,
    createRecord: (target: ActiveWriter, recordSequence: number) => T,
    sync: boolean
  ): { writer: ActiveWriter; record: T } | null {
    try {
      let target = writer;
      let record = createRecord(target, target.recordSequence + 1);
      let line = encodeRunReplayRecord(record);
      if (this.shouldRollover(target, record, line)) {
        target = this.rollover(target);
        record = createRecord(target, target.recordSequence + 1);
        line = encodeRunReplayRecord(record);
        if (this.shouldRollover(target, record, line)) {
          throw new Error("run replay record cannot fit inside an empty part");
        }
      }
      this.appendRaw(target, line, sync);
      target.recordSequence = record.recordSequence;
      target.bodyRecordCount += 1;
      if (record.type === "frame") {
        target.frameCount += 1;
        target.firstPresentationSequence ??= record.presentationSequence;
        target.lastPresentationSequence = record.presentationSequence;
      } else if (record.type === "input") target.inputCount += 1;
      else if (record.type === "game-event") target.eventCount += 1;
      else if (record.type === "checkpoint") target.checkpointCount += 1;
      return { writer: target, record };
    } catch (error) {
      const current = this.writers.get(writer.input.runId);
      if (current) this.abortWriter(current, error);
      else this.options.log?.("run replay write failed after rollover", error);
      return null;
    }
  }

  private appendRaw(writer: ActiveWriter, line: string, sync: boolean): void {
    const bytes = Buffer.from(line);
    let offset = 0;
    while (offset < bytes.byteLength) offset += writeSync(writer.fd, bytes, offset, bytes.byteLength - offset);
    writer.jsonlBytes += bytes.byteLength;
    const at = this.now();
    if (sync || at - writer.lastSyncAtUnixMillis >= dataSyncIntervalMillis) {
      fdatasyncSync(writer.fd);
      writer.lastSyncAtUnixMillis = at;
    }
  }

  private shouldRollover(
    writer: ActiveWriter,
    record: Exclude<RunReplayRecord, RunReplayHeaderRecord | RunReplayFooterRecord>,
    line: string
  ): boolean {
    const limits = this.partLimits();
    if (writer.bodyRecordCount + 1 > limits.bodyRecords) return true;
    if (record.type === "frame" && writer.frameCount + 1 > limits.frames) return true;
    const projected = projectedFooter(writer, record, this.now());
    return writer.jsonlBytes + Buffer.byteLength(line) + Buffer.byteLength(encodeRunReplayRecord(projected))
      > limits.jsonlBytes;
  }

  private rollover(writer: ActiveWriter): ActiveWriter {
    fdatasyncSync(writer.fd);
    writer.lastSyncAtUnixMillis = this.now();
    this.options.onDurabilityStage?.("predecessor_synced", {
      runId: writer.input.runId,
      assetId: writer.asset.id,
      partIndex: writer.partIndex
    });
    const next = this.openPart(
      writer.input,
      writer.partIndex + 1,
      writer.runFrameOffset + writer.frameCount,
      writer
    );
    this.finalize(writer, "continued", false, false);
    this.writers.set(writer.input.runId, next);
    return next;
  }

  private partLimits(): ReplayPartLimits {
    return {
      frames: boundedReplayPartLimit(this.options.maxPartFrames, RUN_REPLAY_MAX_PART_FRAMES),
      bodyRecords: boundedReplayPartLimit(this.options.maxPartBodyRecords, RUN_REPLAY_MAX_PART_BODY_RECORDS),
      jsonlBytes: boundedReplayPartLimit(this.options.maxPartJsonlBytes, RUN_REPLAY_MAX_PART_JSONL_BYTES)
    };
  }

  private finalize(writer: ActiveWriter, outcome: string, partial: boolean, isFinalPart = true): void {
    if (this.writers.get(writer.input.runId) !== writer) return;
    try {
      let footer = replayFooter(writer, outcome, partial, isFinalPart, this.now());
      let footerLine = encodeRunReplayRecord(footer);
      if (isFinalPart && writer.jsonlBytes + Buffer.byteLength(footerLine) > this.partLimits().jsonlBytes) {
        const terminal = this.rollover(writer);
        this.finalize(terminal, outcome, partial, true);
        return;
      }
      if (writer.jsonlBytes + Buffer.byteLength(footerLine) > this.partLimits().jsonlBytes) {
        throw new Error("run replay continued footer exceeds the part byte limit");
      }
      this.appendRaw(writer, footerLine, true);
      writer.recordSequence = footer.recordSequence;
      closeSync(writer.fd);
      const current = this.store.getVisit(writer.input.sessionId).recordings
        .find((candidate) => candidate.id === writer.asset.id) ?? writer.asset;
      this.store.upsertRecording(writer.input.sessionId, {
        ...current,
        status: "finalizing",
        endedAtUnixMillis: footer.endedAtUnixMillis,
        metadata: {
          ...(current.metadata ?? {}),
          ...replayCounts(footer),
          partial,
          isFinalPart,
          ...(isFinalPart ? { partCount: writer.partIndex + 1 } : {})
        }
      });
      this.enqueue(async () => {
        try {
          const result = await compressJournal(
            writer.journalPath,
            writer.finalPath,
            this.store.rootDir,
            writer.input.sessionId
          );
          const latest = this.store.getVisit(writer.input.sessionId).recordings
            .find((candidate) => candidate.id === writer.asset.id) ?? writer.asset;
          this.store.upsertRecording(writer.input.sessionId, {
            ...latest,
            status: partial ? "partial" : "pending_upload",
            endedAtUnixMillis: footer.endedAtUnixMillis,
            byteSize: result.byteSize,
            sha256: result.sha256,
            metadata: {
              ...(latest.metadata ?? {}),
              ...replayCounts(footer),
              localComplete: true,
              partial,
              isFinalPart,
              ...(isFinalPart ? { partCount: writer.partIndex + 1 } : {})
            }
          });
          await this.pruneLocalReplays();
        } catch (error) {
          this.markFinalizingFailure(writer.input.sessionId, writer.asset, error);
          this.options.log?.("run replay compression failed", error);
        }
      });
    } catch (error) {
      this.markFailed(writer.input.sessionId, writer.asset, error);
      this.options.log?.("run replay finalize failed", error);
      try { closeSync(writer.fd); } catch { /* already closed */ }
    } finally {
      if (this.writers.get(writer.input.runId) === writer) this.writers.delete(writer.input.runId);
      if (isFinalPart && this.activeRunId === writer.input.runId) this.activeRunId = "";
    }
  }

  private abortWriter(writer: ActiveWriter, error: unknown): void {
    try { fdatasyncSync(writer.fd); } catch { /* preserve best-effort journal */ }
    try { closeSync(writer.fd); } catch { /* already closed */ }
    this.writers.delete(writer.input.runId);
    if (this.activeRunId === writer.input.runId) this.activeRunId = "";
    this.markFailed(writer.input.sessionId, writer.asset, error);
    this.options.log?.("run replay write failed", error);
  }

  private markFailed(sessionId: string, asset: RecordingAsset, error: unknown): void {
    try {
      const current = this.store.getVisit(sessionId).recordings.find((candidate) => candidate.id === asset.id) ?? asset;
      this.store.upsertRecording(sessionId, {
        ...current,
        status: "failed",
        metadata: {
          ...(current.metadata ?? {}),
          error: error instanceof Error ? error.message : String(error)
        }
      });
    } catch (persistError) {
      this.options.log?.("run replay failure could not be persisted", persistError);
    }
  }

  private markFinalizingFailure(sessionId: string, asset: RecordingAsset, error: unknown): void {
    try {
      const current = this.store.getVisit(sessionId).recordings.find((candidate) => candidate.id === asset.id) ?? asset;
      this.store.upsertRecording(sessionId, {
        ...current,
        status: "finalizing",
        metadata: {
          ...(current.metadata ?? {}),
          compressionError: error instanceof Error ? error.message : String(error)
        }
      });
    } catch (persistError) {
      this.options.log?.("run replay finalizing failure could not be persisted", persistError);
    }
  }

  private recover(): void {
    for (const visit of this.store.allVisits()) {
      const assetIds = new Set(visit.recordings
        .filter((asset) => asset.backend === replayBackend)
        .map((asset) => asset.id));
      this.enqueue(async () => {
        for (const assetId of await this.discoverOrphanJournals(visit.id)) assetIds.add(assetId);
        if (assetIds.size) await this.recoverVisit(visit.id, assetIds);
      });
    }
    this.enqueue(() => this.pruneLocalReplays());
  }

  private async discoverOrphanJournals(sessionId: string): Promise<string[]> {
    const directory = resolve(this.store.rootDir, sessionId, "replays");
    try {
      ensureExistingReplayDirectory(this.store.rootDir, sessionId, directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const discovered: string[] = [];
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const match = replayPartJournalNamePattern.exec(entry.name);
      if (!match?.[1] || !entry.isFile() || entry.isSymbolicLink()) continue;
      const assetId = match[1];
      const visit = this.store.getVisit(sessionId);
      if (visit.recordings.some((asset) => asset.id === assetId)) continue;
      const journalPath = join(directory, entry.name);
      try {
        assertReplayFile(this.store.rootDir, sessionId, journalPath);
        repairJournal(journalPath);
        if (lstatSync(journalPath).size === 0) {
          this.discardUnownedJournal(sessionId, journalPath);
          continue;
        }
        const scan = await scanReplay(journalPath, false, true);
        const header = scan.header;
        if (header.assetId !== assetId || header.partIndex === undefined || header.runFrameOffset === undefined
          || !safeRunId.test(header.runId) || replayPartAssetId(header.runId, header.partIndex) !== assetId) {
          throw new Error("run replay orphan journal identity is invalid");
        }
        const selection = visit.selections.find((candidate) => candidate.id === header.selectionId);
        if (header.sessionId !== sessionId || !selection?.runs.some((run) => run.id === header.runId)
          || selection.gameId !== header.gameId || selection.engineGame !== header.engineGame
          || selection.sourceRevision !== header.sourceRevision
          || (selection.contentRevision ?? undefined) !== (header.contentRevision ?? undefined)) {
          throw new Error("run replay orphan journal does not belong to its visit selection and run");
        }
        await this.assertOrphanContinuity(visit, header);
        const paths = replayPartPaths(this.store.rootDir, sessionId, assetId);
        const footer = scan.footer;
        const asset: RecordingAsset = {
          id: assetId,
          scope: "run",
          status: "recording",
          selectionId: header.selectionId,
          runId: header.runId,
          linkedRunIds: [header.runId],
          startedAtUnixMillis: header.startedAtUnixMillis,
          ...(footer ? { endedAtUnixMillis: footer.endedAtUnixMillis } : {}),
          backend: replayBackend,
          localPath: paths.localPath,
          fileName: basename(paths.finalPath),
          contentType: RUN_REPLAY_CONTENT_TYPE,
          metadata: {
            ...replayMetadataFromHeader(header, header.partIndex, header.runFrameOffset,
              footer?.partial ?? false, footer?.isFinalPart ?? false),
            ...(footer ? replayCounts(footer) : {}),
            recoveredOrphanJournal: true
          }
        };
        validateReplayScanIdentity(scan, sessionId, asset);
        this.store.upsertRecording(sessionId, asset);
        discovered.push(assetId);
      } catch (error) {
        const persisted = this.store.getVisit(sessionId).recordings
          .find((asset) => asset.id === assetId && asset.backend === replayBackend);
        if (persisted) {
          this.markFailed(sessionId, persisted, error);
          discovered.push(assetId);
        } else {
          try {
            this.quarantineUnownedJournal(sessionId, journalPath);
          } catch (quarantineError) {
            this.options.log?.(`run replay orphan journal ${entry.name} could not be quarantined`, quarantineError);
          }
        }
        this.options.log?.(`run replay orphan journal ${entry.name} was not adopted`, error);
      }
    }
    return discovered;
  }

  private discardUnownedJournal(sessionId: string, journalPath: string): void {
    assertReplayFile(this.store.rootDir, sessionId, journalPath);
    unlinkSync(journalPath);
    fsyncDirectory(dirname(journalPath));
  }

  private quarantineUnownedJournal(sessionId: string, journalPath: string): void {
    assertReplayFile(this.store.rootDir, sessionId, journalPath);
    renameSync(journalPath, `${journalPath}.rejected-${randomUUID()}`);
    fsyncDirectory(dirname(journalPath));
  }

  private async assertOrphanContinuity(visit: SessionHistoryVisit, header: RunReplayHeaderRecord): Promise<void> {
    const partIndex = header.partIndex;
    const runFrameOffset = header.runFrameOffset;
    if (partIndex === undefined || runFrameOffset === undefined) {
      throw new ReplayOrphanContinuityError("run replay orphan is missing multipart continuity fields");
    }
    if (partIndex === 0) {
      if (runFrameOffset !== 0) {
        throw new ReplayOrphanContinuityError("run replay first orphan part has a nonzero frame offset");
      }
      return;
    }
    const parts = visit.recordings
      .filter((asset) => asset.backend === replayBackend && asset.runId === header.runId
        && replayPartIndex(asset) !== null && replayPartIndex(asset)! < partIndex)
      .sort((left, right) => replayPartIndex(left)! - replayPartIndex(right)!);
    let expectedOffset = 0;
    for (let index = 0; index < partIndex; index += 1) {
      const asset = parts.find((candidate) => replayPartIndex(candidate) === index);
      if (!asset) {
        throw new ReplayOrphanContinuityError("run replay orphan is not the contiguous successor of its run");
      }
      let span: ReplayPartSpan;
      try {
        span = await this.replayPartSpan(visit.id, asset);
      } catch (error) {
        throw new ReplayOrphanContinuityError("run replay orphan predecessor is not durable", { cause: error });
      }
      if (span.partIndex !== index || span.runFrameOffset !== expectedOffset || span.isFinalPart === true) {
        throw new ReplayOrphanContinuityError("run replay orphan predecessor chain is not contiguous");
      }
      expectedOffset += span.frameCount;
    }
    if (runFrameOffset !== expectedOffset) {
      throw new ReplayOrphanContinuityError("run replay orphan frame offset is not contiguous");
    }
  }

  private async replayPartSpan(sessionId: string, asset: RecordingAsset): Promise<ReplayPartSpan> {
    const partIndex = replayPartIndex(asset);
    const runFrameOffset = asset.metadata?.runFrameOffset;
    if (partIndex === null || typeof runFrameOffset !== "number" || !Number.isSafeInteger(runFrameOffset)
      || runFrameOffset < 0 || !asset.runId || asset.id !== replayPartAssetId(asset.runId, partIndex)) {
      throw new Error("run replay part metadata is invalid");
    }
    const remoteSpan = this.remoteReplayPartSpan(asset, partIndex, runFrameOffset);
    if (!asset.localPath) {
      if (remoteSpan) return remoteSpan;
      throw new Error("run replay part has no durable local representation");
    }
    const paths = recoveryReplayPaths(this.store.rootDir, sessionId, asset);
    ensureExistingReplayDirectory(this.store.rootDir, sessionId, dirname(paths.finalPath));
    let scan: ReplayScan;
    if (replayRegularFileExists(this.store.rootDir, sessionId, paths.finalPath)) {
      scan = await scanReplay(paths.finalPath, true, false);
    } else {
      try {
        assertReplayFile(this.store.rootDir, sessionId, paths.journalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && remoteSpan) return remoteSpan;
        throw error;
      }
      repairJournal(paths.journalPath);
      scan = await scanReplay(paths.journalPath, false, true);
    }
    validateReplayScanIdentity(scan, sessionId, asset);
    return {
      partIndex,
      runFrameOffset: scan.header.runFrameOffset!,
      frameCount: scan.footer?.frameCount ?? scan.frameCount,
      ...(scan.footer?.isFinalPart === undefined ? {} : { isFinalPart: scan.footer.isFinalPart })
    };
  }

  private remoteReplayPartSpan(
    asset: RecordingAsset,
    partIndex: number,
    runFrameOffset: number
  ): ReplayPartSpan | null {
    const frameCount = asset.metadata?.frameCount;
    if (!Number.isSafeInteger(runFrameOffset) || runFrameOffset < 0
      || !replayCanBePruned(asset, httpsOrigin(this.options.platformUrl))
      || typeof frameCount !== "number" || !Number.isSafeInteger(frameCount) || frameCount < 0) return null;
    return {
      partIndex,
      runFrameOffset,
      frameCount,
      ...(typeof asset.metadata?.isFinalPart === "boolean" ? { isFinalPart: asset.metadata.isFinalPart } : {})
    };
  }

  private async recoverVisit(sessionId: string, startupAssetIds: ReadonlySet<string>): Promise<void> {
    let visit = this.store.getVisit(sessionId);
    const validAssetIds = await this.validateRecoveryChains(sessionId, startupAssetIds);
    visit = this.store.getVisit(sessionId);
    const replayAssets = visit.recordings.filter((candidate) => candidate.backend === replayBackend
      && validAssetIds.has(candidate.id));
    const incomplete = replayAssets
      .filter((candidate) => candidate.status === "recording" || candidate.status === "finalizing"
        || (candidate.status === "failed" && this.replayAssetHasDurableFile(sessionId, candidate)))
      .sort((left, right) => (replayPartIndex(right) ?? -1) - (replayPartIndex(left) ?? -1));
    for (const asset of incomplete) {
      const partIndex = replayPartIndex(asset);
      const currentAssets = this.store.getVisit(sessionId).recordings;
      const successor = partIndex === null ? undefined : currentAssets.find((candidate) => validAssetIds.has(candidate.id)
        && candidate.runId === asset.runId
        && replayPartIndex(candidate) === partIndex + 1);
      // validateRecoveryChains already proved every retained local or
      // remote-only part durable and contiguous. A pruned successor therefore
      // still owns the predecessor's non-final boundary.
      const hasSuccessor = successor !== undefined;
      await this.recoverAsset(visit, asset, hasSuccessor);
      visit = this.store.getVisit(sessionId);
    }
    await this.repairUnterminatedMultipartChains(this.store.getVisit(sessionId), validAssetIds);
  }

  private async validateRecoveryChains(
    sessionId: string,
    startupAssetIds: ReadonlySet<string>
  ): Promise<Set<string>> {
    const valid = new Set(startupAssetIds);
    const groups = new Map<string, RecordingAsset[]>();
    for (const asset of this.store.getVisit(sessionId).recordings) {
      if (!startupAssetIds.has(asset.id) || asset.backend !== replayBackend || replayPartIndex(asset) === null
        || !asset.runId) continue;
      const parts = groups.get(asset.runId) ?? [];
      parts.push(asset);
      groups.set(asset.runId, parts);
    }
    for (const [runId, unsorted] of groups) {
      const parts = unsorted.sort((left, right) => replayPartIndex(left)! - replayPartIndex(right)!);
      let expectedIndex = 0;
      let expectedOffset = 0;
      let finalSeen = false;
      for (let position = 0; position < parts.length; position += 1) {
        const asset = parts[position]!;
        const partIndex = replayPartIndex(asset)!;
        try {
          if (finalSeen || partIndex !== expectedIndex) {
            throw new Error("run replay recovery parts are not a contiguous index prefix");
          }
          const span = await this.replayPartSpan(sessionId, asset);
          if (span.partIndex !== expectedIndex || span.runFrameOffset !== expectedOffset) {
            throw new Error("run replay recovery frame offsets are not contiguous");
          }
          expectedIndex += 1;
          expectedOffset += span.frameCount;
          finalSeen = span.isFinalPart === true;
        } catch (error) {
          for (const invalid of parts.slice(position)) {
            valid.delete(invalid.id);
            this.quarantineReplayAssetFiles(sessionId, invalid);
            this.markFailed(sessionId, invalid, error);
          }
          this.options.log?.(`run replay recovery rejected a noncontiguous suffix for ${runId}`, error);
          break;
        }
      }
    }
    return valid;
  }

  private quarantineReplayAssetFiles(sessionId: string, asset: RecordingAsset): void {
    let paths;
    try {
      paths = recoveryReplayPaths(this.store.rootDir, sessionId, asset);
    } catch {
      return;
    }
    let moved = false;
    for (const path of [paths.journalPath, paths.finalPath]) {
      try {
        assertReplayFile(this.store.rootDir, sessionId, path);
        renameSync(path, `${path}.rejected-${randomUUID()}`);
        moved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          this.options.log?.(`run replay invalid asset ${asset.id} could not be quarantined safely`, error);
        }
      }
    }
    if (moved) fsyncDirectory(dirname(paths.finalPath));
  }

  private replayAssetHasDurableFile(sessionId: string, asset: RecordingAsset): boolean {
    try {
      const paths = recoveryReplayPaths(this.store.rootDir, sessionId, asset);
      ensureExistingReplayDirectory(this.store.rootDir, sessionId, dirname(paths.finalPath));
      return replayRegularFileExists(this.store.rootDir, sessionId, paths.finalPath)
        || replayRegularFileExists(this.store.rootDir, sessionId, paths.journalPath);
    } catch {
      return false;
    }
  }

  private async recoverAsset(visit: SessionHistoryVisit, asset: RecordingAsset, hasSuccessor: boolean): Promise<void> {
    if (!asset.runId || !safeRunId.test(asset.runId)) return this.markFailed(visit.id, asset, new Error("run replay id is invalid"));
    try {
      const paths = recoveryReplayPaths(this.store.rootDir, visit.id, asset);
      ensureExistingReplayDirectory(this.store.rootDir, visit.id, dirname(paths.finalPath));
      cleanupReplayTemps(paths.finalPath);
      let scan: ReplayScan;
      const finalExists = replayRegularFileExists(this.store.rootDir, visit.id, paths.finalPath);
      if (finalExists) {
        scan = await scanReplay(paths.finalPath, true, false);
        validateReplayScanIdentity(scan, visit.id, asset);
        try {
          assertReplayFile(this.store.rootDir, visit.id, paths.journalPath);
          unlinkSync(paths.journalPath);
          fsyncDirectory(dirname(paths.journalPath));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } else {
        assertReplayFile(this.store.rootDir, visit.id, paths.journalPath);
        repairJournal(paths.journalPath);
        scan = await scanReplay(paths.journalPath, false, true);
        validateReplayScanIdentity(scan, visit.id, asset);
        if (!scan.footer) {
          let footer = recoveredFooter(scan, this.now(), hasSuccessor);
          let footerLine = encodeRunReplayRecord(footer);
          const maximum = this.partLimits().jsonlBytes;
          if (scan.jsonlBytes + Buffer.byteLength(footerLine) > maximum
            && !hasSuccessor && scan.header.partIndex !== undefined) {
            footer = recoveredFooter(scan, this.now(), true);
            footerLine = encodeRunReplayRecord(footer);
          }
          if (scan.jsonlBytes + Buffer.byteLength(footerLine) > maximum) {
            throw new Error("run replay recovery footer exceeds the part byte limit");
          }
          appendDurable(paths.journalPath, footerLine);
          scan = { ...scan, footer, jsonlBytes: scan.jsonlBytes + Buffer.byteLength(footerLine) };
        }
        await compressJournal(paths.journalPath, paths.finalPath, this.store.rootDir, visit.id);
      }
      const footer = scan.footer;
      if (!footer) throw new Error("run replay footer is missing");
      const digest = await hashFile(paths.finalPath, this.store.rootDir, visit.id);
      this.store.upsertRecording(visit.id, {
        ...asset,
        status: footer.partial ? "partial" : "pending_upload",
        endedAtUnixMillis: footer.endedAtUnixMillis,
        localPath: paths.localPath,
        fileName: basename(paths.finalPath),
        contentType: RUN_REPLAY_CONTENT_TYPE,
        byteSize: digest.byteSize,
        sha256: digest.sha256,
        metadata: {
          ...(asset.metadata ?? {}),
          ...replayCounts(footer),
          ...(scan.header.partIndex === undefined ? {} : {
            partIndex: scan.header.partIndex,
            runFrameOffset: scan.header.runFrameOffset,
            isFinalPart: footer.isFinalPart,
            ...(footer.partCount === undefined ? {} : { partCount: footer.partCount })
          }),
          localComplete: true,
          recovered: true,
          partial: footer.partial
        }
      });
    } catch (error) {
      this.markFailed(visit.id, asset, error);
      this.options.log?.("run replay recovery failed", error);
    }
  }

  private async repairUnterminatedMultipartChains(
    visit: SessionHistoryVisit,
    startupAssetIds: ReadonlySet<string>
  ): Promise<void> {
    const runIds = new Set(visit.recordings
      .filter((asset) => startupAssetIds.has(asset.id) && asset.backend === replayBackend
        && replayPartIndex(asset) !== null && asset.runId)
      .map((asset) => asset.runId!));
    for (const runId of runIds) {
      const parts = this.store.getVisit(visit.id).recordings
        .filter((asset) => startupAssetIds.has(asset.id) && asset.backend === replayBackend
          && asset.runId === runId && replayPartIndex(asset) !== null)
        .sort((left, right) => replayPartIndex(left)! - replayPartIndex(right)!);
      const highest = parts.at(-1);
      if (!highest || highest.metadata?.isFinalPart === true
        || highest.status === "recording" || highest.status === "finalizing" || highest.status === "failed") continue;
      await this.createRecoveredTerminalPart(this.store.getVisit(visit.id), highest);
    }
  }

  private async createRecoveredTerminalPart(visit: SessionHistoryVisit, previous: RecordingAsset): Promise<void> {
    if (!previous.runId) return;
    const previousIndex = replayPartIndex(previous);
    if (previousIndex === null || previousIndex >= RUN_REPLAY_MAX_PART_INDEX) return;
    let previousHeader: RunReplayHeaderRecord;
    let previousFrameCount: number;
    if (previous.localPath) {
      const previousPath = safeLocalPath(this.store.rootDir, visit.id, previous.localPath);
      if (replayRegularFileExists(this.store.rootDir, visit.id, previousPath)) {
        const previousScan = await scanReplay(previousPath, true, false);
        validateReplayScanIdentity(previousScan, visit.id, previous);
        if (!previousScan.footer || previousScan.footer.isFinalPart !== false) return;
        previousHeader = previousScan.header;
        previousFrameCount = previousScan.footer.frameCount;
      } else {
        const remote = this.remoteReplayPartSpan(previous, previousIndex, Number(previous.metadata?.runFrameOffset));
        if (!remote || remote.isFinalPart !== false) return;
        previousHeader = replayHeaderFromRemoteAsset(visit, previous, remote);
        previousFrameCount = remote.frameCount;
      }
    } else {
      const remote = this.remoteReplayPartSpan(previous, previousIndex, Number(previous.metadata?.runFrameOffset));
      if (!remote || remote.isFinalPart !== false) return;
      previousHeader = replayHeaderFromRemoteAsset(visit, previous, remote);
      previousFrameCount = remote.frameCount;
    }
    const partIndex = previousIndex + 1;
    const runFrameOffset = (previousHeader.runFrameOffset ?? 0) + previousFrameCount;
    const assetId = replayPartAssetId(previous.runId, partIndex);
    const paths = replayPartPaths(this.store.rootDir, visit.id, assetId);
    ensureReplayDirectory(this.store.rootDir, visit.id, dirname(paths.finalPath));
    const at = this.now();
    const asset: RecordingAsset = {
      id: assetId,
      scope: "run",
      status: "recording",
      selectionId: previous.selectionId,
      runId: previous.runId,
      linkedRunIds: [previous.runId],
      startedAtUnixMillis: at,
      backend: replayBackend,
      localPath: paths.localPath,
      fileName: basename(paths.finalPath),
      contentType: RUN_REPLAY_CONTENT_TYPE,
      metadata: replayMetadataFromHeader(previousHeader, partIndex, runFrameOffset, false, false)
    };
    const header: RunReplayHeaderRecord = {
      ...previousHeader,
      assetId,
      partIndex,
      runFrameOffset,
      startedAtUnixMillis: at
    };
    const footer: RunReplayFooterRecord = {
      type: "footer",
      recordSequence: 1,
      endedAtUnixMillis: at,
      outcome: "runtime_interrupted",
      partial: true,
      frameCount: 0,
      inputCount: 0,
      eventCount: 0,
      checkpointCount: 0,
      partIndex,
      isFinalPart: true,
      partCount: partIndex + 1
    };
    let terminalJournalReady = false;
    for (let attempt = 0; attempt < 2 && !terminalJournalReady; attempt += 1) {
      try {
        const fd = openSync(paths.journalPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL
          | fsConstants.O_NOFOLLOW, 0o600);
        try {
          writeAll(fd, Buffer.from(encodeRunReplayRecord(header)));
          writeAll(fd, Buffer.from(encodeRunReplayRecord(footer)));
          fdatasyncSync(fd);
        } finally {
          closeSync(fd);
        }
        fsyncDirectory(dirname(paths.journalPath));
        terminalJournalReady = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        assertReplayFile(this.store.rootDir, visit.id, paths.journalPath);
        repairJournal(paths.journalPath);
        if (lstatSync(paths.journalPath).size === 0) {
          this.discardUnownedJournal(visit.id, paths.journalPath);
          continue;
        }
        const orphan = await scanReplay(paths.journalPath, false, true);
        validateReplayScanIdentity(orphan, visit.id, asset);
        if (!orphan.footer) appendDurable(paths.journalPath, encodeRunReplayRecord(footer));
        else if (orphan.footer.isFinalPart !== true || orphan.footer.partCount !== partIndex + 1) {
          throw new Error("run replay orphan terminal footer is invalid", { cause: error });
        }
        terminalJournalReady = true;
      }
    }
    if (!terminalJournalReady) throw new Error("run replay terminal journal could not be recovered");
    this.store.upsertRecording(visit.id, asset);
    this.store.upsertRecording(visit.id, {
      ...asset,
      status: "finalizing",
      endedAtUnixMillis: at,
      metadata: { ...(asset.metadata ?? {}), ...replayCounts(footer), partial: true, isFinalPart: true, partCount: partIndex + 1 }
    });
    const digest = await compressJournal(paths.journalPath, paths.finalPath, this.store.rootDir, visit.id);
    this.store.upsertRecording(visit.id, {
      ...asset,
      status: "partial",
      endedAtUnixMillis: at,
      byteSize: digest.byteSize,
      sha256: digest.sha256,
      metadata: {
        ...(asset.metadata ?? {}),
        ...replayCounts(footer),
        partial: true,
        isFinalPart: true,
        partCount: partIndex + 1,
        localComplete: true,
        recovered: true
      }
    });
  }

  private enqueue(operation: () => Promise<void>): void {
    this.operations = this.operations.then(operation).catch((error) => {
      this.options.log?.("run replay background operation failed", error);
    });
  }

  private async pruneLocalReplays(): Promise<void> {
    const maximum = normalizeReplayMaxLocalBytes(this.options.maxLocalBytes);
    const platformOrigin = httpsOrigin(this.options.platformUrl);
    const local: Array<{ visit: SessionHistoryVisit; asset: RecordingAsset; path: string; bytes: number }> = [];
    const missing: Array<{ visit: SessionHistoryVisit; asset: RecordingAsset }> = [];
    let total = 0;
    for (const visit of this.store.allVisits()) {
      for (const asset of visit.recordings) {
        if (asset.backend !== replayBackend || !asset.localPath) continue;
        const path = safeLocalPath(this.store.rootDir, visit.id, asset.localPath);
        let expected;
        try {
          expected = recoveryReplayPaths(this.store.rootDir, visit.id, asset);
          ensureExistingReplayDirectory(this.store.rootDir, visit.id, dirname(path));
        } catch (error) {
          this.options.log?.(`run replay ${asset.id} has an unsafe local path and was not considered for pruning`, error);
          continue;
        }
        if (expected.finalPath !== path) continue;
        let stats;
        try {
          stats = lstatSync(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            if (replayCanBePruned(asset, platformOrigin)) missing.push({ visit, asset });
            continue;
          }
          throw error;
        }
        if (!stats.isFile() || stats.isSymbolicLink()) continue;
        total += stats.size;
        local.push({ visit, asset, path, bytes: stats.size });
      }
    }
    for (const candidate of missing) {
      this.persistPrunedAsset(candidate.visit.id, candidate.asset, true);
    }
    if (total <= maximum) return;
    const eligible = local
      .filter(({ asset }) => replayCanBePruned(asset, platformOrigin))
      .sort((left, right) => (left.asset.endedAtUnixMillis ?? left.asset.startedAtUnixMillis ?? 0)
        - (right.asset.endedAtUnixMillis ?? right.asset.startedAtUnixMillis ?? 0)
        || left.asset.id.localeCompare(right.asset.id));
    for (const candidate of eligible) {
      if (total <= maximum) break;
      const digest = await hashFile(candidate.path, this.store.rootDir, candidate.visit.id);
      if (digest.byteSize !== candidate.asset.byteSize || digest.sha256 !== candidate.asset.sha256) {
        this.options.log?.(`run replay ${candidate.asset.id} was not pruned because its local integrity no longer matches the synced asset`);
        continue;
      }
      await this.options.afterPruneHash?.(structuredClone(candidate.asset));
      const current = this.store.getVisit(candidate.visit.id).recordings
        .find((asset) => asset.id === candidate.asset.id);
      if (!current || !replayCanBePruned(current, platformOrigin)
        || current.localPath !== candidate.asset.localPath
        || current.byteSize !== candidate.asset.byteSize
        || current.sha256 !== candidate.asset.sha256
        || replayRemoteIdentity(current) !== replayRemoteIdentity(candidate.asset)) {
        continue;
      }
      unlinkSync(candidate.path);
      fsyncDirectory(dirname(candidate.path));
      total -= candidate.bytes;
      this.persistPrunedAsset(candidate.visit.id, current, false);
    }
    if (total > maximum) {
      this.options.log?.(`run replay local cache exceeds ${maximum} bytes; no synced replay is eligible for pruning`);
    }
  }

  private persistPrunedAsset(sessionId: string, asset: RecordingAsset, recovered: boolean): void {
    const { localPath: _localPath, ...retained } = asset;
    this.store.upsertRecording(sessionId, {
      ...retained,
      metadata: {
        ...(asset.metadata ?? {}),
        localPruned: true,
        localPrunedAtUnixMillis: this.now(),
        ...(recovered ? { localPruneRecovered: true } : {})
      }
    });
  }

  private now(): number {
    return Math.max(0, Math.floor(this.options.now?.() ?? Date.now()));
  }
}

function replayHeader(
  input: RunReplayStart,
  assetId: string,
  partIndex: number,
  runFrameOffset: number,
  at: number
): RunReplayHeaderRecord {
  return {
    type: "header",
    schema: RUN_REPLAY_SCHEMA,
    contractVersion: RUN_REPLAY_CONTRACT_VERSION,
    sessionId: input.sessionId,
    selectionId: input.selectionId,
    runId: input.runId,
    gameId: input.gameId,
    engineGame: input.engineGame,
    sourceRevision: input.sourceRevision,
    ...(input.contentRevision ? { contentRevision: input.contentRevision } : {}),
    width: input.width,
    height: input.height,
    pixelFormat: "rgb24",
    pressureFormat: "row-major-bitset-lsb0",
    frameSource: "presented-frame",
    firstDesiredSequence: input.firstDesiredSequence.toString(),
    startedAtUnixMillis: at,
    assetId,
    partIndex,
    runFrameOffset
  };
}

function replayHeaderFromRemoteAsset(
  visit: SessionHistoryVisit,
  asset: RecordingAsset,
  span: ReplayPartSpan
): RunReplayHeaderRecord {
  const selection = visit.selections.find((candidate) => candidate.id === asset.selectionId
    && candidate.runs.some((run) => run.id === asset.runId));
  if (!selection || !asset.runId) throw new Error("run replay remote predecessor selection is invalid");
  const candidate = {
    type: "header",
    schema: RUN_REPLAY_SCHEMA,
    contractVersion: RUN_REPLAY_CONTRACT_VERSION,
    sessionId: visit.id,
    selectionId: selection.id,
    runId: asset.runId,
    gameId: selection.gameId,
    engineGame: selection.engineGame,
    sourceRevision: selection.sourceRevision,
    ...(selection.contentRevision ? { contentRevision: selection.contentRevision } : {}),
    width: asset.metadata?.width,
    height: asset.metadata?.height,
    pixelFormat: "rgb24",
    pressureFormat: "row-major-bitset-lsb0",
    frameSource: "presented-frame",
    firstDesiredSequence: asset.metadata?.firstDesiredSequence,
    startedAtUnixMillis: asset.startedAtUnixMillis ?? visit.startedAtUnixMillis,
    assetId: asset.id,
    partIndex: span.partIndex,
    runFrameOffset: span.runFrameOffset
  };
  const decoded = decodeRunReplayRecord(JSON.stringify(candidate));
  if (decoded.type !== "header") throw new Error("run replay remote predecessor header is invalid");
  return decoded;
}

function replayMetadata(
  input: RunReplayStart,
  partIndex: number,
  runFrameOffset: number,
  partial: boolean,
  isFinalPart: boolean
): RecordingAsset["metadata"] {
  return replayMetadataFields(input.width, input.height, input.firstDesiredSequence.toString(), partIndex,
    runFrameOffset, partial, isFinalPart);
}

function replayMetadataFromHeader(
  header: RunReplayHeaderRecord,
  partIndex: number,
  runFrameOffset: number,
  partial: boolean,
  isFinalPart: boolean
): RecordingAsset["metadata"] {
  return replayMetadataFields(header.width, header.height, header.firstDesiredSequence, partIndex,
    runFrameOffset, partial, isFinalPart);
}

function replayMetadataFields(
  width: number,
  height: number,
  firstDesiredSequence: string,
  partIndex: number,
  runFrameOffset: number,
  partial: boolean,
  isFinalPart: boolean
): RecordingAsset["metadata"] {
  return {
    schema: RUN_REPLAY_SCHEMA,
    contractVersion: RUN_REPLAY_CONTRACT_VERSION,
    compression: RUN_REPLAY_COMPRESSION,
    frameEncoding: "rgb24-pressure-keyframe-delta-v1",
    frameSource: "presented-frame",
    width,
    height,
    firstDesiredSequence,
    partIndex,
    runFrameOffset,
    isFinalPart,
    partial
  };
}

function replayCounts(footer: RunReplayFooterRecord): NonNullable<RecordingAsset["metadata"]> {
  return {
    frameCount: footer.frameCount,
    inputCount: footer.inputCount,
    eventCount: footer.eventCount,
    checkpointCount: footer.checkpointCount,
    outcome: footer.outcome,
    ...(footer.partIndex === undefined ? {} : { partIndex: footer.partIndex }),
    ...(footer.isFinalPart === undefined ? {} : { isFinalPart: footer.isFinalPart }),
    ...(footer.partCount === undefined ? {} : { partCount: footer.partCount }),
    ...(footer.firstPresentationSequence ? { firstPresentationSequence: footer.firstPresentationSequence } : {}),
    ...(footer.lastPresentationSequence ? { lastPresentationSequence: footer.lastPresentationSequence } : {})
  };
}

function legacyReplayAssetId(runId: string): string {
  return `run-replay-${runId}`;
}

export function replayPartAssetId(runId: string, partIndex: number): string {
  if (!safeRunId.test(runId) || !Number.isSafeInteger(partIndex) || partIndex < 0
    || partIndex > RUN_REPLAY_MAX_PART_INDEX) throw new Error("run replay part identity is invalid");
  const digest = createHash("sha256").update(runId, "utf8").digest("hex");
  return `run-replay-${digest}-part-${String(partIndex).padStart(6, "0")}`;
}

function replayPartPaths(rootDir: string, sessionId: string, assetId: string): {
  journalPath: string;
  finalPath: string;
  localPath: string;
} {
  if (!/^run-replay-[0-9a-f]{64}-part-[0-9]{6}$/u.test(assetId)) {
    throw new Error("run replay asset identity is invalid");
  }
  const localPath = join("replays", `${assetId}${RUN_REPLAY_FILE_EXTENSION}`);
  const directory = join(rootDir, sessionId, "replays");
  return {
    journalPath: join(directory, `${assetId}${journalSuffix}`),
    finalPath: join(directory, `${assetId}${RUN_REPLAY_FILE_EXTENSION}`),
    localPath
  };
}

function replayPartIndex(asset: RecordingAsset): number | null {
  const value = asset.metadata?.partIndex;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0
    || value > RUN_REPLAY_MAX_PART_INDEX) return null;
  return value;
}

function recoveryReplayPaths(rootDir: string, sessionId: string, asset: RecordingAsset): {
  journalPath: string;
  finalPath: string;
  localPath: string;
} {
  if (!asset.runId || !safeRunId.test(asset.runId)) throw new Error("run replay id is invalid");
  const partIndex = replayPartIndex(asset);
  if (partIndex !== null) {
    const expectedId = replayPartAssetId(asset.runId, partIndex);
    if (asset.id !== expectedId) throw new Error("run replay asset identity is invalid");
    const paths = replayPartPaths(rootDir, sessionId, expectedId);
    if (asset.localPath !== paths.localPath || asset.fileName !== basename(paths.finalPath)) {
      throw new Error("run replay asset path is invalid");
    }
    return paths;
  }
  if (asset.id !== legacyReplayAssetId(asset.runId)) throw new Error("run replay legacy asset identity is invalid");
  const localPath = join("replays", `${asset.runId}${RUN_REPLAY_FILE_EXTENSION}`);
  if (asset.localPath !== localPath || asset.fileName !== basename(localPath)) {
    throw new Error("run replay legacy asset path is invalid");
  }
  const directory = join(rootDir, sessionId, "replays");
  return {
    journalPath: join(directory, `${asset.runId}${journalSuffix}`),
    finalPath: join(directory, `${asset.runId}${RUN_REPLAY_FILE_EXTENSION}`),
    localPath
  };
}

function validateReplayScanIdentity(scan: ReplayScan, sessionId: string, asset: RecordingAsset): void {
  if (scan.header.sessionId !== sessionId || scan.header.selectionId !== asset.selectionId
    || scan.header.runId !== asset.runId) throw new Error("run replay identity does not match its recording asset");
  const partIndex = replayPartIndex(asset);
  if (partIndex === null) {
    if (scan.header.assetId !== undefined || scan.header.partIndex !== undefined
      || scan.header.runFrameOffset !== undefined) throw new Error("legacy run replay contains multipart identity");
    return;
  }
  if (scan.header.assetId !== asset.id || scan.header.partIndex !== partIndex
    || scan.header.runFrameOffset !== asset.metadata?.runFrameOffset) {
    throw new Error("run replay part identity does not match its recording asset");
  }
}

function replayFooter(
  writer: ActiveWriter,
  outcome: string,
  partial: boolean,
  isFinalPart: boolean,
  endedAtUnixMillis: number
): RunReplayFooterRecord {
  return {
    type: "footer",
    recordSequence: writer.recordSequence + 1,
    endedAtUnixMillis,
    outcome: isFinalPart ? outcome : "continued",
    partial: isFinalPart ? partial : false,
    frameCount: writer.frameCount,
    inputCount: writer.inputCount,
    eventCount: writer.eventCount,
    checkpointCount: writer.checkpointCount,
    ...(writer.firstPresentationSequence ? { firstPresentationSequence: writer.firstPresentationSequence } : {}),
    ...(writer.lastPresentationSequence ? { lastPresentationSequence: writer.lastPresentationSequence } : {}),
    partIndex: writer.partIndex,
    isFinalPart,
    ...(isFinalPart ? { partCount: writer.partIndex + 1 } : {})
  };
}

function projectedFooter(
  writer: ActiveWriter,
  record: Exclude<RunReplayRecord, RunReplayHeaderRecord | RunReplayFooterRecord>,
  endedAtUnixMillis: number
): RunReplayFooterRecord {
  const frameCount = writer.frameCount + (record.type === "frame" ? 1 : 0);
  const inputCount = writer.inputCount + (record.type === "input" ? 1 : 0);
  const eventCount = writer.eventCount + (record.type === "game-event" ? 1 : 0);
  const checkpointCount = writer.checkpointCount + (record.type === "checkpoint" ? 1 : 0);
  const firstPresentationSequence = writer.firstPresentationSequence
    ?? (record.type === "frame" ? record.presentationSequence : undefined);
  const lastPresentationSequence = record.type === "frame"
    ? record.presentationSequence
    : writer.lastPresentationSequence;
  return {
    type: "footer",
    recordSequence: record.recordSequence + 1,
    endedAtUnixMillis,
    outcome: "continued",
    partial: false,
    frameCount,
    inputCount,
    eventCount,
    checkpointCount,
    ...(firstPresentationSequence ? { firstPresentationSequence } : {}),
    ...(lastPresentationSequence ? { lastPresentationSequence } : {}),
    partIndex: writer.partIndex,
    isFinalPart: false
  };
}

function safeLocalPath(rootDir: string, sessionId: string, localPath: string): string {
  const visitRoot = resolve(rootDir, sessionId);
  const path = resolve(visitRoot, localPath);
  if (path !== visitRoot && !path.startsWith(`${visitRoot}${sep}`)) {
    throw new SessionHistoryNotFoundError("run replay not found");
  }
  return path;
}

function ensureReplayDirectory(rootDir: string, sessionId: string, directory: string): void {
  const expected = resolve(rootDir, sessionId, "replays");
  if (resolve(directory) !== expected) throw new Error("run replay directory is invalid");
  assertRealDirectoryContained(rootDir, resolve(rootDir, sessionId));
  try {
    const stats = lstatSync(expected);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("run replay directory is unsafe");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    mkdirSync(expected, { mode: 0o700 });
    fsyncDirectory(dirname(expected));
  }
  assertRealDirectoryContained(resolve(rootDir, sessionId), expected);
}

function ensureExistingReplayDirectory(rootDir: string, sessionId: string, directory: string): void {
  const expected = resolve(rootDir, sessionId, "replays");
  if (resolve(directory) !== expected) throw new Error("run replay directory is invalid");
  assertRealDirectoryContained(rootDir, resolve(rootDir, sessionId));
  assertRealDirectoryContained(resolve(rootDir, sessionId), expected);
}

function assertRealDirectoryContained(parent: string, child: string): void {
  const childStats = lstatSync(child);
  if (!childStats.isDirectory() || childStats.isSymbolicLink()) throw new Error("run replay directory is unsafe");
  const realParent = realpathSync(parent);
  const realChild = realpathSync(child);
  if (realChild !== realParent && !realChild.startsWith(`${realParent}${sep}`)) {
    throw new Error("run replay directory escapes its history root");
  }
}

function assertReplayFile(rootDir: string, sessionId: string, path: string): void {
  ensureExistingReplayDirectory(rootDir, sessionId, dirname(path));
  const expectedDirectory = resolve(rootDir, sessionId, "replays");
  if (dirname(resolve(path)) !== expectedDirectory) throw new Error("run replay file path is invalid");
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new SessionHistoryNotFoundError("run replay not found");
  }
  const realDirectory = realpathSync(expectedDirectory);
  const realPath = realpathSync(path);
  if (!realPath.startsWith(`${realDirectory}${sep}`)) {
    throw new SessionHistoryNotFoundError("run replay not found");
  }
}

function replayRegularFileExists(rootDir: string, sessionId: string, path: string): boolean {
  try {
    assertReplayFile(rootDir, sessionId, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function openReplayReadFile(rootDir: string, sessionId: string, path: string): number {
  try {
    assertReplayFile(rootDir, sessionId, path);
    const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      if (!fstatSync(fd).isFile()) throw new SessionHistoryNotFoundError("run replay not found");
      return fd;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  } catch (error) {
    if (error instanceof SessionHistoryNotFoundError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new SessionHistoryNotFoundError("run replay not found");
    }
    throw new SessionHistoryNotFoundError("run replay not found");
  }
}

function replayJsonObject(value: unknown): RunReplayJsonObject {
  const normalized = normalizeJson(value);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new Error("run replay snapshot must be an object");
  }
  return normalized;
}

function normalizeJson(value: unknown): RunReplayJsonObject | RunReplayJsonObject[keyof RunReplayJsonObject] {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("run replay cannot encode non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry) => entry === undefined ? null : normalizeJson(entry));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, normalizeJson(entry)]));
  }
  throw new Error(`run replay cannot encode ${typeof value}`);
}

async function compressJournal(
  journalPath: string,
  finalPath: string,
  rootDir: string,
  sessionId: string
): Promise<{ byteSize: number; sha256: string }> {
  assertReplayFile(rootDir, sessionId, journalPath);
  ensureExistingReplayDirectory(rootDir, sessionId, dirname(finalPath));
  try {
    lstatSync(finalPath);
    throw new Error("run replay final file already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  const hash = createHash("sha256");
  let byteSize = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.byteLength;
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    await pipeline(
      noFollowReadStream(journalPath),
      createGzip({ level: 9 }),
      meter,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 })
    );
    const fd = openSync(temporary, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, finalPath);
    fsyncDirectory(dirname(finalPath));
    unlinkSync(journalPath);
    fsyncDirectory(dirname(finalPath));
    return { byteSize, sha256: hash.digest("hex") };
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* a failed stream may not have created it */ }
    throw error;
  }
}

function repairJournal(path: string): void {
  const fd = openSync(path, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW);
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return;
    const finalByte = Buffer.allocUnsafe(1);
    readSync(fd, finalByte, 0, 1, size - 1);
    if (finalByte[0] === 0x0a) return;
    const chunkSize = 64 * 1024;
    let cursor = size;
    while (cursor > 0) {
      const start = Math.max(0, cursor - chunkSize);
      const chunk = Buffer.allocUnsafe(cursor - start);
      readSync(fd, chunk, 0, chunk.byteLength, start);
      const newline = chunk.lastIndexOf(0x0a);
      if (newline >= 0) {
        ftruncateSync(fd, start + newline + 1);
        fdatasyncSync(fd);
        return;
      }
      cursor = start;
    }
    ftruncateSync(fd, 0);
    fdatasyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function recoveredFooter(scan: ReplayScan, endedAtUnixMillis: number, hasSuccessor: boolean): RunReplayFooterRecord {
  const multipart = scan.header.partIndex !== undefined;
  const isFinalPart = !hasSuccessor;
  return {
    type: "footer",
    recordSequence: scan.lastRecordSequence + 1,
    endedAtUnixMillis,
    outcome: isFinalPart ? "runtime_interrupted" : "continued",
    partial: isFinalPart,
    frameCount: scan.frameCount,
    inputCount: scan.inputCount,
    eventCount: scan.eventCount,
    checkpointCount: scan.checkpointCount,
    ...(scan.firstPresentationSequence ? { firstPresentationSequence: scan.firstPresentationSequence } : {}),
    ...(scan.lastPresentationSequence ? { lastPresentationSequence: scan.lastPresentationSequence } : {}),
    ...(multipart ? {
      partIndex: scan.header.partIndex,
      isFinalPart,
      ...(isFinalPart ? { partCount: (scan.header.partIndex ?? 0) + 1 } : {})
    } : {})
  };
}

async function scanReplay(path: string, compressed: boolean, allowIncomplete: boolean): Promise<ReplayScan> {
  const file = noFollowReadStream(path);
  const input = compressed ? file.pipe(createGunzip()) : file;
  const lines = createInterface({ input, crlfDelay: Infinity });
  let header: RunReplayHeaderRecord | undefined;
  let footer: RunReplayFooterRecord | undefined;
  let lastRecordSequence = 0;
  let frameCount = 0;
  let inputCount = 0;
  let eventCount = 0;
  let checkpointCount = 0;
  let firstPresentationSequence: string | undefined;
  let lastPresentationSequence: string | undefined;
  let bodyRecordCount = 0;
  let jsonlBytes = 0;
  for await (const line of lines) {
    if (!line) continue;
    jsonlBytes += Buffer.byteLength(line) + 1;
    if (jsonlBytes > RUN_REPLAY_MAX_PART_JSONL_BYTES) {
      throw new Error("Run replay part exceeds the maximum encoded size");
    }
    const record = decodeRunReplayRecord(line);
    if (!header) {
      if (record.type !== "header") throw new Error("Run replay header is missing");
      header = record;
      continue;
    }
    if (record.type === "header" || footer) throw new Error("Run replay record order is invalid");
    if (record.recordSequence !== lastRecordSequence + 1) {
      throw new Error("Run replay record sequences must be contiguous");
    }
    lastRecordSequence = record.recordSequence;
    if (record.type !== "footer") {
      bodyRecordCount += 1;
      if (bodyRecordCount > RUN_REPLAY_MAX_PART_BODY_RECORDS) {
        throw new Error("Run replay part exceeds the maximum body record count");
      }
    }
    if (record.type === "frame") {
      frameCount += 1;
      if (frameCount > RUN_REPLAY_MAX_PART_FRAMES) {
        throw new Error("Run replay part exceeds the maximum frame count");
      }
      if (frameCount === 1 && header.partIndex !== undefined
        && (record.rgb.encoding !== "keyframe" || record.pressure.encoding !== "keyframe")) {
        throw new Error("Run replay multipart parts must begin with a keyframe");
      }
      firstPresentationSequence ??= record.presentationSequence;
      lastPresentationSequence = record.presentationSequence;
    } else if (record.type === "input") {
      if (record.x >= header.width || record.y >= header.height) {
        throw new Error("Run replay input coordinate is outside the declared floor");
      }
      inputCount += 1;
    }
    else if (record.type === "game-event") eventCount += 1;
    else if (record.type === "checkpoint") checkpointCount += 1;
    else footer = record;
  }
  if (!header) throw new Error("Run replay header is missing");
  if (!allowIncomplete && !footer) throw new Error("Run replay footer is missing");
  if (footer && header.partIndex !== undefined) {
    if (footer.partIndex !== header.partIndex) throw new Error("Run replay footer partIndex does not match its header");
    if (footer.isFinalPart) {
      if (footer.partCount !== header.partIndex + 1 || footer.outcome === "continued") {
        throw new Error("Run replay final part footer is invalid");
      }
    } else if (footer.outcome !== "continued" || footer.partial || footer.partCount !== undefined) {
      throw new Error("Run replay continued part footer is invalid");
    }
  } else if (footer && (footer.partIndex !== undefined || footer.isFinalPart !== undefined
    || footer.partCount !== undefined)) {
    throw new Error("Run replay legacy footer cannot contain multipart fields");
  }
  if (footer && (footer.frameCount !== frameCount || footer.inputCount !== inputCount
    || footer.eventCount !== eventCount || footer.checkpointCount !== checkpointCount)) {
    throw new Error("Run replay footer counts do not match its records");
  }
  if (footer && (footer.firstPresentationSequence !== firstPresentationSequence
    || footer.lastPresentationSequence !== lastPresentationSequence)
    && (frameCount > 0 || footer.firstPresentationSequence !== undefined
      || footer.lastPresentationSequence !== undefined)) {
    throw new Error("Run replay footer presentation bounds do not match its frames");
  }
  return {
    header,
    footer,
    jsonlBytes,
    lastRecordSequence,
    frameCount,
    inputCount,
    eventCount,
    checkpointCount,
    firstPresentationSequence,
    lastPresentationSequence
  };
}

function appendDurable(path: string, line: string): void {
  const fd = openSync(path, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW, 0o600);
  try {
    const bytes = Buffer.from(line);
    let offset = 0;
    while (offset < bytes.byteLength) offset += writeSync(fd, bytes, offset, bytes.byteLength - offset);
    fdatasyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

async function hashFile(
  path: string,
  rootDir: string,
  sessionId: string
): Promise<{ byteSize: number; sha256: string }> {
  assertReplayFile(rootDir, sessionId, path);
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of noFollowReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteSize += bytes.byteLength;
    hash.update(bytes);
  }
  return { byteSize, sha256: hash.digest("hex") };
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.byteLength) offset += writeSync(fd, bytes, offset, bytes.byteLength - offset);
}

function noFollowReadStream(path: string): ReturnType<typeof createReadStream> {
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  return createReadStream(path, { fd, autoClose: true });
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function cleanupReplayTemps(finalPath: string): void {
  const directory = dirname(finalPath);
  const prefix = `${basename(finalPath)}.`;
  const pattern = new RegExp(`^${escapeRegExp(prefix)}[1-9][0-9]*\\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.tmp$`, "iu");
  let removed = false;
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !pattern.test(entry.name)) continue;
      unlinkSync(join(directory, entry.name));
      removed = true;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (removed) fsyncDirectory(directory);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function normalizeReplayMaxLocalBytes(value: unknown): number {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : defaultReplayMaxLocalBytes;
}

function boundedReplayPartLimit(value: unknown, maximum: number): number {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? Math.min(candidate, maximum) : maximum;
}

function replayCanBePruned(asset: RecordingAsset, platformOrigin: string | null): boolean {
  if (!platformOrigin || asset.status !== "complete"
    || !Number.isSafeInteger(asset.byteSize) || (asset.byteSize ?? 0) < 1
    || !/^[0-9a-f]{64}$/u.test(asset.sha256 ?? "")) return false;
  return [asset.downloadUrl, asset.remoteUrl].some((value) => {
    try {
      const url = new URL(value ?? "");
      return url.protocol === "https:" && url.origin === platformOrigin;
    } catch {
      return false;
    }
  });
}

function replayRemoteIdentity(asset: RecordingAsset): string {
  return JSON.stringify({
    status: asset.status,
    remoteUrl: asset.remoteUrl ?? null,
    downloadUrl: asset.downloadUrl ?? null,
    platformUpload: asset.metadata?.platformUpload ?? null
  });
}

function httpsOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
