import { randomUUID } from "node:crypto";
import {
  normalizeRecordingPolicy,
  SESSION_HISTORY_CONTRACT_VERSION,
  SESSION_HISTORY_SCHEMA,
  type RecordingAsset,
  type RecordingBoundary,
  type RecordingClient,
  type RecordingPolicy,
  type RecordingScope,
  RecordingStartRejectedError,
  type SessionHistoryJsonObject,
  type SessionHistoryPlayer,
  type SessionHistoryRun,
  type SessionHistoryVisit
} from "@motion-levels-games/session-history";
import type { GameSessionState } from "@motion-levels-games/runtime";
import {
  type NewSessionEvent,
  SessionHistoryConflictError,
  SessionHistoryNotFoundError,
  SessionHistoryStore,
  SessionHistoryValidationError
} from "./sessionHistoryStore.ts";

export type HistoryVisitInput = {
  id: string;
  controllerId?: string;
  kioskId?: string;
  origin?: string;
  teamName?: string;
  players?: SessionHistoryPlayer[];
  recordingPolicy?: unknown;
  recordingEnabled?: unknown;
};

export type HistorySelectionInput = {
  id: string;
  runId: string;
  catalogGameId?: string;
  catalogGameLabel?: string;
  gameId: string;
  engineGame: string;
  manifestId: string;
  label: string;
  sourceKind: string;
  sourceRevision: string;
  contentRevision?: string;
  difficulty: string;
  level?: string;
  levelSlug?: string;
  levelMode?: string;
  durationMillis?: number;
  config?: Record<string, unknown>;
  teamName?: string;
  players?: SessionHistoryPlayer[];
};

export type RunRecordingStartFailureReason =
  | "unavailable"
  | "start_rejected"
  | "start_unconfirmed";

export type RunRecordingStartResult = Readonly<{
  state: "recording" | "failed" | "revoked";
  recording: RecordingAsset;
  reason?: RunRecordingStartFailureReason;
}>;

/** One non-blocking attempt to establish the durable recording attached to a
 * run. The venue authority owns the UX deadline; this promise may settle
 * later so the physical camera outcome can still be persisted safely. */
export type RunRecordingStartHandle = Readonly<{
  recording: RecordingAsset;
  completion: Promise<RunRecordingStartResult>;
}>;

export type HistoryRunStartOptions = Readonly<{
  recordingBlocked?: boolean;
  pendingLevelId?: string;
  pendingLevelSlug?: string;
  rotateSelectionRecording?: boolean;
}>;

type RunClock = {
  runId: string;
  phase: string;
  phaseChangedAt: number;
  lastFingerprint: string;
  engineElapsedMillis: number;
  gameplayElapsedMillis: number;
  lastPersistedAtUnixMillis: number;
  lastSnapshot: SessionHistoryJsonObject;
};

type PendingRunRecordingStart = {
  generation: number;
  handle: RunRecordingStartHandle;
  recording: RecordingAsset;
  settled: boolean;
  resolve(result: RunRecordingStartResult): void;
};

const clockFlushIntervalMillis = 5_000;
const defaultRecordingWatchIntervalMillis = 30_000;
const defaultRecordingRotationLeadMillis = 60_000;
const defaultRecordingStartRetryMillis = 5_000;
const maximumRecordingStartRetryMillis = 60_000;

export class SessionHistoryRecorder {
  private activeSessionId = "";
  private clock: RunClock | null = null;
  private healthyValue = true;
  private lastErrorValue = "";
  private recordingHealthyValue = true;
  private recordingLastErrorValue = "";
  private readonly observedStates = new WeakSet<object>();
  private readonly activeRecordings = new Map<string, string>();
  private readonly recordingGeneration = new Map<string, number>();
  private recordingOperations: Promise<void> = Promise.resolve();
  private readonly pendingRecordingStops = new Set<string>();
  private readonly uncertainStops = new Map<string, unknown>();
  private readonly recordingStopWaiters = new Set<{
    resolve(): void;
    reject(error: unknown): void;
  }>();
  private readonly unresolvedStartFailures = new Set<string>();
  private readonly recordingRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly recordingStartRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly recordingStartRetryAttempts = new Map<string, number>();
  private readonly pendingRunRecordingStarts = new Map<string, PendingRunRecordingStart>();
  private recordingWatchTimer: NodeJS.Timeout | null = null;
  private recordingWatchGeneration = 0;
  private recordingDrainActive = false;
  private recordingDrainPromise: Promise<void> | null = null;

  constructor(
    readonly store: SessionHistoryStore,
    private readonly options: {
      now?: () => number;
      recordingClient?: RecordingClient;
      recordingWatchIntervalMillis?: number;
      recordingRotationLeadMillis?: number;
      recordingStartRetryMillis?: number;
      log?: (message: string, error?: unknown) => void;
    } = {}
  ) {
    this.safe(() => {
      const recovered = store.recoverOpenVisit(this.now());
      this.activeSessionId = recovered?.id ?? "";
      const visits = store.allVisits();
      const resumable = this.options.recordingClient && recovered?.status === "active"
        && recovered.recordingPolicy.scope === "visit"
        ? recovered.recordings
            .filter((asset) => asset.scope === "visit"
              && (asset.status === "requested" || asset.status === "recording"))
            .sort((left, right) => (right.startedAtUnixMillis ?? 0) - (left.startedAtUnixMillis ?? 0)
              || right.id.localeCompare(left.id))[0]
        : undefined;
      for (const visit of visits) {
        for (const asset of visit.recordings.filter(isOpenRecording)) {
          if (visit.id === recovered?.id && asset.id === resumable?.id) continue;
          this.finishRecoveredRecording(visit, asset);
        }
      }
      if (recovered && resumable) {
        this.resumeRecoveredRecording(recovered, resumable);
      } else if (recovered && recovered.recordingPolicy.scope === "visit" && this.options.recordingClient) {
        this.boundary("start", "visit", recovered);
      }
    });
  }

  health(): {
    configured: true;
    healthy: boolean;
    persistenceHealthy: boolean;
    recordingConfigured: boolean;
    recordingHealthy: boolean;
    rootDir: string;
    lastError: string;
    recordingLastError: string;
    activeSessionId: string;
  } {
    const store = this.store.health();
    const persistenceHealthy = store.healthy && this.healthyValue;
    const recordingConfigured = Boolean(this.options.recordingClient);
    const recordingHealthy = !recordingConfigured || this.recordingHealthyValue;
    return {
      ...store,
      healthy: persistenceHealthy && recordingHealthy,
      persistenceHealthy,
      recordingConfigured,
      recordingHealthy,
      lastError: this.lastErrorValue || store.lastError,
      recordingLastError: this.recordingLastErrorValue,
      activeSessionId: this.activeSessionId
    };
  }

  currentVisit(): SessionHistoryVisit | null {
    if (!this.activeSessionId) return null;
    return this.safe(() => this.store.getVisit(this.activeSessionId), null) ?? null;
  }

  assertVisitStartable(id: string): void {
    try {
      const visit = this.store.getVisit(id);
      if (visit.status === "ended") {
        throw new SessionHistoryConflictError(`ended session cannot be reopened: ${visit.id}`);
      }
    } catch (error) {
      if (error instanceof SessionHistoryNotFoundError) return;
      throw error;
    }
  }

