import { venueRuntimeBaseURL } from "./api";
import type { GamesDisplayRenderState } from "./displayRuntime";
import type { AudioOutputState } from "./audio";

export type DisplayClientReport = {
  clientId: "player-display";
  currentGame: string;
  expectedRevision: string;
  loadedRevision: string;
  shellRevision: string;
  renderStatus: GamesDisplayRenderState["status"];
  renderAttempt: number;
  connected: boolean;
  feedTransport: "eventsource" | "poll" | "none";
  lastFeedUnixMillis: number;
  lastPaintUnixMillis: number;
  pageLoadedUnixMillis: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  error: string;
  audioOutputState: AudioOutputState;
};

export async function reportDisplayClient(report: DisplayClientReport): Promise<void> {
  const response = await fetch(`${venueRuntimeBaseURL()}/api/display-client`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  });
  if (!response.ok) throw new Error(`display heartbeat failed: ${response.status}`);
}
