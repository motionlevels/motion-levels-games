export const SESSION_HISTORY_SCHEMA = "motion-levels-session-history-v1" as const;
export const SESSION_HISTORY_CONTRACT_VERSION = 1 as const;

export const sessionHistorySchema = SESSION_HISTORY_SCHEMA;
export const sessionHistoryContractVersion = SESSION_HISTORY_CONTRACT_VERSION;

export type SessionHistoryJsonPrimitive = boolean | number | string | null;
export type SessionHistoryJsonValue =
  | SessionHistoryJsonPrimitive
  | SessionHistoryJsonValue[]
  | SessionHistoryJsonObject;
export type SessionHistoryJsonObject = { [key: string]: SessionHistoryJsonValue };
export type JsonValue = SessionHistoryJsonValue;
export type JsonObject = SessionHistoryJsonObject;

export type RecordingScope = "visit" | "selection" | "run";

export type RecordingPolicy = {
  scope: "off" | RecordingScope;
  cameraIds?: string[];
  includeAudio?: boolean;
  preRollMillis?: number;
  postRollMillis?: number;
};

export const DEFAULT_RECORDING_POLICY: RecordingPolicy = Object.freeze({ scope: "off" });

export function normalizeRecordingPolicy(value: unknown): RecordingPolicy {
  if (value === true) return { scope: "visit" };
  if (value === false || value === null || value === undefined) {
    return { ...DEFAULT_RECORDING_POLICY };
  }
  if (typeof value === "string") {
    return recordingScope(value) ? { scope: value } : { ...DEFAULT_RECORDING_POLICY };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_RECORDING_POLICY };
  }

  const candidate = value as Record<string, unknown>;
  const scope = recordingScope(candidate.scope) ? candidate.scope : DEFAULT_RECORDING_POLICY.scope;
  const cameraIds = Array.isArray(candidate.cameraIds)
    ? [...new Set(candidate.cameraIds
      .filter((cameraId): cameraId is string => typeof cameraId === "string")
      .map((cameraId) => cameraId.trim())
      .filter(Boolean))]
    : undefined;
  const includeAudio = typeof candidate.includeAudio === "boolean" ? candidate.includeAudio : undefined;
  const preRollMillis = nonNegativeMillis(candidate.preRollMillis);
  const postRollMillis = nonNegativeMillis(candidate.postRollMillis);
  return {
    scope,
    ...(cameraIds?.length ? { cameraIds } : {}),
    ...(includeAudio === undefined ? {} : { includeAudio }),
    ...(preRollMillis === undefined ? {} : { preRollMillis }),
    ...(postRollMillis === undefined ? {} : { postRollMillis })
  };
}

export type RecordingAssetStatus =
  | "requested"
  | "recording"
  | "finalizing"
  | "pending_upload"
  | "uploading"
  | "complete"
  | "partial"
  | "failed"
  | "missing";

export type RecordingAsset = {
  id: string;
  captureId?: string;
  scope: RecordingScope;
  status: RecordingAssetStatus;
  selectionId?: string;
  runId?: string;
  linkedRunIds: string[];
  startedAtUnixMillis?: number;
  endedAtUnixMillis?: number;
  backend?: string;
  cameraId?: string;
  localPath?: string;
  remoteUrl?: string;
  shareUrl?: string;
  downloadUrl?: string;
  fileName?: string;
  contentType?: string;
  byteSize?: number;
  sha256?: string;
  metadata?: SessionHistoryJsonObject;
};

export type RecordingBoundary = {
  type: "start" | "stop";
  scope: RecordingScope;
  sessionId: string;
  selectionId?: string;
  runId?: string;
  occurredAtUnixMillis: number;
  policy: RecordingPolicy;
  recording: RecordingAsset;
};

export type RecordingObservation = {
  active: boolean;
  observedAtUnixMillis: number;
  maxEndsAtUnixMillis?: number;
};

export type RecordingClient = {
  onBoundary(boundary: RecordingBoundary):
    | RecordingAsset
    | null
    | Promise<RecordingAsset | null>;
  observe?(recording: RecordingAsset):
    | RecordingObservation
    | Promise<RecordingObservation>;
};

/** Signals that the recorder explicitly confirmed a start did not happen.
 * Other thrown errors are treated as uncertain because the camera may have
 * started before the response or network connection was lost. */