  startVisit(input: HistoryVisitInput): void {
    this.assertVisitStartable(input.id);
    this.safe(() => {
      const at = this.now();
      if (this.activeSessionId && this.activeSessionId !== input.id) this.endVisit("superseded");
      let visit: SessionHistoryVisit;
      let created = false;
      try {
        visit = this.store.getVisit(input.id);
      } catch (error) {
        if (!(error instanceof SessionHistoryNotFoundError)) throw error;
        created = true;
        visit = {
          schema: SESSION_HISTORY_SCHEMA,
          contractVersion: SESSION_HISTORY_CONTRACT_VERSION,
          id: input.id,
          status: "active",
          startedAtUnixMillis: at,
          updatedAtUnixMillis: at,
          controllerId: input.controllerId,
          kioskId: input.kioskId,
          origin: input.origin,
          teamName: input.teamName ?? "",
          players: input.players ?? [],
          recordingPolicy: policyFromInput(input),
          selections: [],
          recordings: [],
          lastSequence: 0
        };
        visit = this.store.createVisit(visit, [{
          kind: "visit.started",
          occurredAtUnixMillis: at,
          payload: { origin: input.origin ?? "local" }
        }]);
        this.activeSessionId = input.id;
        this.boundary("start", "visit", visit);
      }

      visit = this.store.getVisit(input.id);
      const nextPolicy = policyFromInput(input, visit.recordingPolicy);
      const previousPolicy = visit.recordingPolicy;
      const policyChanged = !recordingPoliciesEqual(previousPolicy, nextPolicy);
      if (!created && policyChanged) {
        this.stopPolicyCapture(visit, previousPolicy.scope);
        visit = this.store.getVisit(input.id);
      }
      visit.status = "active";
      visit.endedAtUnixMillis = undefined;
      visit.endReason = undefined;
      visit.updatedAtUnixMillis = at;
      if (input.controllerId) visit.controllerId = input.controllerId;
      if (input.kioskId) visit.kioskId = input.kioskId;
      if (input.origin) visit.origin = input.origin;
      if (input.teamName !== undefined) visit.teamName = input.teamName;
      if (input.players?.length) visit.players = input.players;
      visit.recordingPolicy = nextPolicy;
      if (!created) {
        this.store.commitTransition(visit, [{
          kind: "visit.updated",
          occurredAtUnixMillis: at,
          payload: { policyChanged }
        }]);
      }
      this.activeSessionId = input.id;
      if (!created && policyChanged) {
        this.startPolicyCapture(this.store.getVisit(input.id), nextPolicy.scope);
      }
    });
  }

  endVisit(reason = "completed"): void {
    this.safe(() => {
      if (!this.activeSessionId) return;
      const sessionId = this.activeSessionId;
      this.endSelection(reason);
      let visit = this.store.getVisit(sessionId);
      if (visit.status === "ended") return;
      // The finalizing asset is a durable stop intent. Persist it while the
      // visit is still active so a crash before the ended manifest is also
      // recoverable, then close the visit itself.
      this.boundary("stop", "visit", visit);
      visit = this.store.getVisit(sessionId);
      const at = this.now();
      visit.status = "ended";
      visit.endedAtUnixMillis = at;
      visit.endReason = reason;
      visit.updatedAtUnixMillis = at;
      visit.activeSelectionId = undefined;
      visit.activeRunId = undefined;
      this.store.commitTransition(visit, [{
        kind: "visit.ended",
        occurredAtUnixMillis: at,
        payload: { reason }
      }]);
      this.activeSessionId = "";
      this.clock = null;
    });
  }

  startSelection(
    input: HistorySelectionInput,
    state: GameSessionState,
    options: HistoryRunStartOptions = {}
  ): RunRecordingStartHandle | null {
    return this.safe(() => {
      if (!this.activeSessionId) {
        this.startVisit({
          id: `local-${randomUUID()}`,
          teamName: input.teamName,
          players: input.players,
          recordingPolicy: { scope: "off" },
          origin: "implicit"
        });
      }
      if (!this.activeSessionId) return;
      this.endSelection("superseded");
      const at = this.now();
      const visit = this.store.getVisit(this.activeSessionId);
      const selection: SessionHistoryVisit["selections"][number] = {
        id: input.id,
        ordinal: visit.selections.length + 1,
        catalogGameId: input.catalogGameId,
        catalogGameLabel: input.catalogGameLabel,
        gameId: input.gameId,
        engineGame: input.engineGame,
        manifestId: input.manifestId,
        label: input.label,
        sourceKind: input.sourceKind,
        sourceRevision: input.sourceRevision,
        contentRevision: input.contentRevision,
        difficulty: input.difficulty,
        level: input.level,
        levelSlug: input.levelSlug,
        levelMode: input.levelMode,
        durationMillis: input.durationMillis,
        config: jsonObject(input.config ?? {}),
        teamName: input.teamName ?? visit.teamName,
        players: input.players ?? visit.players,
        selectedAtUnixMillis: at,
        runs: []
      };
      visit.selections.push(selection);
      visit.activeSelectionId = selection.id;
      visit.updatedAtUnixMillis = at;
      visit.teamName = selection.teamName;
      visit.players = selection.players;
      this.store.commitTransition(visit, [{
        selectionId: selection.id,
        kind: "selection.started",
        occurredAtUnixMillis: at,
        payload: { gameId: selection.gameId, label: selection.label }
      }]);
      this.boundary("start", "selection", visit, selection.id);
      return this.startRun(input.runId, "initial", state, options);
    }, null) ?? null;
  }

  restartRun(
    runId: string,
    state: GameSessionState,
    options: HistoryRunStartOptions = {}
  ): RunRecordingStartHandle | null {
    return this.safe(() => {
      this.endRun("restarted", "abandoned");
      if (options.rotateSelectionRecording && this.activeSessionId) {
        const visit = this.store.getVisit(this.activeSessionId);
        this.boundary("stop", "selection", visit, visit.activeSelectionId);
      }
      const recordingStart = this.startRun(runId, "restart", state, options);
      if (options.rotateSelectionRecording && this.activeSessionId) {
        const visit = this.store.getVisit(this.activeSessionId);
        this.boundary("start", "selection", visit, visit.activeSelectionId);
      }
      return recordingStart;
    }, null) ?? null;
  }

  recordingStopsPending(): boolean {
    return this.pendingRecordingStops.size > 0;
  }

  recordingTransitionWouldStop(sessionId: string, policy: RecordingPolicy): boolean {
    if (!this.options.recordingClient || !this.activeSessionId || this.activeRecordings.size === 0) return false;
    if (sessionId !== this.activeSessionId) return true;
    try {
      return !recordingPoliciesEqual(this.store.getVisit(this.activeSessionId).recordingPolicy, policy);
    } catch {
      return true;
    }
  }

  retryRunRecording(runId: string): RunRecordingStartHandle | null {
    return this.safe(() => {
      if (!this.activeSessionId) return null;
      const visit = this.store.getVisit(this.activeSessionId);
      if (visit.status !== "active" || visit.recordingPolicy.scope !== "run") return null;
      const selection = visit.selections.find((candidate) => candidate.id === visit.activeSelectionId);
      const run = selection?.runs.find((candidate) => candidate.id === runId);
      if (!selection || !run || visit.activeRunId !== runId || run.endedAtUnixMillis !== undefined) return null;
      const current = [...visit.recordings]
        .reverse()
        .find((candidate) => isCameraRecordingAsset(candidate) && candidate.scope === "run"
          && candidate.selectionId === selection.id
          && candidate.runId === runId);
      if (!current) return null;
      const pending = this.pendingRunRecordingStarts.get(runId);
      if (pending && !pending.settled && pending.recording.id === current.id) {
        // The venue deadline is intentionally shorter than an arbitrarily
        // slow camera operation. Retrying while that exact durable start is
        // still in flight reattaches the new gate to it instead of issuing a
        // duplicate shutter command for the same capture.
        return pending.handle;
      }
      this.cancelStartRetry(current.id);
      if (current.status === "recording") {
        // A late physical confirmation is persisted even after the venue gate
        // times out. It is already sufficient for an operator retry and must
        // never be downgraded to requested or sent to the camera again.
        return {
          recording: current,
          completion: Promise.resolve({ state: "recording", recording: current })
        };
      }
      const recording: RecordingAsset = {
        ...current,
        status: this.options.recordingClient ? "requested" : "missing",
        endedAtUnixMillis: undefined,
        metadata: {
          ...(current.metadata ?? {}),
          operatorRetry: true
        }
      };
      this.activeRecordings.set(recordingKey("run", selection.id, runId), recording.id);
      this.store.upsertRecording(visit.id, recording);
      return this.enqueueBoundary("start", visit, recording, selection.id, runId);
    }, null) ?? null;
  }

