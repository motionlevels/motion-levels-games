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
  | "mute"
  | "unmute"
  | "toggle_mute";

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
  audioEnabled: boolean;
  audioMuted: boolean;
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
  catalog: PlayerExperienceGameSummary[];
};

const idleGames = new Set(["salvapantallas", "screensaver", "loop"]);

export function lifecycleFromRuntime(input: Pick<PlayerExperienceState, "currentGame" | "paused" | "phase">): PlayerExperienceLifecycle {
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

export function controlsForState(input: Pick<PlayerExperienceState, "audioEnabled" | "audioMuted" | "lifecycle">): PlayerExperienceControl[] {
  if (input.lifecycle === "idle" || input.lifecycle === "launching" || input.lifecycle === "stopping" || input.lifecycle === "error") return [];
  const controls: PlayerExperienceControl[] = input.lifecycle === "paused"
    ? ["resume", "restart", "exit"]
    : ["pause", "restart", "exit"];
  controls.push("narration");
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
  return {
    screen: "game",
    active: !["finished", "error"].includes(state.lifecycle),
    game: state.currentGame,
    level: state.level ?? "",
    lifecycle: state.lifecycle,
    pending: state.lifecycle === "launching" || state.lifecycle === "stopping",
  };
}

export function newPlayerExperienceCommandId(cryptoSource: { randomUUID(): string }): string {
  return cryptoSource.randomUUID();
}