export class RecordingStartRejectedError extends Error {
  readonly code = "recording_start_rejected";
}

export type SessionHistoryPlayer = {
  id?: string;
  name: string;
  team?: string;
  metadata?: SessionHistoryJsonObject;
};

export type SessionHistoryRun = {
  id: string;
  ordinal: number;
  reason: "initial" | "restart" | "recovered";
  status:
    | "waiting"
    | "starting"
    | "running"
    | "paused"
    | "finished"
    | "abandoned"
    | "interrupted";
  outcome?: string;
  startedAtUnixMillis: number;
  gameplayStartedAtUnixMillis?: number;
  finishedAtUnixMillis?: number;
  endedAtUnixMillis?: number;
  engineElapsedMillis: number;
  gameplayElapsedMillis: number;
  pausedMillis: number;
  phaseDurations: Record<string, number>;
  success?: boolean;
  score?: number;
  lives?: number;
  players?: SessionHistoryPlayer[];
  rounds?: SessionHistoryJsonObject[];
  finalSnapshot?: SessionHistoryJsonObject;
};

export type SessionHistorySelection = {
  id: string;
  ordinal: number;
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
  config: SessionHistoryJsonObject;
  teamName: string;
  players: SessionHistoryPlayer[];
  selectedAtUnixMillis: number;
  endedAtUnixMillis?: number;
  endReason?: string;
  runs: SessionHistoryRun[];
};

export type SessionHistoryVisit = {
  schema: typeof SESSION_HISTORY_SCHEMA;
  contractVersion: typeof SESSION_HISTORY_CONTRACT_VERSION;
  id: string;
  status: "active" | "ended";
  origin?: string;
  startedAtUnixMillis: number;
  endedAtUnixMillis?: number;
  endReason?: string;
  controllerId?: string;
  kioskId?: string;
  teamName: string;
  players: SessionHistoryPlayer[];
  recordingPolicy: RecordingPolicy;
  selections: SessionHistorySelection[];
  recordings: RecordingAsset[];
  activeSelectionId?: string;
  activeRunId?: string;
  lastSequence: number;
  updatedAtUnixMillis: number;
};

export type SessionHistoryEvent = {
  id: string;
  sequence: number;
  sessionId: string;
  selectionId?: string;
  runId?: string;
  kind: string;
  occurredAtUnixMillis: number;
  engineAtMillis?: number;
  cue?: string;
  message?: string;
  payload: SessionHistoryJsonObject;
};

export type SessionHistorySelectionSummary = {
  id: string;
  gameId: string;
  label: string;
  selectedAtUnixMillis: number;
  endedAtUnixMillis?: number;
  runCount: number;
};

export type SessionHistorySummary = {
  id: string;
  status: SessionHistoryVisit["status"];
  startedAtUnixMillis: number;
  endedAtUnixMillis?: number;
  updatedAtUnixMillis: number;
  durationMillis: number;
  controllerId?: string;
  kioskId?: string;
  teamName: string;
  playerCount: number;
  players: SessionHistoryPlayer[];
  recordingPolicy: RecordingPolicy;
  selectionCount: number;
  runCount: number;
  recordingCount: number;
  activeSelection?: SessionHistorySelectionSummary;
  lastSelection?: SessionHistorySelectionSummary;
};

export type SessionListResponse = {
  schema: typeof SESSION_HISTORY_SCHEMA;
  sessions: SessionHistorySummary[];
  nextCursor: string | null;
};

export type SessionResponse = {
  schema: typeof SESSION_HISTORY_SCHEMA;
  session: SessionHistoryVisit;
};

export type RecordingResponse = {
  schema: typeof SESSION_HISTORY_SCHEMA;
  recording: RecordingAsset;
};

export type SessionEventsResponse = {
  schema: typeof SESSION_HISTORY_SCHEMA;
  sessionId: string;
  events: SessionHistoryEvent[];
  nextCursor: string | null;
};

export type SessionHistoryListResponse = SessionListResponse;
export type SessionHistoryResponse = SessionResponse;
export type SessionHistoryEventsResponse = SessionEventsResponse;
export type SessionDetailResponse = SessionResponse;
export type SessionRun = SessionHistoryRun;

function recordingScope(value: unknown): value is RecordingPolicy["scope"] {
  return value === "off" || value === "visit" || value === "selection" || value === "run";
}

function nonNegativeMillis(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
