export type VenueSessionMenuState = {
  sessionActive: boolean;
  sessionId: string;
  sessionStartedUnix: number;
  teamName: string;
  recordingPolicy?: "off" | "visit" | "selection" | "run";
};

export type VenueSessionRecordingScope = "off" | "visit" | "selection" | "run";

export type VenueSessionEngineState = {
  runId: string;
  venueSessionId: string;
  venueSessionStartedUnix?: number;
  teamName: string;
  venueSessionRecordingConfigured?: boolean;
  venueSessionRecordingAvailable?: boolean;
  venueSessionRecordingEnabled?: boolean;
  venueSessionRecordingPolicy?: { scope: VenueSessionRecordingScope };
};

export type VenueSessionObservation = {
  runId: string;
  venueSessionId: string;
};

export type VenueSessionSyncDecision = {
  action: "clear" | "hydrate" | "none" | "recover";
  observation: VenueSessionObservation;
};

export type VenueSessionRecordingCommitResult<TStatus extends VenueSessionRecordingState> =
  | { ok: true; scope: VenueSessionRecordingScope; status: TStatus | null }
  | { error: string; ok: false; scope: VenueSessionRecordingScope; status: null };

type VenueSessionRecordingState = Pick<
  VenueSessionEngineState,
  "venueSessionRecordingConfigured" | "venueSessionRecordingAvailable" | "venueSessionRecordingEnabled" | "venueSessionRecordingPolicy"
>;

export function venueSessionRecordingCanRequest(engine: VenueSessionRecordingState): boolean {
  if (engine.venueSessionRecordingConfigured !== undefined) return engine.venueSessionRecordingConfigured;
  return engine.venueSessionRecordingAvailable !== false;
}

export function clearedVenueSessionProjection<TPlayer>(defaultPlayers: readonly TPlayer[]) {
  return {
    sessionActive: false as const,
    sessionId: "",
    sessionStartedUnix: 0,
    recordingEnabled: true,
    recordingPolicy: "visit" as const,
    teamName: "",
    players: [...defaultPlayers],
    levelProgress: {},
    challengeRuns: {},
    freeRuns: {},
    nextPlayerId: 1,
    narrationArmed: {},
    processedAttemptIDs: [] as string[],
  };
}

/**
 * Returns the requested scope reported by the engine. On pre-policy engines,
 * the legacy boolean is still authoritative. On current engines that expose
 * availability, `venueSessionRecordingEnabled` is only the effective health
 * signal, so it must never rewrite the requested policy to `off`.
 */
export function venueSessionRecordingScope(
  engine: VenueSessionRecordingState,
  fallback: VenueSessionRecordingScope = "visit",
): VenueSessionRecordingScope {
  if (engine.venueSessionRecordingPolicy?.scope) return engine.venueSessionRecordingPolicy.scope;
  if (engine.venueSessionRecordingAvailable !== undefined) return fallback;
  if (engine.venueSessionRecordingEnabled === false) return "off";
  if (engine.venueSessionRecordingEnabled === true) return "visit";
  return fallback;
}

export async function commitVenueSessionRecordingScope<TStatus extends VenueSessionRecordingState>(
  previousScope: VenueSessionRecordingScope,
  requestedScope: VenueSessionRecordingScope,
  persist: () => Promise<TStatus | null>,
  describeFailure: (error: unknown) => string,
): Promise<VenueSessionRecordingCommitResult<TStatus>> {
  try {
    const status = await persist();
    return {
      ok: true,
      scope: status ? venueSessionRecordingScope(status, previousScope) : requestedScope,
      status,
    };
  } catch (error) {
    return {
      error: describeFailure(error),
      ok: false,
      scope: previousScope,
      status: null,
    };
  }
}

/**
 * Reconciles the kiosk recovery state with the venue runtime's authoritative
 * session lifecycle. A new runtime process may legitimately start empty while
 * the physical kiosk still has a recoverable visit; only a transition from a
 * known active session to empty in the same runtime is an authoritative close.
 */
export function venueSessionSyncDecision(
  engine: VenueSessionEngineState,
  previous: VenueSessionObservation | null,
  menu: VenueSessionMenuState
): VenueSessionSyncDecision {
  const observation = { runId: engine.runId, venueSessionId: engine.venueSessionId };
  if (engine.venueSessionId) {
    const sessionMatches = menu.sessionActive && menu.sessionId === engine.venueSessionId;
    const engineRecordingScope = engine.venueSessionRecordingPolicy?.scope;
    const recordingPolicyMatches = engineRecordingScope === undefined || menu.recordingPolicy === engineRecordingScope;
    return { action: sessionMatches && recordingPolicyMatches ? "none" : "hydrate", observation };
  }

  const sameRuntimeClosed = previous?.runId === engine.runId && Boolean(previous.venueSessionId);
  if (sameRuntimeClosed && menu.sessionActive) return { action: "clear", observation };
  if (menu.sessionActive && (!previous || previous.runId !== engine.runId)) {
    return { action: "recover", observation };
  }
  if (menu.sessionActive && previous?.runId === engine.runId) {
    return { action: "clear", observation };
  }
  return { action: "none", observation };
}
