export const playerExperienceContractVersion = 1 as const;

export type PlayerExperienceLifecycle =
  | "idle"
  | "launching"
  | "waiting"
  | "starting"
  | "running"
  | "paused"
  | "finished"
  | "stopping"
  | "error";

export type PlayerExperienceControl =
  | "pause"
  | "resume"
  | "restart"
  | "exit"
  | "narration"
  | "stop_narration"
  | "mute"
  | "unmute"
  | "toggle_mute"
  | "recording_retry"
  | "recording_continue_without"
  | "recording_cancel";

export type PlayerExperienceRecordingGateState = "arming" | "timed_out" | "ready";

export type PlayerExperienceRecordingGateReason =
  | "timeout"
  | "unavailable"
  | "start_rejected"
  | "start_unconfirmed";

/**
 * Engine-authoritative barrier for strict per-run recording.
 *
 * `id` is an opaque decision token. A retry rotates it while preserving the
 * run and capture identities, so a delayed action from the previous decision
 * cannot affect the newly armed attempt.
 */
export type PlayerExperienceRecordingGate = {
  id: string;
  state: PlayerExperienceRecordingGateState;
  scope: "run";
  runId: string;
  captureId: string;
  attempt: number;
  startedAtUnixMillis: number;
  timeoutAtUnixMillis: number;
  readyAtUnixMillis?: number;
  reason?: PlayerExperienceRecordingGateReason;
};

export type PlayerExperienceColor = { r: number; g: number; b: number };

export type PlayerExperiencePlayer = {
  index: number;
  label: string;
  color: PlayerExperienceColor;
  score: number;
  lives: number;
};

export type PlayerExperienceRound = {
  index: number;
  winnerIndex: number;
  winnerLabel: string;
  hits: number;
};

export type PlayerExperienceLevelSummary = {
  id: string;
  slug?: string;
  label: string;
  description: string;
  difficulty?: string;
  difficulties?: string[];
  rules?: Record<string, unknown>;
  status?: string;
  settings_hash?: string;
  updated_at?: string;
  catalog_thumbnail_small_url?: string;
  catalog_thumbnail_url?: string;
  catalog_preview_url?: string;
};

export type PlayerExperienceGameSummary = {
  game: string;
  label: string;
  description: string;
  music: string;
  players: boolean;
  minPlayers: number;
  maxPlayers: number;
  difficulty: boolean;
  volume: number;
  levels?: PlayerExperienceLevelSummary[];
};

export type PlayerExperienceFinishedAttempt = {
  attemptId: string;
  game: string;
  level: string;
  levelNumber: number;
  difficulty: string;
  result: string;
  success: boolean;
  elapsedMillis: number;
  endedUnixNanos: number;
};

export type PlayerExperienceOutputTestState = "idle" | "pending" | "playing" | "passed" | "failed";

export type PlayerExperienceOutputTest = {
  id: string;
  target: "floor" | "audio";
  state: PlayerExperienceOutputTestState;
  sequence: number;
  startedUnixMillis: number;
  finishedUnixMillis?: number;
  error?: string;
};

/**
 * The single live state consumed by the menu and Player Display.
 *
 * A venue adapter may add diagnostic properties, but it must never remove or
 * reinterpret these fields. `revision` is monotonic for one adapter process;
 * consumers reject snapshots older than the newest revision they rendered.
 */
export type PlayerExperienceState = {
  contractVersion: typeof playerExperienceContractVersion;
  revision: number;
  runId: string;
  lifecycle: PlayerExperienceLifecycle;
  allowedControls: PlayerExperienceControl[];
  currentGame: string;
  engineGame?: string;
  sourceKind?: string;
  sourceRevision?: string;
  contentRevision?: string;
  gameSnapshot?: Record<string, unknown>;
  frame?: {
    width: number;
    height: number;
    cells: Array<{ x: number; y: number; color: string }>;
  };
  venueSessionId: string;
  sessionId: string;
  label: string;
  phase: string;
  difficulty: string;
  difficultyConfigurable?: boolean;
  level?: string;
  levelSlug?: string;
  levelMode?: string;
  teamName: string;
  playerCount: number;
  playerConfigurable?: boolean;
  players: PlayerExperiencePlayer[];
  score: number;
  lives: number;
  livesStart?: number;
  music: string;
  musicVolume: number;
  /** Revision-owned one-shot selected for the latest game event. */
  sound?: string;
  soundVolume?: number;
  soundPlaybackRate?: number;
  /** Revision-owned spoken line; sequence changes whenever it should replay. */
  narration?: string;
  narrationVolume?: number;
  narrationSequence?: number;
  narrationDurationMillis?: number;
  narrationRemainingMillis?: number;
  /** Changes whenever every renderer should stop its current spoken line. */
  narrationStopSequence?: number;
  audioEnabled: boolean;
  audioMuted: boolean;
  audioOutputState?: PlayerExperienceAudioOutputState;
  outputTest?: PlayerExperienceOutputTest | null;
  paused: boolean;
  success: boolean;
  startedUnix: number;
  sessionStartedUnix?: number;
  endsUnix: number;
  sessionElapsedMillis?: number;
  sessionRemainingMillis?: number;
  challengeElapsedMillis?: number;
  challengeAttemptCount?: number;
  elapsedMillis: number;
  remainingMillis: number;
  introRemainingMillis: number;
  countdownRemainingMillis: number;
  activeTargets: number;
  matchTarget?: number;
  roundHits?: number;
  lastRoundHits?: number;
  lastRoundWinner?: string;
  rounds?: PlayerExperienceRound[];
  lastEventUnixNanos: number;
  lastEventSequence?: number;
  lastEventCue: string;
  lastEventMessage: string;
  levelNumber?: number;
  attemptCount?: number;
  failureCount?: number;
  bestElapsedMillis?: number;
  sessionBestElapsedMillis?: number;
  lastPressureUnix: number;
  pressureStreamConnected?: boolean;
  finishedLevelAttempts?: PlayerExperienceFinishedAttempt[];
  recordingGate?: PlayerExperienceRecordingGate;
  catalog: PlayerExperienceGameSummary[];
};

