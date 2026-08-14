import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  fdatasyncSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  truncateSync,
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
  previousRgb?: Uint8Array;
  previousPressure?: Uint8Array;
  recordSequence: number;
  frameCount: number;
  inputCount: number;
  eventCount: number;
  checkpointCount: number;
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
  lastRecordSequence: number;
  frameCount: number;
  inputCount: number;
  eventCount: number;
  checkpointCount: number;
  firstPresentationSequence?: string;
  lastPresentationSequence?: string;
};

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
    const paths = replayPaths(this.store.rootDir, input.sessionId, input.runId);
    mkdirSync(dirname(paths.finalPath), { recursive: true, mode: 0o700 });
    const at = this.now();
    const asset: RecordingAsset = {
      id: replayAssetId(input.runId),
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
      metadata: replayMetadata(input, false)
    };
    this.store.upsertRecording(input.sessionId, asset);
    let fd: number | undefined;
    try {
      fd = openSync(paths.journalPath, "wx", 0o600);
      const writer: ActiveWriter = {
        input: { ...input },
        asset,
        fd,
        journalPath: paths.journalPath,
        finalPath: paths.finalPath,
        recordSequence: 0,
        frameCount: 0,
        inputCount: 0,
        eventCount: 0,
        checkpointCount: 0,
        lastCheckpointEngineMillis: input.state.clockMillis,
        lastPhase: String(input.state.snapshot.phase || ""),
        lastSyncAtUnixMillis: at
      };
      this.appendRaw(writer, encodeRunReplayRecord(replayHeader(input, at)), true);
      fsyncDirectory(dirname(paths.journalPath));
      this.writers.set(input.runId, writer);
      this.activeRunId = input.runId;
      this.observeState(input.runId, input.state, "initial");
      return { ...asset };
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      this.markFailed(input.sessionId, asset, error);
      this.options.log?.("run replay start failed", error);
      return null;
    }
  }

  observeState(runId: string, state: GameSessionState, forcedReason?: RunReplayCheckpointRecord["reason"]): void {
    const writer = this.writers.get(runId);
    if (!writer || writer.pendingClose) return;
    const at = this.now();
    for (const event of state.events) {
      if (!this.append(writer, {
        type: "game-event",
        recordSequence: this.nextSequence(writer),
        occurredAtUnixMillis: at,
        engineAtMillis: state.clockMillis,
        eventAtMillis: event.atMillis,
        cue: event.cue,
        message: event.message
      }, true)) return;
      writer.eventCount += 1;
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
    if (!this.append(writer, {
      type: "checkpoint",
      recordSequence: this.nextSequence(writer),
      occurredAtUnixMillis: at,
      engineAtMillis: state.clockMillis,
      reason,
      paused: state.paused,
      snapshot
    }, reason !== "periodic")) return;
    writer.checkpointCount += 1;
    writer.lastCheckpointEngineMillis = state.clockMillis;
  }

  observeInput(
    runId: string,
    input: { source: "physical" | "remote" | "restored"; x: number; y: number; pressed: boolean; occurredAtUnixMillis: number; engineAtMillis: number }
  ): void {
    const writer = this.writers.get(runId);
    if (!writer || writer.pendingClose) return;
    if (!this.append(writer, {
      type: "input",
      recordSequence: this.nextSequence(writer),
      ...input
    }, true)) return;
    writer.inputCount += 1;
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
      const forceKeyframe = writer.frameCount % keyframeInterval === 0;
      const record: RunReplayFrameRecord = {
        type: "frame",
        recordSequence: this.nextSequence(writer),
        presentationSequence: frame.presentationSequence.toString(),
        desiredSequence: frame.desiredSequence.toString(),
        presentedUnixNanos: frame.presentedUnixNanos.toString(),
        engineAtMillis,
        fadeRatio: frame.fadeRatio,
        rgb: encodeRunReplayByteField(frame.rgb, writer.previousRgb, forceKeyframe),
        pressure: encodeRunReplayByteField(frame.pressureBits, writer.previousPressure, forceKeyframe)
      };
      if (!this.append(writer, record, false)) return;
      writer.previousRgb = frame.rgb.slice();
      writer.previousPressure = frame.pressureBits.slice();
      writer.frameCount += 1;
      writer.firstPresentationSequence ??= record.presentationSequence;
      writer.lastPresentationSequence = record.presentationSequence;
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

  read(sessionId: string, runId: string): RunReplayRead {
    if (!safeRunId.test(runId)) throw new SessionHistoryNotFoundError("run replay not found");
    const visit = this.store.getVisit(sessionId);
    const asset = visit.recordings.find((candidate) => candidate.id === replayAssetId(runId)
      && candidate.backend === replayBackend && candidate.runId === runId);
    if (!asset?.localPath) throw new SessionHistoryNotFoundError("run replay not found");
    const path = safeLocalPath(this.store.rootDir, sessionId, asset.localPath);
    try {
      if (!statSync(path).isFile()) throw new SessionHistoryNotFoundError("run replay not found");
    } catch (error) {
      if (error instanceof SessionHistoryNotFoundError) throw error;
      throw new SessionHistoryConflictError("run replay is not finalized");
    }
    return { path, asset: structuredClone(asset) };
  }

  private append(writer: ActiveWriter, record: Exclude<RunReplayRecord, RunReplayHeaderRecord>, sync: boolean): boolean {
    try {
      this.appendRaw(writer, encodeRunReplayRecord(record), sync);
      return true;
    } catch (error) {
      this.abortWriter(writer, error);
      return false;
    }
  }

  private appendRaw(writer: ActiveWriter, line: string, sync: boolean): void {
    const bytes = Buffer.from(line);
    let offset = 0;
    while (offset < bytes.byteLength) offset += writeSync(writer.fd, bytes, offset, bytes.byteLength - offset);
    const at = this.now();
    if (sync || at - writer.lastSyncAtUnixMillis >= dataSyncIntervalMillis) {
      fdatasyncSync(writer.fd);
      writer.lastSyncAtUnixMillis = at;
    }
  }

  private nextSequence(writer: ActiveWriter): number {
    writer.recordSequence += 1;
    return writer.recordSequence;
  }

  private finalize(writer: ActiveWriter, outcome: string, partial: boolean): void {
    if (!this.writers.has(writer.input.runId)) return;
    try {
      const footer: RunReplayFooterRecord = {
        type: "footer",
        recordSequence: this.nextSequence(writer),
        endedAtUnixMillis: this.now(),
        outcome,
        partial,
        frameCount: writer.frameCount,
        inputCount: writer.inputCount,
        eventCount: writer.eventCount,
        checkpointCount: writer.checkpointCount,
        ...(writer.firstPresentationSequence ? { firstPresentationSequence: writer.firstPresentationSequence } : {}),
        ...(writer.lastPresentationSequence ? { lastPresentationSequence: writer.lastPresentationSequence } : {})
      };
      this.appendRaw(writer, encodeRunReplayRecord(footer), true);
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
          partial
        }
      });
      this.enqueue(async () => {
        try {
          const result = await compressJournal(writer.journalPath, writer.finalPath);
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
              partial
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
      this.writers.delete(writer.input.runId);
      if (this.activeRunId === writer.input.runId) this.activeRunId = "";
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
      for (const asset of visit.recordings.filter((candidate) => candidate.backend === replayBackend
        && (candidate.status === "recording" || candidate.status === "finalizing"))) {
        this.enqueue(() => this.recoverAsset(visit, asset));
      }
    }
    this.enqueue(() => this.pruneLocalReplays());
  }

  private async recoverAsset(visit: SessionHistoryVisit, asset: RecordingAsset): Promise<void> {
    if (!asset.runId || !safeRunId.test(asset.runId)) return this.markFailed(visit.id, asset, new Error("run replay id is invalid"));
    const paths = replayPaths(this.store.rootDir, visit.id, asset.runId);
    try {
      cleanupReplayTemps(paths.finalPath);
      let scan: ReplayScan;
      let finalExists = false;
      try {
        finalExists = statSync(paths.finalPath).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (finalExists) {
        scan = await scanReplay(paths.finalPath, true, false);
        try {
          unlinkSync(paths.journalPath);
          fsyncDirectory(dirname(paths.journalPath));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } else {
        repairJournal(paths.journalPath);
        scan = await scanReplay(paths.journalPath, false, true);
        if (!scan.footer) {
          const footer = recoveredFooter(scan, this.now());
          appendDurable(paths.journalPath, encodeRunReplayRecord(footer));
          scan = { ...scan, footer };
        }
        await compressJournal(paths.journalPath, paths.finalPath);
      }
      const footer = scan.footer;
      if (!footer) throw new Error("run replay footer is missing");
      const digest = await hashFile(paths.finalPath);
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
      const digest = await hashFile(candidate.path);
      if (digest.byteSize !== candidate.asset.byteSize || digest.sha256 !== candidate.asset.sha256) {
        this.options.log?.(`run replay ${candidate.asset.id} was not pruned because its local integrity no longer matches the synced asset`);
        continue;
      }
      unlinkSync(candidate.path);
      fsyncDirectory(dirname(candidate.path));
      total -= candidate.bytes;
      this.persistPrunedAsset(candidate.visit.id, candidate.asset, false);
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

function replayHeader(input: RunReplayStart, at: number): RunReplayHeaderRecord {
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
    startedAtUnixMillis: at
  };
}

function replayMetadata(input: RunReplayStart, partial: boolean): RecordingAsset["metadata"] {
  return {
    schema: RUN_REPLAY_SCHEMA,
    contractVersion: RUN_REPLAY_CONTRACT_VERSION,
    compression: RUN_REPLAY_COMPRESSION,
    frameEncoding: "rgb24-pressure-keyframe-delta-v1",
    frameSource: "presented-frame",
    width: input.width,
    height: input.height,
    firstDesiredSequence: input.firstDesiredSequence.toString(),
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
    ...(footer.firstPresentationSequence ? { firstPresentationSequence: footer.firstPresentationSequence } : {}),
    ...(footer.lastPresentationSequence ? { lastPresentationSequence: footer.lastPresentationSequence } : {})
  };
}

function replayAssetId(runId: string): string {
  return `run-replay-${runId}`;
}

function replayPaths(rootDir: string, sessionId: string, runId: string): {
  journalPath: string;
  finalPath: string;
  localPath: string;
} {
  if (!safeRunId.test(runId)) throw new Error("run replay id is invalid");
  const localPath = join("replays", `${runId}${RUN_REPLAY_FILE_EXTENSION}`);
  const directory = join(rootDir, sessionId, "replays");
  return {
    journalPath: join(directory, `${runId}${journalSuffix}`),
    finalPath: join(directory, `${runId}${RUN_REPLAY_FILE_EXTENSION}`),
    localPath
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

async function compressJournal(journalPath: string, finalPath: string): Promise<{ byteSize: number; sha256: string }> {
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
      createReadStream(journalPath),
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
  const fd = openSync(path, "r+");
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
        truncateSync(path, start + newline + 1);
        return;
      }
      cursor = start;
    }
    truncateSync(path, 0);
  } finally {
    closeSync(fd);
  }
}

function recoveredFooter(scan: ReplayScan, endedAtUnixMillis: number): RunReplayFooterRecord {
  return {
    type: "footer",
    recordSequence: scan.lastRecordSequence + 1,
    endedAtUnixMillis,
    outcome: "runtime_interrupted",
    partial: true,
    frameCount: scan.frameCount,
    inputCount: scan.inputCount,
    eventCount: scan.eventCount,
    checkpointCount: scan.checkpointCount,
    ...(scan.firstPresentationSequence ? { firstPresentationSequence: scan.firstPresentationSequence } : {}),
    ...(scan.lastPresentationSequence ? { lastPresentationSequence: scan.lastPresentationSequence } : {})
  };
}

async function scanReplay(path: string, compressed: boolean, allowIncomplete: boolean): Promise<ReplayScan> {
  const file = createReadStream(path);
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
  for await (const line of lines) {
    if (!line) continue;
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
    if (record.type === "frame") {
      frameCount += 1;
      firstPresentationSequence ??= record.presentationSequence;
      lastPresentationSequence = record.presentationSequence;
    } else if (record.type === "input") inputCount += 1;
    else if (record.type === "game-event") eventCount += 1;
    else if (record.type === "checkpoint") checkpointCount += 1;
    else footer = record;
  }
  if (!header) throw new Error("Run replay header is missing");
  if (!allowIncomplete && !footer) throw new Error("Run replay footer is missing");
  if (footer && (footer.frameCount !== frameCount || footer.inputCount !== inputCount
    || footer.eventCount !== eventCount || footer.checkpointCount !== checkpointCount)) {
    throw new Error("Run replay footer counts do not match its records");
  }
  return {
    header,
    footer,
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
  const fd = openSync(path, "a", 0o600);
  try {
    const bytes = Buffer.from(line);
    let offset = 0;
    while (offset < bytes.byteLength) offset += writeSync(fd, bytes, offset, bytes.byteLength - offset);
    fdatasyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

async function hashFile(path: string): Promise<{ byteSize: number; sha256: string }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteSize += bytes.byteLength;
    hash.update(bytes);
  }
  return { byteSize, sha256: hash.digest("hex") };
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

function replayCanBePruned(asset: RecordingAsset, platformOrigin: string | null): boolean {
  if (!platformOrigin || asset.status !== "complete" || asset.metadata?.partial === true
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

function httpsOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
