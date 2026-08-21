import type { Frame, GameSnapshot } from "@motion-levels-games/game-sdk";
import { newPlayerExperienceCommandId, type PlayerExperienceState } from "@motion-levels-games/player-experience";

/** The integrated playground is a client of VenueRuntime, not another game host. */
export type VenueRuntimeDisplay = PlayerExperienceState & {
  sourceKind?: string;
  gameSnapshot?: GameSnapshot;
  frame?: Frame;
};

export type VenueRuntimeFloorChange = Readonly<{
  x: number;
  y: number;
  pressed: boolean;
}>;

export type VenueRuntimeControl = "pause" | "resume" | "restart" | "exit";

const requestTimeoutMillis = 3_000;

export async function fetchVenueRuntimeDisplay(): Promise<VenueRuntimeDisplay> {
  return requestJSON<VenueRuntimeDisplay>("/api/display");
}

export function venueRuntimeDisplayEventSource(): EventSource {
  return new EventSource(runtimeURL("/api/display/events"));
}

export async function controlVenueRuntime(action: VenueRuntimeControl): Promise<PlayerExperienceState> {
  return requestJSON<PlayerExperienceState>("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, commandId: newPlayerExperienceCommandId(globalThis.crypto) }),
  });
}

export async function sendVenueRuntimeFloorInput(input: {
  clientId: string;
  clientSequence: number;
  changes?: readonly VenueRuntimeFloorChange[];
  releaseAll?: boolean;
}): Promise<PlayerExperienceState> {
  return requestJSON<PlayerExperienceState>("/api/floor-input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commandId: newPlayerExperienceCommandId(globalThis.crypto),
      clientId: input.clientId,
      clientSequence: input.clientSequence,
      changes: input.changes ?? [],
      ...(input.releaseAll ? { releaseAll: true } : {}),
    }),
  });
}

async function requestJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), requestTimeoutMillis);
  try {
    const response = await fetch(runtimeURL(path), { cache: "no-store", ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`venue runtime returned HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function runtimeURL(path: string): string {
  const configured = import.meta.env.VITE_VENUE_RUNTIME_URL?.trim() || import.meta.env.VITE_GAME_ENGINE_URL?.trim();
  if (configured) return `${configured.replace(/\/+$/u, "")}${path}`;
  if (import.meta.env.DEV) return path;

  const location = typeof window === "undefined" ? undefined : window.location;
  if (!location || location.protocol === "file:") return `http://127.0.0.1:4102${path}`;
  if (location.pathname.startsWith("/games/play")
    || location.pathname.startsWith("/player-menu")
    || location.pathname.startsWith("/menu")
    || location.pathname.startsWith("/display")) {
    return `${location.origin}/engine${path}`;
  }
  return `${location.protocol}//${location.hostname}:4102${path}`;
}
