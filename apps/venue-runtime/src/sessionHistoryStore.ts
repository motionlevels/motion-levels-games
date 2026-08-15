import { randomUUID } from "node:crypto";
import {
  closeSync,
  fdatasyncSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  writeSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  SESSION_HISTORY_CONTRACT_VERSION,
  SESSION_HISTORY_SCHEMA,
  type RecordingAsset,
  type SessionEventsResponse,
  type SessionHistoryEvent,
  type SessionHistoryJsonObject,
  type SessionHistoryJsonValue,
  type SessionHistorySummary,
  type SessionHistoryVisit,
  type SessionListResponse
} from "@motion-levels-games/session-history";

const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
const creatingDirectoryPattern = /^\.creating-[1-9][0-9]*-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const creatingTemporaryManifestPattern = /^\.manifest\.json\.[1-9][0-9]*\.[0-9a-f-]{36}\.tmp$/iu;
const defaultPageLimit = 50;
const maximumPageLimit = 500;
const maximumSequence = 999_999_999_999;
export const sessionHistoryEventCacheLimit = 32;

export class SessionHistoryNotFoundError extends Error {}
export class SessionHistoryValidationError extends Error {}
export class SessionHistoryConflictError extends Error {}

export type SessionListQuery = {
  cursor?: string;
  limit?: number;
  status?: "active" | "ended";
  from?: number;
  to?: number;
};

export type SessionEventsQuery = {
  cursor?: string;
  afterSequence?: number;
  limit?: number;
};

export type NewSessionEvent = Omit<SessionHistoryEvent, "id" | "sequence" | "sessionId">;
type JournalBatchV1 = {
  journalBatchVersion: 1;
  events: SessionHistoryEvent[];
};
export type SessionHistoryStoreDiagnostics = {
  onJournalBatch?(eventCount: number): void;
  onTransitionStage?(stage: "after_journal" | "after_manifest"): void;
};

/**
 * Node 24-compatible local history store. Manifests are atomically replaced;
 * timeline entries are durable, append-only NDJSON records.
 */
export class SessionHistoryStore {
  private readonly visits = new Map<string, SessionHistoryVisit>();
  private readonly eventsByVisit = new Map<string, SessionHistoryEvent[]>();
  private readonly captureOwners = new Map<string, string>();
  private healthyValue = true;
  private lastErrorValue = "";

  constructor(
    readonly rootDir: string,
    private readonly now: () => number = Date.now,
    private readonly diagnostics: SessionHistoryStoreDiagnostics = {}
  ) {
    try {
      mkdirSync(rootDir, { recursive: true, mode: 0o700 });
      this.load();
    } catch (error) {
      this.fail(error);
    }
  }

  health(): { configured: true; healthy: boolean; rootDir: string; lastError: string } {
    return {
      configured: true,
      healthy: this.healthyValue,
      rootDir: this.rootDir,
      lastError: this.lastErrorValue
    };
  }

  createVisit(visit: SessionHistoryVisit, initialEvents: readonly NewSessionEvent[] = []): SessionHistoryVisit {
    const desired = clone(visit);
    validateVisit(desired);
    for (const recording of desired.recordings) {
      validateRecording(desired, recording);
      this.assertCaptureAvailable(desired.id, recording);
    }
    if (this.visits.has(desired.id)) {
      throw new SessionHistoryValidationError(`session already exists: ${desired.id}`);
    }
    const events = transitionEvents(desired, initialEvents, desired.lastSequence);
    desired.lastSequence = events.at(-1)?.sequence ?? desired.lastSequence;
    const durableEvents = events.map((event) => withTransitionState(event, desired));
    const target = this.visitDirectory(desired.id);
    removeEmptyOrphanDirectory(target);
    const staging = join(this.rootDir, `.creating-${process.pid}-${randomUUID()}`);
    let renamed = false;
    try {
      mkdirSync(staging, { recursive: false, mode: 0o700 });
      atomicJson(join(staging, "manifest.json"), desired);
      appendLinesAtPath(join(staging, "events.ndjson"), durableEvents);
      fsyncDirectory(staging);
      renameSync(staging, target);
      renamed = true;
      fsyncDirectory(this.rootDir);
      this.visits.set(desired.id, clone(desired));
      this.cacheEvents(desired.id, clone(durableEvents));
      this.replaceVisitCaptures(desired.id, [], desired.recordings);
      this.notifyJournalBatch(durableEvents.length);
      return clone(desired);
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      if (!renamed) removeEmptyCreatingDirectory(staging);
    }
  }