export type PlayerExperienceAudioOutputState = "disabled" | "checking" | "ready" | "suspended" | "failed";

const idleGames = new Set(["salvapantallas", "screensaver", "loop"]);

export function lifecycleFromRuntime(
  input: Pick<PlayerExperienceState, "currentGame" | "paused" | "phase" | "recordingGate">
): PlayerExperienceLifecycle {
  if (input.recordingGate?.state === "arming" || input.recordingGate?.state === "timed_out") return "launching";
  if (input.paused) return "paused";
  const phase = input.phase.trim().toLowerCase();
  if (idleGames.has(input.currentGame)) return "idle";
  if (phase === "idle") return "waiting";
  if (phase === "countdown" || phase === "starting" || phase === "ready") return "starting";
  if (phase === "waiting") return "waiting";
  if (phase === "finished" || phase === "complete" || phase === "completed") return "finished";
  if (phase === "launching" || phase === "loading") return "launching";
  if (phase === "stopping") return "stopping";
  if (phase === "error" || phase === "failed") return "error";
  return "running";
}

export function controlsForState(
  input: Pick<PlayerExperienceState, "audioEnabled" | "audioMuted" | "lifecycle" | "narrationRemainingMillis" | "recordingGate">
): PlayerExperienceControl[] {
  if (input.recordingGate?.state === "arming") return [];
  if (input.recordingGate?.state === "timed_out") {
    return ["recording_retry", "recording_continue_without", "recording_cancel"];
  }
  if (input.lifecycle === "idle" || input.lifecycle === "launching" || input.lifecycle === "stopping" || input.lifecycle === "error") return [];
  const controls: PlayerExperienceControl[] = input.lifecycle === "paused"
    ? ["resume", "restart", "exit"]
    : ["pause", "restart", "exit"];
  controls.push("narration");
  if (Number(input.narrationRemainingMillis) > 0) controls.push("stop_narration");
  if (input.audioEnabled) controls.push(input.audioMuted ? "unmute" : "mute", "toggle_mute");
  return controls;
}

export function acceptsPlayerExperienceState(current: PlayerExperienceState | null, incoming: PlayerExperienceState): boolean {
  if (incoming.contractVersion !== playerExperienceContractVersion) return false;
  if (!Number.isSafeInteger(incoming.revision) || incoming.revision < 1) return false;
  return current === null || incoming.runId !== current.runId || incoming.revision > current.revision;
}

/** Keeps a restarted runtime's fresh revision stream from being rolled back by
 * a late poll/SSE response that belonged to the retired process. */
export class PlayerExperienceStateGate {
  private readonly retiredRunIds = new Set<string>();
  private readonly retiredRunOrder: string[] = [];

  accepts(current: PlayerExperienceState | null, incoming: PlayerExperienceState): boolean {
    if (!acceptsPlayerExperienceState(current, incoming)) return false;
    if (!current || current.runId === incoming.runId) return true;
    if (this.retiredRunIds.has(incoming.runId)) return false;
    if (current.runId) {
      this.retiredRunIds.add(current.runId);
      this.retiredRunOrder.push(current.runId);
      if (this.retiredRunOrder.length > 16) {
        const expired = this.retiredRunOrder.shift();
        if (expired) this.retiredRunIds.delete(expired);
      }
    }
    return true;
  }
}

export type PlayerExperienceView = {
  screen: "browse" | "game";
  active: boolean;
  game: string;
  level: string;
  lifecycle: PlayerExperienceLifecycle;
  pending: boolean;
};

export function playerExperienceView(state: PlayerExperienceState | null): PlayerExperienceView {
  if (!state || state.lifecycle === "idle") {
    return { screen: "browse", active: false, game: "", level: "", lifecycle: "idle", pending: false };
  }
  if (state.phase.trim().toLowerCase() === "ambient") {
    return {
      screen: "browse",
      active: false,
      game: state.currentGame,
      level: state.level ?? "",
      lifecycle: state.lifecycle,
      pending: false,
    };
  }
  return {
    screen: "game",
    active: !["finished", "error"].includes(state.lifecycle),
    game: state.currentGame,
    level: state.level ?? "",
    lifecycle: state.lifecycle,
    pending: state.lifecycle === "launching" || state.lifecycle === "stopping",
  };
}

export function newPlayerExperienceCommandId(cryptoSource?: { randomUUID?(): string }): string {
  const customUUID = cryptoSource && typeof cryptoSource.randomUUID === "function" ? cryptoSource.randomUUID() : undefined;
  if (customUUID && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customUUID)) {
    return customUUID;
  }
  const globalUUID = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : undefined;
  if (globalUUID && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(globalUUID)) {
    return globalUUID;
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