  /** Revoke any pending start and persist a stop intent for this run without
   * changing the visit recording policy. A start already accepted by the
   * camera is serialized before the stop and cannot leak into the next run. */
  async skipRunRecording(runId: string, reason = "continued_without_video"): Promise<void> {
    try {
      if (!this.activeSessionId) return;
      const visit = this.store.getVisit(this.activeSessionId);
      const selection = visit.selections.find((candidate) => candidate.id === visit.activeSelectionId);
      const recording = [...visit.recordings]
        .reverse()
        .find((candidate) => isCameraRecordingAsset(candidate) && candidate.scope === "run"
          && candidate.selectionId === selection?.id
          && candidate.runId === runId);
      if (!selection || !recording) return;
      this.cancelStartRetry(recording.id);
      this.revokeRunRecordingStart(runId, recording, "start_unconfirmed");
      const skipped = this.store.upsertRecording(visit.id, {
        ...recording,
        metadata: {
          ...(recording.metadata ?? {}),
          excludedFromPlayback: true,
          recordingSkipped: true,
          recordingSkipReason: reason
        }
      });
      if (!this.options.recordingClient || skipped.status === "complete" || skipped.status === "partial"
        || skipped.status === "missing") {
        await this.waitForNoRecordingStops();
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const current = this.store.getVisit(visit.id);
        const key = recordingKey("run", selection.id, runId);
        if (this.activeRecordings.get(key) === recording.id) {
          this.boundary("stop", "run", current, selection.id, runId, resolve, reject);
          return;
        }
        const latest = current.recordings.find((candidate) => candidate.id === recording.id);
        if (!latest || latest.status === "complete" || latest.status === "partial"
          || latest.status === "missing") {
          resolve();
          return;
        }
        const finalizing = this.store.upsertRecording(current.id, {
          ...latest,
          status: "finalizing",
          endedAtUnixMillis: latest.endedAtUnixMillis ?? this.now()
        });
        this.enqueueBoundary("stop", current, finalizing, selection.id, runId, resolve, false, reject);
      });
      await this.waitForNoRecordingStops();
    } catch (error) {
      this.degradeRecording(error);
      throw error;
    }
  }

  endSelection(reason = "completed"): void {
    this.safe(() => {
      if (!this.activeSessionId) return;
      let visit = this.store.getVisit(this.activeSessionId);
      const selection = visit.selections.find((candidate) => candidate.id === visit.activeSelectionId);
      if (!selection) return;
      this.endRun(reason, reason === "runtime_interrupted" ? "interrupted" : "abandoned");
      visit = this.store.getVisit(visit.id);
      const current = visit.selections.find((candidate) => candidate.id === selection.id);
      const at = this.now();
      if (current && current.endedAtUnixMillis === undefined) {
        current.endedAtUnixMillis = at;
        current.endReason = reason;
      }
      visit.activeSelectionId = undefined;
      visit.activeRunId = undefined;
      visit.updatedAtUnixMillis = at;
      this.store.commitTransition(visit, [{
        selectionId: selection.id,
        kind: "selection.ended",
        occurredAtUnixMillis: at,
        payload: { reason }
      }]);
      this.boundary("stop", "selection", visit, selection.id);
      this.clock = null;
    });
  }

  observeState(state: GameSessionState): void {
    if (this.observedStates.has(state)) return;
    this.observedStates.add(state);
    if (!this.activeSessionId || !this.clock) return;
    this.clock.engineElapsedMillis = Math.max(this.clock.engineElapsedMillis, state.clockMillis);
    this.clock.gameplayElapsedMillis = Math.max(
      this.clock.gameplayElapsedMillis,
      Number(state.snapshot.elapsedMillis) || 0
    );
    this.clock.lastSnapshot = historySnapshot(state);
    const phase = state.paused ? "paused" : String(state.snapshot.phase || "running");
    const fingerprint = JSON.stringify(materialFingerprint(state));
    const phaseChanged = this.clock.phase !== phase;
    const checkpointChanged = this.clock.lastFingerprint !== fingerprint;
    const terminal = phase === "finished";
    if (!phaseChanged && !checkpointChanged && !state.events.length && !terminal) {
      if (this.now() - this.clock.lastPersistedAtUnixMillis >= clockFlushIntervalMillis) {
        this.flushClock();
      }
      return;
    }

    this.safe(() => {
      const at = this.now();
      const visit = this.store.getVisit(this.activeSessionId);
      const selection = visit.selections.find((candidate) => candidate.id === visit.activeSelectionId);
      const run = selection?.runs.find((candidate) => candidate.id === visit.activeRunId);
      if (!selection || !run || !this.clock) return;
      run.engineElapsedMillis = Math.max(run.engineElapsedMillis, this.clock.engineElapsedMillis);
      run.gameplayElapsedMillis = Math.max(run.gameplayElapsedMillis, this.clock.gameplayElapsedMillis);
      run.score = Number(state.snapshot.score) || 0;
      run.lives = Number(state.snapshot.lives);
      run.success = state.snapshot.success;
      run.players = state.snapshot.players.map((player) => ({
        id: String(player.index),
        name: player.label,
        metadata: { score: player.score, lives: player.lives, color: player.color }
      }));
      run.rounds = (state.snapshot.rounds ?? []).map((round) => jsonObject(round));
      run.finalSnapshot = this.clock.lastSnapshot;
      if (phase === "running" && !run.gameplayStartedAtUnixMillis) run.gameplayStartedAtUnixMillis = at;
      if (phaseChanged) {
        const elapsed = Math.max(0, at - this.clock.phaseChangedAt);
        run.phaseDurations[this.clock.phase] = (run.phaseDurations[this.clock.phase] ?? 0) + elapsed;
        if (this.clock.phase === "paused") run.pausedMillis += elapsed;
        this.clock.phase = phase;
        this.clock.phaseChangedAt = at;
      }
      if (checkpointChanged) this.clock.lastFingerprint = fingerprint;
      run.status = runStatus(phase);
      visit.updatedAtUnixMillis = at;
      const events: NewSessionEvent[] = [];
      if (phaseChanged) {
        events.push({
          selectionId: selection.id,
          runId: run.id,
          kind: "run.phase_changed",
          occurredAtUnixMillis: at,
          engineAtMillis: state.clockMillis,
          payload: { phase }
        });
      }
      if (checkpointChanged) {
        events.push({
          selectionId: selection.id,
          runId: run.id,
          kind: "run.checkpoint",
          occurredAtUnixMillis: at,
          engineAtMillis: state.clockMillis,
          payload: { snapshot: this.clock.lastSnapshot }
        });
      }
      for (const event of state.events) {
        events.push({
          selectionId: selection.id,
          runId: run.id,
          kind: "game.event",
          occurredAtUnixMillis: at,
          engineAtMillis: event.atMillis,
          cue: event.cue,
          message: event.message,
          payload: {}
        });
      }
      this.store.commitTransition(visit, events);
      this.clock.lastPersistedAtUnixMillis = at;
      if (terminal) this.endRun(state.snapshot.success ? "success" : "finished", "finished");
    });
  }

  recordMenuEvent(
    sessionId: string,
    name: string,
    properties: Record<string, unknown>,
    occurredAtUnixMillis?: number
  ): void {
    try {
      const requestedAt = Number(occurredAtUnixMillis);
      const at = Number.isSafeInteger(requestedAt) && requestedAt > 0 ? requestedAt : this.now();
      this.store.appendEvent(sessionId, {
        kind: "menu.event",
        occurredAtUnixMillis: at,
        payload: { name, properties: jsonObject(properties) }
      });
    } catch (error) {
      if (error instanceof SessionHistoryNotFoundError || error instanceof SessionHistoryValidationError) {
        this.options.log?.("session history ignored an event for an unknown session", error);
        return;
      }
      this.degrade(error);
    }
  }

  stop(): Promise<void> {
    this.safe(() => {
      this.endSelection("runtime_interrupted");
      if (!this.activeSessionId) return;
      // A graceful process shutdown keeps the visit open for kiosk recovery,
      // but it must not leave a visit-scoped camera capture running.
      this.boundary("stop", "visit", this.store.getVisit(this.activeSessionId));
    });
    // Shutdown revokes every possible future start. Any timer left behind by
    // an operation that was superseded in the same turn must not outlive the
    // runtime drain.
    for (const recordingId of this.recordingStartRetryTimers.keys()) {
      this.cancelStartRetry(recordingId);
    }
    return this.drainRecordingOperations();
  }

  private drainRecordingOperations(): Promise<void> {
    if (this.recordingDrainPromise) return this.recordingDrainPromise;
    this.recordingDrainActive = true;
    const drain = this.runRecordingDrain();
    const tracked = drain.finally(() => {
      if (this.recordingDrainPromise === tracked) this.recordingDrainPromise = null;
      this.recordingDrainActive = false;
    });
    this.recordingDrainPromise = tracked;
    return tracked;
  }

  private async runRecordingDrain(): Promise<void> {
    while (true) {
      const observedOperations = this.recordingOperations;
      await observedOperations;
      if (observedOperations !== this.recordingOperations) continue;

      this.expediteUncertainStops();
      if (observedOperations !== this.recordingOperations) continue;
      if (this.uncertainStops.size === 0 && this.recordingRetryTimers.size === 0) return;

      await new Promise((resolve) => setTimeout(resolve, this.finalizingRetryDelay()));
    }
  }

  private expediteUncertainStops(): void {
    if (this.uncertainStops.size === 0) return;
    const visits = this.store.allVisits();
    for (const recordingId of this.uncertainStops.keys()) {
      const visit = visits.find((candidate) => candidate.recordings.some((asset) => asset.id === recordingId));
      const recording = visit?.recordings.find((candidate) => candidate.id === recordingId);
      if (!visit || !recording || recording.status !== "finalizing") {
        this.resolveUncertainStop(recordingId);
        continue;
      }
      this.scheduleFinalizingRetry(visit.id, recording.id, true);
    }
  }

  private startRun(
    id: string,
    reason: "initial" | "restart" | "recovered",
    state: GameSessionState,
    options: HistoryRunStartOptions = {}
  ): RunRecordingStartHandle | null {
    if (!this.activeSessionId) return null;
    const at = this.now();
    const visit = this.store.getVisit(this.activeSessionId);
    const selection = visit.selections.find((candidate) => candidate.id === visit.activeSelectionId);
    if (!selection) return null;
    const initialState = options.recordingBlocked
      ? recordingArmingHistoryState(state, options)
      : state;
    const phase = initialState.paused ? "paused" : String(initialState.snapshot.phase || "waiting");
    const run: SessionHistoryRun = {
      id,
      ordinal: selection.runs.length + 1,
      reason,
      status: runStatus(phase),
      startedAtUnixMillis: at,
      engineElapsedMillis: 0,
      gameplayElapsedMillis: 0,
      pausedMillis: 0,
      phaseDurations: {},
      score: 0,
      lives: Number(initialState.snapshot.lives),
      players: [],
      rounds: [],
      ...(options.recordingBlocked ? { finalSnapshot: historySnapshot(initialState) } : {})
    };
    selection.runs.push(run);
    visit.activeRunId = id;
    visit.updatedAtUnixMillis = at;
    this.clock = {
      runId: id,
      phase,
      phaseChangedAt: at,
      lastFingerprint: "",
      engineElapsedMillis: initialState.clockMillis,
      gameplayElapsedMillis: Number(initialState.snapshot.elapsedMillis) || 0,
      lastPersistedAtUnixMillis: at,
      lastSnapshot: historySnapshot(initialState)
    };
    this.store.commitTransition(visit, [{
      selectionId: selection.id,
      runId: id,
      kind: "run.started",
      occurredAtUnixMillis: at,
      payload: { reason }
    }]);
    this.linkRunToActiveRecordings(visit, selection.id, id);
    const recording = this.boundary("start", "run", visit, selection.id, id);
    if (!options.recordingBlocked) this.observeState(state);
    return recording;
  }

  private endRun(reason: string, status: "finished" | "abandoned" | "interrupted"): void {
    if (!this.activeSessionId) return;
    const at = this.now();
    const visit = this.store.getVisit(this.activeSessionId);
    const selection = visit.selections.find((candidate) => candidate.id === visit.activeSelectionId);
    const run = selection?.runs.find((candidate) => candidate.id === visit.activeRunId);
    if (!selection || !run || run.endedAtUnixMillis !== undefined) {
      this.clock = null;
      return;
    }
    if (this.clock?.runId === run.id) {
      run.engineElapsedMillis = Math.max(run.engineElapsedMillis, this.clock.engineElapsedMillis);
      run.gameplayElapsedMillis = Math.max(run.gameplayElapsedMillis, this.clock.gameplayElapsedMillis);
      run.finalSnapshot = this.clock.lastSnapshot;
      const elapsed = Math.max(0, at - this.clock.phaseChangedAt);
      run.phaseDurations[this.clock.phase] = (run.phaseDurations[this.clock.phase] ?? 0) + elapsed;
      if (this.clock.phase === "paused") run.pausedMillis += elapsed;
    }
    run.status = status;
    run.outcome = reason;
    run.endedAtUnixMillis = at;
    run.finishedAtUnixMillis = at;
    visit.activeRunId = undefined;
    visit.updatedAtUnixMillis = at;
    this.store.commitTransition(visit, [{
      selectionId: selection.id,
      runId: run.id,
      kind: status === "interrupted" ? "run.interrupted" : "run.finished",
      occurredAtUnixMillis: at,
      payload: { reason, status }
    }]);
    this.boundary("stop", "run", visit, selection.id, run.id);
    this.clock = null;
  }

  private flushClock(): void {
    this.safe(() => {
      if (!this.activeSessionId || !this.clock) return;
      const clock = this.clock;
      const at = this.now();
      const visit = this.store.getVisit(this.activeSessionId);
      const selection = visit.selections.find((candidate) => candidate.id === visit.activeSelectionId);
      const run = selection?.runs.find((candidate) => candidate.id === visit.activeRunId);
      if (!run || run.id !== clock.runId) return;
      run.engineElapsedMillis = Math.max(run.engineElapsedMillis, clock.engineElapsedMillis);
      run.gameplayElapsedMillis = Math.max(run.gameplayElapsedMillis, clock.gameplayElapsedMillis);
      run.finalSnapshot = clock.lastSnapshot;
      visit.updatedAtUnixMillis = Math.max(visit.updatedAtUnixMillis, at);
      this.store.saveVisit(visit);
      if (this.clock === clock) clock.lastPersistedAtUnixMillis = at;
    });
  }

  private stopPolicyCapture(visit: SessionHistoryVisit, scope: RecordingPolicy["scope"]): void {
    if (scope === "off") return;
    this.boundary(
      "stop",
      scope,
      visit,
      scope === "visit" ? undefined : visit.activeSelectionId,
      scope === "run" ? visit.activeRunId : undefined
    );
  }

  private startPolicyCapture(visit: SessionHistoryVisit, scope: RecordingPolicy["scope"]): void {
    if (scope === "off") return;
    if (scope === "selection" && !visit.activeSelectionId) return;
    if (scope === "run" && !visit.activeRunId) return;
    this.boundary(
      "start",
      scope,
      visit,
      scope === "visit" ? undefined : visit.activeSelectionId,
      scope === "run" ? visit.activeRunId : undefined
    );
  }

  private boundary(
    type: "start" | "stop",
    scope: RecordingScope,
    visit: SessionHistoryVisit,
    selectionId?: string,
    runId?: string,
    afterSuccess?: () => void,
    afterFailure?: (error: unknown) => void
  ): RunRecordingStartHandle | null {
    if (type === "start" && visit.recordingPolicy.scope !== scope) return null;
    if (type === "stop" && scope === "visit") this.cancelRecordingWatch();
    const key = recordingKey(scope, selectionId, runId);
    const at = this.now();
    let recording: RecordingAsset;
    let preserveQueuedStart = false;
    if (type === "start") {
      const id = randomUUID();
      recording = {
        id,
        captureId: id,
        scope,
        status: this.options.recordingClient ? "requested" : "missing",
        selectionId,
        runId,
        linkedRunIds: initialLinkedRunIds(scope, visit, selectionId, runId),
        startedAtUnixMillis: at,
        backend: "camera-recorder",
        metadata: {}
      };
      this.activeRecordings.set(key, id);
      // A new explicit capture attempt is allowed to recover from failures of
      // captures that are no longer active. Health is degraded again if this
      // attempt fails; a successful stop is never treated as proof that starts
      // work.
      this.clearInactiveStartFailures();
    } else {
      const id = this.activeRecordings.get(key);
      if (!id) return null;
      this.cancelStartRetry(id);
      const current = this.store.getVisit(visit.id).recordings.find((candidate) => candidate.id === id);
      if (!current) return null;
      if (scope === "run" && runId) this.revokeRunRecordingStart(runId, current, "start_unconfirmed");
      const terminalRun = scope === "run"
        ? visit.selections.find((candidate) => candidate.id === selectionId)?.runs.find((candidate) => candidate.id === runId)
        : undefined;
      preserveQueuedStart = current.status === "requested" && terminalRun?.status === "finished";
      recording = {
        ...current,
        status: this.options.recordingClient ? "finalizing" : "missing",
        endedAtUnixMillis: at,
        metadata: preserveQueuedStart
          ? { ...(current.metadata ?? {}), startBeforeTerminalStop: true }
          : current.metadata
      };
      this.activeRecordings.delete(key);
    }
    this.store.upsertRecording(visit.id, recording);
    return this.enqueueBoundary(
      type,
      visit,
      recording,
      selectionId,
      runId,
      afterSuccess,
      preserveQueuedStart,
      afterFailure
    );
  }

  private enqueueBoundary(
    type: "start" | "stop",
    visit: SessionHistoryVisit,
    recording: RecordingAsset,
    selectionId?: string,
    runId?: string,
    afterSuccess?: () => void,
    preserveQueuedStart = false,
    afterFailure?: (error: unknown) => void
  ): RunRecordingStartHandle | null {
    const client = this.options.recordingClient;
    const occurredAtUnixMillis = type === "start"
      ? recording.startedAtUnixMillis ?? this.now()
      : recording.endedAtUnixMillis ?? this.now();
    const previousGeneration = this.recordingGeneration.get(recording.id) ?? 0;
    const generation = preserveQueuedStart ? Math.max(1, previousGeneration) : previousGeneration + 1;
    this.recordingGeneration.set(recording.id, generation);
    const runStart = type === "start" && recording.scope === "run" && runId
      ? this.createRunRecordingStart(recording, runId, generation)
      : null;
    if (!client) {
      if (runStart) {
        this.settleRunRecordingStart(runId ?? "", generation, {
          state: "failed",
          recording,
          reason: "unavailable"
        });
      }
      afterSuccess?.();
      return runStart?.handle ?? null;
    }
    if (type === "stop") this.pendingRecordingStops.add(recording.id);
    const boundary: RecordingBoundary = {
      type,
      scope: recording.scope,
      sessionId: visit.id,
      selectionId,
      runId,
      occurredAtUnixMillis,
      policy: visit.recordingPolicy,
      recording
    };
    this.recordingOperations = this.recordingOperations.then(async () => {
      if (this.recordingGeneration.get(recording.id) !== generation) {
        if (runId) this.settleRunRecordingStart(runId, generation, {
          state: "revoked",
          recording
        });
        return;
      }
      if (type === "start" && !this.startBoundaryStillActive(visit.id, recording)) {
        if (runId) this.settleRunRecordingStart(runId, generation, {
          state: "revoked",
          recording
        });
        return;
      }
      if (this.uncertainStops.size > 0 && type === "start") {
        const error = this.uncertainStops.values().next().value;
        this.recordingFailed(type, visit.id, recording, generation, error);
        if (runId) this.settleRunRecordingStart(runId, generation, {
          state: "failed",
          recording: this.currentRecording(visit.id, recording.id) ?? recording,
          reason: "start_unconfirmed"
        });
        return;
      }
      try {
        const asset = await client.onBoundary(boundary);
        if (type === "stop" && (!asset || !isConfirmedStoppedRecording(asset))) {
          throw new Error(
            `camera recorder did not confirm stopped capture ${recording.captureId ?? recording.id}`
          );
        }
        let persisted: RecordingAsset | null = null;
        if (asset) {
          persisted = this.persistRecordingResult(visit.id, recording.id, asset, generation);
          if (type === "start" && asset.status === "recording") {
            this.recoverRecordingHealth();
            if (persisted?.scope === "visit") this.scheduleRecordingWatch(visit.id, persisted);
            if (runId) this.settleRunRecordingStart(runId, generation, {
              state: "recording",
              recording: persisted ?? asset
            });
          }
        }
        if (type === "start" && runId && asset?.status !== "recording") {
          this.settleRunRecordingStart(runId, generation, {
            state: "failed",
            recording: persisted ?? recording,
            reason: "start_unconfirmed"
          });
        }
        if (type === "stop") {
          this.resolveUncertainStop(recording.id);
          if (this.uncertainStops.size === 0) {
            if (this.unresolvedStartFailures.size === 0) this.recoverRecordingHealth();
            this.resumeAllPendingRecordings();
          }
        }
        afterSuccess?.();
      } catch (error) {
        const currentFailure = this.recordingFailed(type, visit.id, recording, generation, error);
        if (type === "stop" && currentFailure) {
          this.uncertainStops.set(recording.id, error);
          this.scheduleFinalizingRetry(visit.id, recording.id);
          this.rejectRecordingStopWaiters(error);
        } else if (type === "start" && currentFailure) {
          if (runId) this.settleRunRecordingStart(runId, generation, {
            state: "failed",
            recording: this.currentRecording(visit.id, recording.id) ?? recording,
            reason: error instanceof RecordingStartRejectedError ? "start_rejected" : "start_unconfirmed"
          });
          if (recording.scope !== "run") this.scheduleStartRetry(visit.id, recording.id);
        } else if (type === "start" && runId) {
          const confirmed = this.currentRecording(visit.id, recording.id);
          if (confirmed?.status === "recording") {
            this.recoverRecordingHealth();
            this.settleRunRecordingStart(runId, generation, {
              state: "recording",
              recording: confirmed
            });
          }
        }
        afterFailure?.(error);
      }
    });
    return runStart?.handle ?? null;
  }

  private persistRecordingResult(
    sessionId: string,
    recordingId: string,
    asset: RecordingAsset,
    generation: number
  ): RecordingAsset | null {
    const current = this.store.getVisit(sessionId).recordings.find((candidate) => candidate.id === recordingId);
    if (!current) {
      if (this.recordingGeneration.get(recordingId) === generation) {
        return this.store.upsertRecording(sessionId, asset);
      }
      return null;
    }
    const currentGeneration = this.recordingGeneration.get(recordingId) === generation;
    const merged = currentGeneration
      ? { ...current, ...asset }
      : { ...asset, ...current };
    return this.store.upsertRecording(sessionId, {
      ...merged,
      linkedRunIds: [...new Set([...current.linkedRunIds, ...asset.linkedRunIds])],
      metadata: { ...(current.metadata ?? {}), ...(asset.metadata ?? {}) }
    });
  }

  private createRunRecordingStart(
    recording: RecordingAsset,
    runId: string,
    generation: number
  ): { handle: RunRecordingStartHandle } {
    const previous = this.pendingRunRecordingStarts.get(runId);
    if (previous && !previous.settled && previous.recording.id === recording.id) {
      // A confirmed stop resumes all queued starts. Reuse the run's promise
      // when that bookkeeping re-enqueues the exact same durable capture so
      // the venue gate remains attached to the winning generation.
      previous.generation = generation;
      previous.recording = recording;
      return { handle: previous.handle };
    }
    if (previous && !previous.settled) {
      previous.settled = true;
      previous.resolve({ state: "revoked", recording: previous.recording });
    }
    let resolveCompletion!: (result: RunRecordingStartResult) => void;
    const completion = new Promise<RunRecordingStartResult>((resolve) => {
      resolveCompletion = resolve;
    });
    const handle: RunRecordingStartHandle = { recording, completion };
    this.pendingRunRecordingStarts.set(runId, {
      generation,
      handle,
      recording,
      settled: false,
      resolve: resolveCompletion
    });
    return { handle };
  }

  private settleRunRecordingStart(
    runId: string,
    generation: number,
    result: RunRecordingStartResult
  ): void {
    const pending = this.pendingRunRecordingStarts.get(runId);
    if (!pending || pending.generation !== generation || pending.settled) return;
    pending.settled = true;
    this.pendingRunRecordingStarts.delete(runId);
    pending.resolve(result);
  }

  private revokeRunRecordingStart(
    runId: string,
    recording: RecordingAsset,
    reason: RunRecordingStartFailureReason
  ): void {
    const pending = this.pendingRunRecordingStarts.get(runId);
    if (!pending || pending.recording.id !== recording.id || pending.settled) return;
    pending.settled = true;
    this.pendingRunRecordingStarts.delete(runId);
    pending.resolve({ state: "revoked", recording, reason });
  }

  private currentRecording(sessionId: string, recordingId: string): RecordingAsset | undefined {
    try {
      return this.store.getVisit(sessionId).recordings.find((candidate) => candidate.id === recordingId);
    } catch {
      return undefined;
    }
  }

  private recordingFailed(
    type: "start" | "stop",
    sessionId: string,
    recording: RecordingAsset,
    generation: number,
    error: unknown
  ): boolean {
    if (this.recordingGeneration.get(recording.id) !== generation) return false;
    const persisted = this.currentRecording(sessionId, recording.id);
    if (type === "start" && persisted?.status === "recording") {
      // A redundant request may fail after another observation has already
      // proven that the physical capture is active. Preserve the strongest
      // known state instead of hiding it behind a later transport error.
      return false;
    }
    this.degradeRecording(error);
    if (type === "start") this.unresolvedStartFailures.add(recording.id);
    this.safe(() => {
      const current = this.store.getVisit(sessionId).recordings
        .find((candidate) => candidate.id === recording.id) ?? recording;
      this.store.upsertRecording(sessionId, {
        ...current,
        // Network failures are uncertain in both directions: a start may have
        // reached the camera and a stop may have been lost after scheduling.
        // Preserve a replayable intent unless the recorder explicitly
        // confirmed that the start did not happen.
        status: type === "stop"
          ? "finalizing"
          : error instanceof RecordingStartRejectedError ? "failed" : "requested",
        metadata: {
          ...(current.metadata ?? {}),
          error: error instanceof Error ? error.message : String(error)
        }
      });
    });
    return true;
  }

  private finishRecoveredRecording(visit: SessionHistoryVisit, asset: RecordingAsset): void {
    this.activeRecordings.set(recordingKey(asset.scope, asset.selectionId, asset.runId), asset.id);
    this.boundary("stop", asset.scope, visit, asset.selectionId, asset.runId);
  }

  private resumeRecoveredRecording(visit: SessionHistoryVisit, asset: RecordingAsset): void {
    const { endedAtUnixMillis: _endedAtUnixMillis, ...persisted } = asset;
    const recording: RecordingAsset = { ...persisted, status: "requested" };
    this.activeRecordings.set(recordingKey(recording.scope, recording.selectionId, recording.runId), recording.id);
    this.store.upsertRecording(visit.id, recording);
    this.enqueueBoundary("start", visit, recording, recording.selectionId, recording.runId);
  }

  private linkRunToActiveRecordings(visit: SessionHistoryVisit, selectionId: string, runId: string): void {
    const candidates = visit.recordings.filter((asset) => asset.scope === "visit"
      || (asset.scope === "selection" && asset.selectionId === selectionId));
    for (const candidate of candidates) {
      const key = recordingKey(candidate.scope, candidate.selectionId, candidate.runId);
      if (this.activeRecordings.get(key) !== candidate.id || candidate.linkedRunIds.includes(runId)) continue;
      const current = this.store.getVisit(visit.id).recordings.find((asset) => asset.id === candidate.id);
      if (current && !current.linkedRunIds.includes(runId)) {
        this.store.upsertRecording(visit.id, {
          ...current,
          linkedRunIds: [...current.linkedRunIds, runId]
        });
      }
    }
  }

  private startBoundaryStillActive(sessionId: string, recording: RecordingAsset): boolean {
    try {
      const visit = this.store.getVisit(sessionId);
      const current = visit.recordings.find((candidate) => candidate.id === recording.id);
      const active = this.activeRecordings.get(recordingKey(recording.scope, recording.selectionId, recording.runId)) === recording.id
        && current?.status === "requested";
      const terminalRun = recording.scope === "run"
        ? visit.selections.find((candidate) => candidate.id === recording.selectionId)?.runs.find((candidate) => candidate.id === recording.runId)
        : undefined;
      const terminalPair = current?.status === "finalizing"
        && current.metadata?.startBeforeTerminalStop === true
        && visit.activeSelectionId === recording.selectionId
        && visit.activeRunId === undefined
        && terminalRun?.status === "finished";
      return visit.status === "active"
        && visit.recordingPolicy.scope === recording.scope
        && (active || terminalPair);
    } catch {
      return false;
    }
  }

  private scheduleRecordingWatch(sessionId: string, recording: RecordingAsset): void {
    const client = this.options.recordingClient;
    if (!client?.observe || recording.scope !== "visit" || recording.status !== "recording") return;
    this.cancelRecordingWatch();
    const generation = this.recordingWatchGeneration;
    const interval = positiveMillis(this.options.recordingWatchIntervalMillis, defaultRecordingWatchIntervalMillis);
    const maxEndsAt = recordingMetadataInteger(recording, "cameraMaxEndsAtUnixMillis");
    const lead = this.effectiveRotationLead(recording, maxEndsAt);
    const untilRotation = maxEndsAt === undefined ? interval : Math.max(10, maxEndsAt - this.now() - lead);
    const delay = Math.max(10, Math.min(interval, untilRotation));
    this.recordingWatchTimer = setTimeout(() => {
      this.recordingWatchTimer = null;
      this.inspectVisitRecording(sessionId, recording.id, generation);
    }, delay);
    this.recordingWatchTimer.unref();
  }

  private inspectVisitRecording(sessionId: string, recordingId: string, generation: number): void {
    const client = this.options.recordingClient;
    const observe = client?.observe;
    if (!observe || generation !== this.recordingWatchGeneration) return;
    this.recordingOperations = this.recordingOperations.then(async () => {
      if (generation !== this.recordingWatchGeneration) return;
      let visit: SessionHistoryVisit;
      let recording: RecordingAsset | undefined;
      try {
        visit = this.store.getVisit(sessionId);
        recording = visit.recordings.find((candidate) => candidate.id === recordingId);
      } catch {
        return;
      }
      if (!recording || recording.status !== "recording" || visit.status !== "active"
        || visit.recordingPolicy.scope !== "visit"
        || this.activeRecordings.get(recordingKey("visit")) !== recording.id) return;
      let observation;
      try {
        observation = await observe.call(client, recording);
      } catch (error) {
        this.degradeRecording(error);
        if (generation === this.recordingWatchGeneration) this.scheduleRecordingWatch(sessionId, recording);
        return;
      }
      if (generation !== this.recordingWatchGeneration) return;
      visit = this.store.getVisit(sessionId);
      recording = visit.recordings.find((candidate) => candidate.id === recordingId);
      if (!recording || visit.status !== "active" || visit.recordingPolicy.scope !== "visit"
        || this.activeRecordings.get(recordingKey("visit")) !== recording.id) return;

      const previousMaxEndsAt = recordingMetadataInteger(recording, "cameraMaxEndsAtUnixMillis");
      const maxEndsAt = observation.maxEndsAtUnixMillis ?? previousMaxEndsAt;
      if (maxEndsAt !== undefined && maxEndsAt !== previousMaxEndsAt) {
        recording = this.store.upsertRecording(sessionId, {
          ...recording,
          metadata: { ...(recording.metadata ?? {}), cameraMaxEndsAtUnixMillis: maxEndsAt }
        });
      }
      if (!observation.active) {
        this.degradeRecording(new Error(`camera capture disappeared before rotation: ${recording.captureId ?? recording.id}`));
        this.cancelRecordingWatch();
        this.activeRecordings.delete(recordingKey("visit"));
        this.store.upsertRecording(sessionId, {
          ...recording,
          status: "partial",
          endedAtUnixMillis: observation.observedAtUnixMillis,
          metadata: { ...(recording.metadata ?? {}), cameraDisappeared: true }
        });
        const current = this.store.getVisit(sessionId);
        if (current.status === "active" && current.recordingPolicy.scope === "visit") {
          this.boundary("start", "visit", current);
        }
        return;
      }
      this.recoverRecordingHealth();
      const rotationLead = this.effectiveRotationLead(recording, maxEndsAt);
      if (maxEndsAt !== undefined && maxEndsAt - observation.observedAtUnixMillis <= rotationLead) {
        this.rotateVisitRecording(sessionId, recording, generation);
        return;
      }
      this.scheduleRecordingWatch(sessionId, recording);
    });
  }

  private rotateVisitRecording(sessionId: string, recording: RecordingAsset, generation: number): void {
    if (generation !== this.recordingWatchGeneration) return;
    const visit = this.store.getVisit(sessionId);
    if (visit.status !== "active" || visit.recordingPolicy.scope !== "visit"
      || this.activeRecordings.get(recordingKey("visit")) !== recording.id) return;
    this.store.upsertRecording(sessionId, {
      ...recording,
      metadata: {
        ...(recording.metadata ?? {}),
        rotateAfterStop: true
      }
    });
    this.boundary("stop", "visit", this.store.getVisit(sessionId));
  }

  private finishVisitRotation(sessionId: string, recording: RecordingAsset): boolean {
    if (recording.scope !== "visit" || recording.metadata?.rotateAfterStop !== true
      || recording.status === "finalizing" || recording.status === "recording"
      || this.uncertainStops.size > 0) return false;
    let continued = false;
    this.safe(() => {
      const visit = this.store.getVisit(sessionId);
      if (visit.status === "active" && visit.recordingPolicy.scope === "visit"
        && !this.activeRecordings.has(recordingKey("visit"))) {
          this.store.upsertRecording(sessionId, {
            ...recording,
            metadata: {
              ...(recording.metadata ?? {}),
              rotateAfterStop: false,
              rotationCompleted: true
            }
          });
          this.boundary("start", "visit", this.store.getVisit(sessionId));
          continued = true;
      }
    });
    return continued;
  }

  private finishPendingVisitRotation(sessionId: string): boolean {
    if (this.uncertainStops.size > 0) return false;
    try {
      const visit = this.store.getVisit(sessionId);
      const pending = [...visit.recordings]
        .reverse()
        .find((recording) => recording.scope === "visit"
          && recording.metadata?.rotateAfterStop === true
          && recording.status !== "recording"
          && recording.status !== "finalizing");
      return pending ? this.finishVisitRotation(sessionId, pending) : false;
    } catch {
      return false;
    }
  }

  private resumePendingStarts(sessionId: string): void {
    this.safe(() => {
      const visit = this.store.getVisit(sessionId);
      if (visit.status !== "active") return;
      for (const recording of visit.recordings) {
        if (recording.status !== "requested" || visit.recordingPolicy.scope !== recording.scope) continue;
        const key = recordingKey(recording.scope, recording.selectionId, recording.runId);
        if (this.activeRecordings.get(key) !== recording.id) continue;
        this.enqueueBoundary("start", visit, recording, recording.selectionId, recording.runId);
      }
    });
  }

  private resumeAllPendingRecordings(): void {
    if (this.uncertainStops.size > 0) return;
    for (const visit of this.store.allVisits().filter((candidate) => candidate.status === "active")) {
      if (!this.finishPendingVisitRotation(visit.id)) this.resumePendingStarts(visit.id);
    }
  }

  private scheduleFinalizingRetry(sessionId: string, recordingId: string, expedite = false): void {
    const previous = this.recordingRetryTimers.get(recordingId);
    if (previous) clearTimeout(previous);
    const delay = expedite ? Math.min(this.finalizingRetryDelay(), 100) : this.finalizingRetryDelay();
    const timer = setTimeout(() => {
      this.recordingRetryTimers.delete(recordingId);
      this.safe(() => {
        const visit = this.store.getVisit(sessionId);
        const recording = visit.recordings.find((candidate) => candidate.id === recordingId);
        if (!recording || recording.status !== "finalizing") {
          this.resolveUncertainStop(recordingId);
          if (this.uncertainStops.size === 0) this.resumeAllPendingRecordings();
          return;
        }
        this.enqueueBoundary("stop", visit, recording, recording.selectionId, recording.runId);
      });
    }, delay);
    timer.unref();
    this.recordingRetryTimers.set(recordingId, timer);
  }

  private finalizingRetryDelay(): number {
    const configured = positiveMillis(
      this.options.recordingWatchIntervalMillis,
      defaultRecordingWatchIntervalMillis
    );
    return this.recordingDrainActive ? Math.min(configured, 100) : configured;
  }

  private scheduleStartRetry(sessionId: string, recordingId: string): void {
    const previous = this.recordingStartRetryTimers.get(recordingId);
    if (previous) clearTimeout(previous);
    const attempt = (this.recordingStartRetryAttempts.get(recordingId) ?? 0) + 1;
    this.recordingStartRetryAttempts.set(recordingId, attempt);
    const baseDelay = positiveMillis(
      this.options.recordingStartRetryMillis,
      defaultRecordingStartRetryMillis
    );
    const delay = Math.min(maximumRecordingStartRetryMillis, baseDelay * (2 ** Math.min(attempt - 1, 10)));
    const timer = setTimeout(() => {
      this.recordingStartRetryTimers.delete(recordingId);
      this.safe(() => {
        const visit = this.store.getVisit(sessionId);
        const current = visit.recordings.find((candidate) => candidate.id === recordingId);
        if (!current || visit.status !== "active" || visit.recordingPolicy.scope !== current.scope) {
          this.cancelStartRetry(recordingId);
          return;
        }
        const key = recordingKey(current.scope, current.selectionId, current.runId);
        if (this.activeRecordings.get(key) !== current.id) {
          this.cancelStartRetry(recordingId);
          return;
        }
        if (this.uncertainStops.size > 0) {
          this.scheduleStartRetry(sessionId, recordingId);
          return;
        }
        const recording = current.status === "failed"
          ? this.store.upsertRecording(sessionId, {
              ...current,
              status: "requested",
              metadata: { ...(current.metadata ?? {}), retryingStart: true }
            })
          : current;
        if (recording.status !== "requested") {
          this.cancelStartRetry(recordingId);
          return;
        }
        this.enqueueBoundary("start", visit, recording, recording.selectionId, recording.runId);
      });
    }, delay);
    timer.unref();
    this.recordingStartRetryTimers.set(recordingId, timer);
  }

  private cancelStartRetry(recordingId: string): void {
    const timer = this.recordingStartRetryTimers.get(recordingId);
    if (timer) clearTimeout(timer);
    this.recordingStartRetryTimers.delete(recordingId);
    this.recordingStartRetryAttempts.delete(recordingId);
  }

  private clearInactiveStartFailures(): void {
    const activeIds = new Set(this.activeRecordings.values());
    for (const recordingId of this.unresolvedStartFailures) {
      if (activeIds.has(recordingId)) continue;
      this.unresolvedStartFailures.delete(recordingId);
      this.cancelStartRetry(recordingId);
    }
  }

  private resolveUncertainStop(recordingId: string): void {
    this.uncertainStops.delete(recordingId);
    this.pendingRecordingStops.delete(recordingId);
    const timer = this.recordingRetryTimers.get(recordingId);
    if (timer) clearTimeout(timer);
    this.recordingRetryTimers.delete(recordingId);
    if (this.pendingRecordingStops.size === 0) {
      for (const waiter of this.recordingStopWaiters) waiter.resolve();
      this.recordingStopWaiters.clear();
    }
  }

  private rejectRecordingStopWaiters(error: unknown): void {
    for (const waiter of this.recordingStopWaiters) waiter.reject(error);
    this.recordingStopWaiters.clear();
  }

  private waitForNoRecordingStops(): Promise<void> {
    if (this.pendingRecordingStops.size === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.recordingStopWaiters.add({ resolve, reject });
      // Operator decisions are serialized control calls, so do not leave one
      // parked behind the normal background retry cadence.
      this.expediteUncertainStops();
    });
  }

  private cancelRecordingWatch(): void {
    if (this.recordingWatchTimer) clearTimeout(this.recordingWatchTimer);
    this.recordingWatchTimer = null;
    this.recordingWatchGeneration += 1;
  }

  private effectiveRotationLead(recording: RecordingAsset, maxEndsAt: number | undefined): number {
    const configured = positiveMillis(
      this.options.recordingRotationLeadMillis,
      defaultRecordingRotationLeadMillis
    );
    if (maxEndsAt === undefined || recording.startedAtUnixMillis === undefined) return configured;
    const lifetime = Math.max(20, maxEndsAt - recording.startedAtUnixMillis);
    return Math.min(configured, Math.max(10, Math.floor(lifetime / 2)));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private safe<T>(operation: () => T, fallback?: T): T | undefined {
    try {
      return operation();
    } catch (error) {
      this.degrade(error);
      return fallback;
    }
  }

  private degrade(error: unknown): void {
    this.healthyValue = false;
    this.lastErrorValue = error instanceof Error ? error.message : String(error);
    this.options.log?.("session history degraded", error);
  }

  private degradeRecording(error: unknown): void {
    this.recordingHealthyValue = false;
    this.recordingLastErrorValue = error instanceof Error ? error.message : String(error);
    this.options.log?.("session recording degraded", error);
  }

  private recoverRecordingHealth(): void {
    for (const recordingId of this.unresolvedStartFailures) this.cancelStartRetry(recordingId);
    this.unresolvedStartFailures.clear();
    this.recordingHealthyValue = true;
    this.recordingLastErrorValue = "";
  }
}

