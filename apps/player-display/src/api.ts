import type {
  PlayerExperiencePlayer,
  PlayerExperienceState,
} from "@motion-levels-games/player-experience";

export type DisplayStatus = PlayerExperienceState;
export type DisplayPlayer = PlayerExperiencePlayer;
export type { PlayerExperienceState };

const venueRuntimePort = "4102";
const localVenueRuntimeURL = `http://127.0.0.1:${venueRuntimePort}`;
const displayStatusTimeoutMillis = 2_000;

function inferVenueRuntimeURL(): string {
  if (typeof window === "undefined" || !window.location.hostname || window.location.protocol === "file:") {
    return localVenueRuntimeURL;
  }
  const gatewayMatch = window.location.pathname.match(/^\/gateways\/[^/]+\/display(?:\/|$)/);
  if (gatewayMatch) {
    return `${window.location.origin}${gatewayMatch[0].replace(/\/display\/?$/, "/engine")}`;
  }
  if (window.location.pathname.startsWith("/display")) {
    return `${window.location.origin}/engine`;
  }
  return `${window.location.protocol}//${window.location.hostname}:${venueRuntimePort}`;
}

export function venueRuntimeBaseURL(): string {
  return import.meta.env?.VITE_VENUE_RUNTIME_URL
    || import.meta.env?.VITE_GAME_ENGINE_URL
    || inferVenueRuntimeURL();
}

export async function fetchDisplayStatus(timeoutMillis = displayStatusTimeoutMillis): Promise<DisplayStatus> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(1, timeoutMillis));
  try {
    const response = await fetch(`${venueRuntimeBaseURL()}/api/display`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<DisplayStatus>;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function displayEventSource(): EventSource {
  return new EventSource(`${venueRuntimeBaseURL()}/api/display/events`);
}