  saveVisit(visit: SessionHistoryVisit): SessionHistoryVisit {
    validateVisit(visit);
    const previous = this.visits.get(visit.id);
    if (!previous) {
      throw new SessionHistoryNotFoundError(`session not found: ${visit.id}`);
    }
    for (const recording of visit.recordings) {
      validateRecording(visit, recording);
      this.assertCaptureAvailable(visit.id, recording);
    }
    try {
      this.writeManifest(visit);
      this.visits.set(visit.id, clone(visit));
      this.replaceVisitCaptures(visit.id, previous.recordings, visit.recordings);
      return clone(visit);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Commit a lifecycle transition with the journal as the write-ahead log.
   * Every event carries enough after-state to replay the transition if the
   * process exits after fdatasync but before the manifest checkpoint. */
  commitTransition(
    visit: SessionHistoryVisit,
    inputs: readonly NewSessionEvent[]
  ): { visit: SessionHistoryVisit; events: SessionHistoryEvent[] } {
    const previous = this.getMutable(visit.id);
    if (!inputs.length) throw new SessionHistoryValidationError("transition event batch is empty");
    const desired = clone(visit);
    if (inputs.length > maximumSequence - previous.lastSequence) {
      throw new SessionHistoryValidationError("session event sequence is exhausted");
    }
    const events = transitionEvents(desired, inputs, previous.lastSequence);
    desired.lastSequence = events.at(-1)?.sequence ?? previous.lastSequence;
    desired.updatedAtUnixMillis = events.reduce(
      (maximum, event) => Math.max(maximum, event.occurredAtUnixMillis),
      desired.updatedAtUnixMillis
    );
    validateVisit(desired);
    for (const recording of desired.recordings) {
      validateRecording(desired, recording);
      this.assertCaptureAvailable(desired.id, recording);
    }
    const durableEvents = events.map((event) => withTransitionState(event, desired));
    try {
      this.appendLines(desired.id, durableEvents);
      this.visits.set(desired.id, clone(desired));
      this.replaceVisitCaptures(desired.id, previous.recordings, desired.recordings);
      this.notifyJournalBatch(durableEvents.length);
      this.diagnostics.onTransitionStage?.("after_journal");
      this.writeManifest(desired);
      this.diagnostics.onTransitionStage?.("after_manifest");
      return { visit: clone(desired), events: clone(events) };
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  getVisit(id: string): SessionHistoryVisit {
    return clone(this.getMutable(id));
  }

  allVisits(): SessionHistoryVisit[] {
    return clone([...this.visits.values()]);
  }

  listVisits(query: SessionListQuery = {}): SessionListResponse {
    const limit = pageLimit(query.limit);
    const observedAt = this.now();
    let visits = [...this.visits.values()]
      .filter((visit) => query.status === undefined || visit.status === query.status)
      .filter((visit) => query.from === undefined
        || (visit.endedAtUnixMillis ?? (visit.status === "active" ? observedAt : visit.updatedAtUnixMillis)) >= query.from)
      .filter((visit) => query.to === undefined || visit.startedAtUnixMillis <= query.to)
      .sort((left, right) => right.startedAtUnixMillis - left.startedAtUnixMillis || right.id.localeCompare(left.id));

    if (query.cursor) {
      const cursor = decodeVisitCursor(query.cursor);
      const index = visits.findIndex((visit) => visit.id === cursor.id && visit.startedAtUnixMillis === cursor.at);
      if (index < 0) throw new SessionHistoryValidationError("invalid session cursor");
      visits = visits.slice(index + 1);
    }

    const page = visits.slice(0, limit);
    const tail = page.at(-1);
    return {
      schema: SESSION_HISTORY_SCHEMA,
      sessions: page.map((visit) => visitSummary(visit, observedAt)),
      nextCursor: visits.length > page.length && tail
        ? encodeVisitCursor(tail.startedAtUnixMillis, tail.id)
        : null
    };
  }

  appendEvent(sessionId: string, input: NewSessionEvent): SessionHistoryEvent {
    const event = this.appendEvents(sessionId, [input])[0];
    if (!event) throw new SessionHistoryValidationError("session event batch is empty");
    return event;
  }

  appendEvents(sessionId: string, inputs: readonly NewSessionEvent[]): SessionHistoryEvent[] {
    const visit = this.getMutable(sessionId);
    if (!inputs.length) return [];
    if (inputs.length > maximumSequence - visit.lastSequence) {
      throw new SessionHistoryValidationError("session event sequence is exhausted");
    }
    const events = transitionEvents(visit, inputs, visit.lastSequence);
    try {
      this.appendLines(sessionId, events);
      visit.lastSequence = events.at(-1)?.sequence ?? visit.lastSequence;
      visit.updatedAtUnixMillis = events.reduce(
        (maximum, event) => Math.max(maximum, event.occurredAtUnixMillis),
        visit.updatedAtUnixMillis
      );
      this.notifyJournalBatch(events.length);
      return clone(events);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  listEvents(sessionId: string, query: SessionEventsQuery = {}): SessionEventsResponse {
    this.getMutable(sessionId);
    const limit = pageLimit(query.limit);
    if (query.cursor && query.afterSequence !== undefined) {
      throw new SessionHistoryValidationError("cursor and afterSequence are mutually exclusive");
    }
    const after = query.cursor
      ? decodeSequenceCursor(query.cursor)
      : eventAfterSequence(query.afterSequence);
    const available = this.eventsForVisit(sessionId);
    const start = firstEventAfter(available, after);
    const events = available.slice(start, start + limit).map(publicEvent);
    const tail = events.at(-1);
    return {
      schema: SESSION_HISTORY_SCHEMA,
      sessionId,
      events: clone(events),
      nextCursor: start + events.length < available.length && tail ? encodeSequenceCursor(tail.sequence) : null
    };
  }

  upsertRecording(sessionId: string, recording: RecordingAsset): RecordingAsset {
    const visit = clone(this.getMutable(sessionId));
    validateRecording(visit, recording);
    this.assertCaptureAvailable(sessionId, recording);

    const index = visit.recordings.findIndex((candidate) => candidate.id === recording.id);
    if (index < 0) visit.recordings.push(clone(recording));
    else visit.recordings[index] = clone(recording);

    const occurredAtUnixMillis = this.now();
    this.commitTransition(visit, [{
      selectionId: recording.selectionId,
      runId: recording.runId,
      kind: "recording.updated",
      occurredAtUnixMillis,
      payload: { recording: jsonObject(recording) }
    }]);
    return clone(recording);
  }

  /** Keep the visit open for kiosk recovery while closing the game work that
   * could no longer be running after a process restart. */
  recoverOpenVisit(at = this.now()): SessionHistoryVisit | null {
    const active = [...this.visits.values()]
      .filter((visit) => visit.status === "active")
      .sort((left, right) => right.updatedAtUnixMillis - left.updatedAtUnixMillis || right.id.localeCompare(left.id));
    const chosen = active[0];
    for (const stale of active.slice(1)) this.closeRecoveredVisit(stale, at, true);
    if (!chosen) return null;
    this.closeRecoveredVisit(chosen, at, false);
    this.appendEvent(chosen.id, {
      kind: "visit.recovered",
      occurredAtUnixMillis: at,
      payload: {}
    });
    return this.getVisit(chosen.id);
  }

  private closeRecoveredVisit(visit: SessionHistoryVisit, at: number, endVisit: boolean): void {
    let desired = clone(visit);
    let selection = desired.selections.find((candidate) => candidate.id === desired.activeSelectionId);
    let run = selection?.runs.find((candidate) => candidate.id === desired.activeRunId);
    if (run && run.endedAtUnixMillis === undefined) {
      run.status = "interrupted";
      run.outcome = "runtime_interrupted";
      run.finishedAtUnixMillis = at;
      run.endedAtUnixMillis = at;
      desired.updatedAtUnixMillis = at;
      desired = this.commitTransition(desired, [{
        selectionId: selection?.id,
        runId: run.id,
        kind: "run.interrupted",
        occurredAtUnixMillis: at,
        payload: { reason: "runtime_interrupted" }
      }]).visit;
      selection = desired.selections.find((candidate) => candidate.id === desired.activeSelectionId);
      run = selection?.runs.find((candidate) => candidate.id === desired.activeRunId);
    }
    if (selection && selection.endedAtUnixMillis === undefined) {
      selection.endedAtUnixMillis = at;
      selection.endReason = "runtime_interrupted";
      desired.activeSelectionId = undefined;
      desired.activeRunId = undefined;
      desired.updatedAtUnixMillis = at;
      desired = this.commitTransition(desired, [{
        selectionId: selection.id,
        runId: run?.id,
        kind: "selection.ended",
        occurredAtUnixMillis: at,
        payload: { reason: "runtime_interrupted" }
      }]).visit;
    } else if (desired.activeSelectionId || desired.activeRunId) {
      desired.activeSelectionId = undefined;
      desired.activeRunId = undefined;
      desired.updatedAtUnixMillis = at;
      desired = this.commitTransition(desired, [{
        kind: "visit.updated",
        occurredAtUnixMillis: at,
        payload: { reason: "recovered_state" }
      }]).visit;
    }
    if (endVisit) {
      desired.status = "ended";
      desired.endedAtUnixMillis = at;
      desired.endReason = "superseded_during_recovery";
      desired.updatedAtUnixMillis = at;
      this.commitTransition(desired, [{
        kind: "visit.ended",
        occurredAtUnixMillis: at,
        payload: { reason: "superseded_during_recovery" }
      }]);
    }
  }

  private load(): void {
    for (const entry of readdirSync(this.rootDir, { withFileTypes: true })) {
      if (entry.isDirectory() && creatingDirectoryPattern.test(entry.name)) {
        removeOrphanCreatingDirectory(join(this.rootDir, entry.name));
        continue;
      }
      if (!entry.isDirectory() || !sessionIdPattern.test(entry.name)) continue;
      try {
        let manifest = "";
        try {
          manifest = readFileSync(this.manifestPath(entry.name), "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT"
            && removeEmptyOrphanDirectory(this.visitDirectory(entry.name))) {
            continue;
          }
          throw error;
        }
        const parsed = JSON.parse(manifest) as SessionHistoryVisit;
        validateVisit(parsed);
        if (parsed.id !== entry.name) throw new Error(`session directory identity mismatch: ${entry.name}`);
        for (const recording of parsed.recordings) validateRecording(parsed, recording);
        const events = this.readEventsFromDisk(entry.name)
          .sort((left, right) => left.sequence - right.sequence);
        this.cacheEvents(entry.name, clone(events));
        const manifestSequence = parsed.lastSequence;
        for (const event of events
          .filter((candidate) => candidate.sequence > manifestSequence)
          .sort((left, right) => left.sequence - right.sequence)) {
          this.replayTransition(parsed, event);
        }
        const maxSequence = events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
        parsed.lastSequence = Math.max(parsed.lastSequence, maxSequence);
        parsed.updatedAtUnixMillis = events.reduce(
          (maximum, event) => Math.max(maximum, event.occurredAtUnixMillis),
          parsed.updatedAtUnixMillis
        );
        validateVisit(parsed);
        for (const recording of parsed.recordings) validateRecording(parsed, recording);
        if (parsed.lastSequence !== manifestSequence) this.writeManifest(parsed);
        this.registerVisitCaptures(parsed);
        this.visits.set(entry.name, parsed);
      } catch (error) {
        this.fail(error);
      }
    }
  }

  private getMutable(id: string): SessionHistoryVisit {
    assertSessionHistorySessionId(id);
    const visit = this.visits.get(id);
    if (!visit) throw new SessionHistoryNotFoundError(`session not found: ${id}`);
    return visit;
  }

  private replayTransition(visit: SessionHistoryVisit, event: SessionHistoryEvent): void {
    const state = event.payload.historyTransitionState;
    if (state && typeof state === "object" && !Array.isArray(state)) {
      applyTransitionState(visit, state as SessionHistoryJsonObject);
      visit.lastSequence = Math.max(visit.lastSequence, event.sequence);
      visit.updatedAtUnixMillis = Math.max(visit.updatedAtUnixMillis, event.occurredAtUnixMillis);
      return;
    }
    if (event.kind !== "recording.updated") return;
    const candidate = event.payload.recording;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      // v1 development journals created before full recording payload replay
      // cannot repair an interrupted manifest, but remain readable.
      return;
    }
    const recording = clone(candidate) as unknown as RecordingAsset;
    validateRecording(visit, recording);
    const index = visit.recordings.findIndex((current) => current.id === recording.id);
    if (index < 0) visit.recordings.push(recording);
    else visit.recordings[index] = recording;
    visit.lastSequence = Math.max(visit.lastSequence, event.sequence);
    visit.updatedAtUnixMillis = Math.max(visit.updatedAtUnixMillis, event.occurredAtUnixMillis);
  }

  private assertCaptureAvailable(sessionId: string, recording: RecordingAsset): void {
    if (!recording.captureId) return;
    const owner = this.captureOwners.get(recording.captureId);
    if (owner && owner !== captureOwner(sessionId, recording.id)) {
      throw new SessionHistoryValidationError("recording captureId already belongs to another asset");
    }
  }

  private registerVisitCaptures(visit: SessionHistoryVisit): void {
    for (const recording of visit.recordings) this.assertCaptureAvailable(visit.id, recording);
    for (const recording of visit.recordings) {
      if (recording.captureId) {
        this.captureOwners.set(recording.captureId, captureOwner(visit.id, recording.id));
      }
    }
  }

  private notifyJournalBatch(eventCount: number): void {
    try {
      this.diagnostics.onJournalBatch?.(eventCount);
    } catch {
      // Diagnostics must never affect durable history writes.
    }
  }

  private replaceVisitCaptures(
    sessionId: string,
    previous: RecordingAsset[],
    recordings: RecordingAsset[]
  ): void {
    for (const recording of previous) {
      if (!recording.captureId) continue;
      const owner = captureOwner(sessionId, recording.id);
      if (this.captureOwners.get(recording.captureId) === owner) {
        this.captureOwners.delete(recording.captureId);
      }
    }
    for (const recording of recordings) {
      if (recording.captureId) {
        this.captureOwners.set(recording.captureId, captureOwner(sessionId, recording.id));
      }
    }
  }

  private visitDirectory(id: string): string {
    assertSessionHistorySessionId(id);
    return join(this.rootDir, id);
  }

  private manifestPath(id: string): string {
    return join(this.visitDirectory(id), "manifest.json");
  }

  private eventsPath(id: string): string {
    return join(this.visitDirectory(id), "events.ndjson");
  }

  private writeManifest(visit: SessionHistoryVisit): void {
    atomicJson(this.manifestPath(visit.id), visit);
  }

  private appendLines(id: string, events: readonly SessionHistoryEvent[]): void {
    appendLinesAtPath(this.eventsPath(id), events);
    const cached = this.eventsByVisit.get(id);
    if (cached) {
      cached.push(...clone(events));
      this.cacheEvents(id, cached);
    }
  }

  private eventsForVisit(id: string): SessionHistoryEvent[] {
    const cached = this.eventsByVisit.get(id);
    if (cached) {
      this.cacheEvents(id, cached);
      return cached;
    }
    const events = this.readEventsFromDisk(id).sort((left, right) => left.sequence - right.sequence);
    this.cacheEvents(id, events);
    return events;
  }

  private cacheEvents(id: string, events: SessionHistoryEvent[]): void {
    this.eventsByVisit.delete(id);
    this.eventsByVisit.set(id, events);
    while (this.eventsByVisit.size > sessionHistoryEventCacheLimit) {
      const oldest = this.eventsByVisit.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.eventsByVisit.delete(oldest);
    }
  }

  private readEventsFromDisk(id: string): SessionHistoryEvent[] {
    let text = "";
    try {
      text = readFileSync(this.eventsPath(id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    let completeText = text;
    if (text && !text.endsWith("\n")) {
      const lastNewline = text.lastIndexOf("\n");
      completeText = lastNewline < 0 ? "" : text.slice(0, lastNewline + 1);
      truncateJournal(this.eventsPath(id), Buffer.byteLength(completeText));
      this.fail(new Error(`invalid event journal ${id}: torn final record`));
    }
    const unique = new Map<number, SessionHistoryEvent>();
    for (const [index, source] of completeText.split("\n").entries()) {
      const line = source.trim();
      if (!line) continue;
      try {
        const events = journalRecordEvents(JSON.parse(line));
        const recordSequences = new Set<number>();
        for (const [eventIndex, event] of events.entries()) {
          if (event.sessionId !== id || !Number.isSafeInteger(event.sequence) || event.sequence < 1
            || recordSequences.has(event.sequence)
            || (eventIndex > 0 && event.sequence !== events[eventIndex - 1]!.sequence + 1)) {
            throw new Error("event identity is invalid");
          }
          recordSequences.add(event.sequence);
        }
        const existing = events.map((event) => unique.get(event.sequence));
        if (existing.some(Boolean)) {
          if (!existing.every((event, eventIndex) => event !== undefined
            && JSON.stringify(event) === JSON.stringify(events[eventIndex]))) {
            throw new Error("journal batch overlaps existing events");
          }
          continue;
        }
        for (const event of events) {
          unique.set(event.sequence, event);
        }
      } catch (error) {
        this.fail(new Error(`invalid event journal ${id} line ${index + 1}: ${String(error)}`));
      }
    }
    return [...unique.values()];
  }

  private fail(error: unknown): void {
    this.healthyValue = false;
    this.lastErrorValue = error instanceof Error ? error.message : String(error);
  }
}

function transitionEvents(
  visit: SessionHistoryVisit,
  inputs: readonly NewSessionEvent[],
  afterSequence: number
): SessionHistoryEvent[] {
  return inputs.map((input, index): SessionHistoryEvent => {
    const sequence = afterSequence + index + 1;
    return {
      ...clone(input),
      id: `${visit.id}:${String(sequence).padStart(12, "0")}`,
      sequence,
      sessionId: visit.id
    };
  });
}

function withTransitionState(
  event: SessionHistoryEvent,
  visit: SessionHistoryVisit
): SessionHistoryEvent {
  const selectionIds = new Set<string>();
  if (event.selectionId) selectionIds.add(event.selectionId);
  if (event.runId) {
    const runSelection = visit.selections.find((selection) => selection.runs.some((run) => run.id === event.runId));
    if (runSelection) selectionIds.add(runSelection.id);
  }
  const recordingIds = new Set<string>();
  if (event.kind === "recording.updated") {
    const recording = event.payload.recording;
    if (recording && typeof recording === "object" && !Array.isArray(recording)) {
      const id = (recording as SessionHistoryJsonObject).id;
      if (typeof id === "string") recordingIds.add(id);
    }
  }
  const state = jsonObject({
    visit: visitTransitionPatch(visit),
    selections: visit.selections.filter((selection) => selectionIds.has(selection.id)),
    recordings: visit.recordings.filter((recording) => recordingIds.has(recording.id))
  });
  return {
    ...event,
    payload: {
      ...clone(event.payload),
      historyTransitionState: state
    }
  };
}

function visitTransitionPatch(visit: SessionHistoryVisit): SessionHistoryJsonObject {
  return jsonObject({
    id: visit.id,
    status: visit.status,
    origin: visit.origin ?? null,
    startedAtUnixMillis: visit.startedAtUnixMillis,
    endedAtUnixMillis: visit.endedAtUnixMillis ?? null,
    endReason: visit.endReason ?? null,
    controllerId: visit.controllerId ?? null,
    kioskId: visit.kioskId ?? null,
    updatedAtUnixMillis: visit.updatedAtUnixMillis,
    teamName: visit.teamName,
    players: visit.players,
    recordingPolicy: visit.recordingPolicy,
    activeSelectionId: visit.activeSelectionId ?? null,
    activeRunId: visit.activeRunId ?? null
  });
}

function applyTransitionState(visit: SessionHistoryVisit, state: SessionHistoryJsonObject): void {
  const rawVisit = state.visit;
  if (!rawVisit || typeof rawVisit !== "object" || Array.isArray(rawVisit)) {
    throw new SessionHistoryValidationError("transition visit state is invalid");
  }
  const patch = rawVisit as SessionHistoryJsonObject;
  if (patch.id !== visit.id || (patch.status !== "active" && patch.status !== "ended")) {
    throw new SessionHistoryValidationError("transition visit identity is invalid");
  }
  const candidate = clone(visit);
  candidate.status = patch.status;
  candidate.origin = nullableString(patch.origin, "transition origin");
  candidate.startedAtUnixMillis = safeInteger(patch.startedAtUnixMillis, "transition startedAtUnixMillis");
  candidate.endedAtUnixMillis = nullableInteger(patch.endedAtUnixMillis, "transition endedAtUnixMillis");
  candidate.endReason = nullableString(patch.endReason, "transition endReason");
  candidate.controllerId = nullableString(patch.controllerId, "transition controllerId");
  candidate.kioskId = nullableString(patch.kioskId, "transition kioskId");
  candidate.updatedAtUnixMillis = safeInteger(patch.updatedAtUnixMillis, "transition updatedAtUnixMillis");
  if (typeof patch.teamName !== "string" || !Array.isArray(patch.players)
    || !patch.recordingPolicy || typeof patch.recordingPolicy !== "object" || Array.isArray(patch.recordingPolicy)) {
    throw new SessionHistoryValidationError("transition visit metadata is invalid");
  }
  candidate.teamName = patch.teamName;
  candidate.players = clone(patch.players) as SessionHistoryVisit["players"];
  candidate.recordingPolicy = clone(patch.recordingPolicy) as SessionHistoryVisit["recordingPolicy"];
  candidate.activeSelectionId = nullableString(patch.activeSelectionId, "transition activeSelectionId");
  candidate.activeRunId = nullableString(patch.activeRunId, "transition activeRunId");

  const selections = state.selections;
  if (!Array.isArray(selections)) throw new SessionHistoryValidationError("transition selections are invalid");
  for (const value of selections) {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string") {
      throw new SessionHistoryValidationError("transition selection is invalid");
    }
    const selection = clone(value) as unknown as SessionHistoryVisit["selections"][number];
    const index = candidate.selections.findIndex((current) => current.id === selection.id);
    if (index < 0) candidate.selections.push(selection);
    else candidate.selections[index] = selection;
  }

  const recordings = state.recordings;
  if (!Array.isArray(recordings)) throw new SessionHistoryValidationError("transition recordings are invalid");
  for (const value of recordings) {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string") {
      throw new SessionHistoryValidationError("transition recording is invalid");
    }
    const recording = clone(value) as unknown as RecordingAsset;
    const index = candidate.recordings.findIndex((current) => current.id === recording.id);
    if (index < 0) candidate.recordings.push(recording);
    else candidate.recordings[index] = recording;
  }
  validateVisit(candidate);
  for (const recording of candidate.recordings) validateRecording(candidate, recording);
  Object.assign(visit, candidate);
}

function publicEvent(event: SessionHistoryEvent): SessionHistoryEvent {
  const payload = clone(event.payload);
  delete payload.historyTransitionState;
  return { ...clone(event), payload };
}

function nullableString(value: SessionHistoryJsonValue | undefined, label: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new SessionHistoryValidationError(`${label} is invalid`);
  return value;
}

function safeInteger(value: SessionHistoryJsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SessionHistoryValidationError(`${label} is invalid`);
  }
  return value;
}

function nullableInteger(value: SessionHistoryJsonValue | undefined, label: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  return safeInteger(value, label);
}

function journalRecordEvents(value: unknown): SessionHistoryEvent[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("journal record is invalid");
  }
  if ("journalBatchVersion" in value) {
    const batch = value as Partial<JournalBatchV1>;
    if (batch.journalBatchVersion !== 1 || !Array.isArray(batch.events) || batch.events.length === 0) {
      throw new Error("journal batch is invalid");
    }
    return batch.events as SessionHistoryEvent[];
  }
  return [value as SessionHistoryEvent];
}

function appendLinesAtPath(path: string, events: readonly SessionHistoryEvent[]): void {
  if (!events.length) return;
  const descriptor = openSync(path, "a+", 0o600);
  try {
    let size = fstatSync(descriptor).size;
    if (size > 0) {
      const last = Buffer.allocUnsafe(1);
      readSync(descriptor, last, 0, 1, size - 1);
      if (last[0] !== 10) {
        size = completeJournalSize(descriptor, size);
        ftruncateSync(descriptor, size);
      }
    }
    const batch: JournalBatchV1 = { journalBatchVersion: 1, events: clone([...events]) };
    const data = Buffer.from(`${JSON.stringify(batch)}\n`);
    let offset = 0;
    while (offset < data.length) {
      offset += writeSync(descriptor, data, offset, data.length - offset);
    }
    fdatasyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function completeJournalSize(descriptor: number, size: number): number {
  const blockSize = 4_096;
  const buffer = Buffer.allocUnsafe(blockSize);
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - blockSize);
    const length = end - start;
    readSync(descriptor, buffer, 0, length, start);
    for (let index = length - 1; index >= 0; index -= 1) {
      if (buffer[index] === 10) return start + index + 1;
    }
    end = start;
  }
  return 0;
}

function truncateJournal(path: string, size: number): void {
  const descriptor = openSync(path, "r+");
  try {
    ftruncateSync(descriptor, size);
    fdatasyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicJson(path: string, value: unknown): void {
  const directory = dirname(path);
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let renamed = false;
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
    renamed = true;
    fsyncDirectory(directory);
  } finally {
    if (!renamed) {
      try {
        unlinkSync(temporary);
      } catch {
        // Preserve the original write failure.
      }
    }
  }
}

function fsyncDirectory(directory: string): void {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function removeEmptyOrphanDirectory(path: string): boolean {
  try {
    if (readdirSync(path).length) return false;
    rmdirSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    return false;
  }
}

function removeEmptyCreatingDirectory(path: string): void {
  try {
    for (const name of ["manifest.json", "events.ndjson"]) {
      try {
        unlinkSync(join(path, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
      }
    }
    rmdirSync(path);
  } catch {
    // A failed create never removes anything outside its unique staging dir.
  }
}

function removeOrphanCreatingDirectory(path: string): boolean {
  try {
    const entries = readdirSync(path, { withFileTypes: true });
    if (entries.some((entry) => !entry.isFile()
      || (entry.name !== "manifest.json"
        && entry.name !== "events.ndjson"
        && !creatingTemporaryManifestPattern.test(entry.name)))) {
      return false;
    }
    for (const entry of entries) unlinkSync(join(path, entry.name));
    rmdirSync(path);
    return true;
  } catch {
    // Only exact private staging directories with their expected files are
    // eligible. Any ambiguity is left untouched for manual inspection.
    return false;
  }
}

function visitSummary(visit: SessionHistoryVisit, observedAt: number): SessionHistorySummary {
  const selectionSummary = (selection: SessionHistoryVisit["selections"][number]) => ({
    id: selection.id,
    gameId: selection.gameId,
    label: selection.label,
    selectedAtUnixMillis: selection.selectedAtUnixMillis,
    endedAtUnixMillis: selection.endedAtUnixMillis,
    runCount: selection.runs.length
  });
  const activeSelection = visit.selections.find((selection) => selection.id === visit.activeSelectionId);
  const lastSelection = visit.selections.at(-1);
  const effectiveEnd = visit.endedAtUnixMillis ?? (visit.status === "active" ? observedAt : visit.updatedAtUnixMillis);
  return {
    id: visit.id,
    status: visit.status,
    startedAtUnixMillis: visit.startedAtUnixMillis,
    endedAtUnixMillis: visit.endedAtUnixMillis,
    updatedAtUnixMillis: visit.updatedAtUnixMillis,
    durationMillis: Math.max(0, effectiveEnd - visit.startedAtUnixMillis),
    controllerId: visit.controllerId,
    kioskId: visit.kioskId,
    teamName: visit.teamName,
    playerCount: visit.players.length,
    players: clone(visit.players),
    recordingPolicy: clone(visit.recordingPolicy),
    selectionCount: visit.selections.length,
    runCount: visit.selections.reduce((total, selection) => total + selection.runs.length, 0),
    recordingCount: visit.recordings.length,
    activeSelection: activeSelection ? selectionSummary(activeSelection) : undefined,
    lastSelection: lastSelection ? selectionSummary(lastSelection) : undefined
  };
}

function validateVisit(visit: SessionHistoryVisit): void {
  assertSessionHistorySessionId(visit.id);
  if (visit.schema !== SESSION_HISTORY_SCHEMA
    || visit.contractVersion !== SESSION_HISTORY_CONTRACT_VERSION
    || !Number.isSafeInteger(visit.lastSequence)
    || visit.lastSequence < 0
    || visit.lastSequence > maximumSequence) {
    throw new SessionHistoryValidationError("session manifest is invalid");
  }
}

function validateRecording(visit: SessionHistoryVisit, recording: RecordingAsset): void {
  assertSafeId(recording.id, "recording id");
  if (recording.captureId) assertSafeId(recording.captureId, "recording captureId");
  if (recording.scope !== "visit" && recording.scope !== "selection" && recording.scope !== "run") {
    throw new SessionHistoryValidationError("recording scope is invalid");
  }
  if (!Array.isArray(recording.linkedRunIds)
    || recording.linkedRunIds.some((id) => typeof id !== "string" || !id)) {
    throw new SessionHistoryValidationError("recording linked runs are invalid");
  }
  const selection = recording.selectionId
    ? visit.selections.find((candidate) => candidate.id === recording.selectionId)
    : undefined;
  if (recording.selectionId && !selection) {
    throw new SessionHistoryValidationError("recording selection does not belong to session");
  }
  const knownRuns = visit.selections.flatMap((candidate) => candidate.runs);
  const runSelection = recording.runId
    ? visit.selections.find((candidate) => candidate.runs.some((run) => run.id === recording.runId))
    : undefined;
  if (recording.runId && !runSelection) {
    throw new SessionHistoryValidationError("recording run does not belong to session");
  }
  if (recording.scope === "selection" && !recording.selectionId) {
    throw new SessionHistoryValidationError("selection recording requires selectionId");
  }
  if (recording.scope === "run" && (!recording.selectionId || !recording.runId)) {
    throw new SessionHistoryValidationError("run recording requires selectionId and runId");
  }
  if (recording.selectionId && runSelection && runSelection.id !== recording.selectionId) {
    throw new SessionHistoryValidationError("recording run does not belong to its selection");
  }
  if (recording.linkedRunIds.some((id) => !knownRuns.some((run) => run.id === id))) {
    throw new SessionHistoryValidationError("linked run does not belong to session");
  }
  if ((recording.scope === "selection" || recording.scope === "run") && selection) {
    const selectionRunIds = new Set(selection.runs.map((run) => run.id));
    if (recording.linkedRunIds.some((id) => !selectionRunIds.has(id))) {
      throw new SessionHistoryValidationError("linked run does not belong to recording selection");
    }
  }
  if (recording.captureId && visit.recordings.some((candidate) => (
    candidate.id !== recording.id && candidate.captureId === recording.captureId
  ))) {
    throw new SessionHistoryValidationError("recording captureId already belongs to another asset");
  }
}

function assertSafeId(value: string, label: string): void {
  if (!safeIdPattern.test(value)) throw new SessionHistoryValidationError(`${label} is invalid`);
}

export function assertSessionHistorySessionId(value: string): void {
  if (!sessionIdPattern.test(value)) throw new SessionHistoryValidationError("session id is invalid");
}

function pageLimit(value: unknown): number {
  const candidate = Number(value ?? defaultPageLimit);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > maximumPageLimit) {
    throw new SessionHistoryValidationError(`limit must be an integer from 1 to ${maximumPageLimit}`);
  }
  return candidate;
}

function encodeVisitCursor(at: number, id: string): string {
  return Buffer.from(JSON.stringify({ at, id }), "utf8").toString("base64url");
}

function decodeVisitCursor(value: string): { at: number; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { at?: unknown; id?: unknown };
    if (!Number.isSafeInteger(decoded.at) || typeof decoded.id !== "string" || !sessionIdPattern.test(decoded.id)) {
      throw new Error("invalid cursor");
    }
    return { at: Number(decoded.at), id: decoded.id };
  } catch {
    throw new SessionHistoryValidationError("invalid session cursor");
  }
}

function encodeSequenceCursor(sequence: number): string {
  return Buffer.from(String(sequence), "utf8").toString("base64url");
}

function captureOwner(sessionId: string, recordingId: string): string {
  return `${sessionId}\u0000${recordingId}`;
}

function decodeSequenceCursor(value: string): number {
  const text = Buffer.from(value, "base64url").toString("utf8");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    throw new SessionHistoryValidationError("invalid event cursor");
  }
  const decoded = Number(text);
  if (!Number.isSafeInteger(decoded) || decoded < 0 || String(decoded) !== text) {
    throw new SessionHistoryValidationError("invalid event cursor");
  }
  return decoded;
}

function eventAfterSequence(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SessionHistoryValidationError("afterSequence must be a non-negative safe integer");
  }
  return value;
}

function firstEventAfter(events: readonly SessionHistoryEvent[], sequence: number): number {
  let lower = 0;
  let upper = events.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if ((events[middle]?.sequence ?? Number.MAX_SAFE_INTEGER) <= sequence) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function jsonObject(value: unknown): Record<string, SessionHistoryJsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, SessionHistoryJsonValue>;
}