function isConfirmedStoppedRecording(recording: RecordingAsset): boolean {
  if (recording.metadata?.stopConfirmed === true) return true;
  return recording.status === "complete"
    || recording.status === "partial"
    || recording.status === "missing";
}

function policyFromInput(
  input: Pick<HistoryVisitInput, "recordingPolicy" | "recordingEnabled">,
  fallback: RecordingPolicy = { scope: "selection" }
): RecordingPolicy {
  if (input.recordingPolicy !== undefined) return normalizeRecordingPolicy(input.recordingPolicy);
  if (input.recordingEnabled !== undefined) return normalizeRecordingPolicy(input.recordingEnabled);
  return { ...fallback };
}

function recordingPoliciesEqual(left: RecordingPolicy, right: RecordingPolicy): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isOpenRecording(asset: RecordingAsset): boolean {
  return isCameraRecordingAsset(asset)
    && (asset.status === "requested" || asset.status === "recording" || asset.status === "finalizing");
}

function isCameraRecordingAsset(asset: RecordingAsset): boolean {
  return asset.backend !== "venue-runtime-replay";
}

function runStatus(phase: string): SessionHistoryRun["status"] {
  if (phase === "finished") return "finished";
  if (phase === "paused") return "paused";
  if (phase === "running") return "running";
  if (phase === "waiting") return "waiting";
  return "starting";
}

