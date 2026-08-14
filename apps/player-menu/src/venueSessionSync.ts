export type VenueSessionMenuState = {
  sessionActive: boolean;
  sessionId: string;
  sessionStartedUnix: number;
  teamName: string;
};

export type VenueSessionEngineState = {
  runId: string;
  venueSessionId: string;
  venueSessionStartedUnix?: number;
  teamName: string;
};

export type VenueSessionObservation = {
  runId: string;
  venueSessionId: string;
};

export type VenueSessionSyncDecision = {
  action: "clear" | "hydrate" | "none" | "recover";
  observation: VenueSessionObservation;
};

export function clearedVenueSessionProjection<TPlayer>(defaultPlayers: readonly TPlayer[]) {
  return {
    sessionActive: false as const,
    sessionId: "",
    sessionStartedUnix: 0,
    recordingEnabled: true,
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
    return { action: sessionMatches ? "none" : "hydrate", observation };
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
