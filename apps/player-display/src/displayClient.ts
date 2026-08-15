import { venueRuntimeBaseURL } from "./api";
import type { GamesDisplayRenderState } from "./displayRuntime";
import type { AudioOutputState } from "./audio";
import type { PlayerExperienceOutputTestState } from "@motion-levels-games/player-experience";

const displayHeartbeatTimeoutMillis = 3_000;

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
  outputTestId: string;
  outputTestSequence: number;
  outputTestState: PlayerExperienceOutputTestState;
};

export async function reportDisplayClient(report: DisplayClientReport, timeoutMillis = displayHeartbeatTimeoutMillis): Promise<void> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(1, timeoutMillis));
  try {
    const response = await fetch(`${venueRuntimeBaseURL()}/api/display-client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`display heartbeat failed: ${response.status}`);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