function recordingArmingHistoryState(
  state: GameSessionState,
  options: HistoryRunStartOptions
): GameSessionState {
  const source = state.snapshot as unknown as Record<string, unknown>;
  const maximumLives = Number(source.maxLives);
  const snapshot = {
    ...source,
    phase: "recording_arming",
    success: false,
    score: 0,
    elapsedMillis: 0,
    remainingMillis: 0,
    countdownMillis: 0,
    resultMillis: 0,
    ...(Number.isFinite(maximumLives) ? { lives: maximumLives } : {}),
    ...(options.pendingLevelId ? { level: options.pendingLevelId } : {}),
    ...(options.pendingLevelSlug ? { levelSlug: options.pendingLevelSlug } : {})
  } as unknown as GameSessionState["snapshot"];
  return {
    ...state,
    clockMillis: 0,
    paused: false,
    snapshot,
    events: []
  };
}

function materialFingerprint(state: GameSessionState): SessionHistoryJsonObject {
  return {
    phase: String(state.snapshot.phase),
    success: state.snapshot.success,
    score: state.snapshot.score,
    lives: state.snapshot.lives,
    players: state.snapshot.players.map((player) => ({
      index: player.index,
      label: player.label,
      score: player.score,
      lives: player.lives
    })),
    rounds: (state.snapshot.rounds ?? []).map((round) => jsonObject(round))
  };
}

function historySnapshot(state: GameSessionState): SessionHistoryJsonObject {
  return jsonObject(state.snapshot);
}

function jsonObject(value: unknown): SessionHistoryJsonObject {
  const normalized: unknown = JSON.parse(JSON.stringify(value, (_key, candidate) => {
    if (typeof candidate === "bigint") return String(candidate);
    if (typeof candidate === "number" && !Number.isFinite(candidate)) return null;
    return candidate;
  }));
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? normalized as SessionHistoryJsonObject
    : {};
}

function recordingKey(scope: RecordingScope, selectionId?: string, runId?: string): string {
  return `${scope}:${selectionId ?? ""}:${runId ?? ""}`;
}

function initialLinkedRunIds(
  scope: RecordingScope,
  visit: SessionHistoryVisit,
  selectionId?: string,
  runId?: string
): string[] {
  if (scope === "run") return runId ? [runId] : [];
  if (!visit.activeRunId || !visit.activeSelectionId) return [];
  if (scope === "selection" && selectionId !== visit.activeSelectionId) return [];
  const selection = visit.selections.find((candidate) => candidate.id === visit.activeSelectionId);
  const activeRun = selection?.runs.find((candidate) => candidate.id === visit.activeRunId);
  return activeRun && activeRun.endedAtUnixMillis === undefined ? [activeRun.id] : [];
}

function positiveMillis(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.max(10, Math.round(Number(value))) : fallback;
}

function recordingMetadataInteger(recording: RecordingAsset, key: string): number | undefined {
  const value = recording.metadata?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
