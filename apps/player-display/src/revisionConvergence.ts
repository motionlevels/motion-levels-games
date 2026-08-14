import type { PlayerExperienceLifecycle } from "@motion-levels-games/player-experience";
import type { GamesDisplayRenderState } from "./displayRuntime";

const sourceRevisionPattern = /^[0-9a-f]{40}$/u;
const reloadQueryParameter = "ml-display-revision";
const reloadStorageKey = "motion-levels:player-display-reload-v1";
const safeReloadLifecycles = new Set<PlayerExperienceLifecycle>([
  "idle",
  "waiting",
  "finished",
  "error",
]);

export type RevisionConvergenceDecision = "current" | "defer" | "reload";

export function revisionConvergenceDecision(input: {
  shellRevision: string;
  sourceRevision: string;
  lifecycle: PlayerExperienceLifecycle;
  renderStatus: GamesDisplayRenderState["status"];
}): RevisionConvergenceDecision {
  if (!sourceRevisionPattern.test(input.shellRevision) || !sourceRevisionPattern.test(input.sourceRevision)) {
    return "current";
  }
  if (input.shellRevision === input.sourceRevision) return "current";
  if (input.renderStatus === "fallback" || input.renderStatus === "error") return "reload";
  return safeReloadLifecycles.has(input.lifecycle) && input.renderStatus === "ready" ? "reload" : "defer";
}

export function playerDisplayReloadURL(currentURL: string, sourceRevision: string): string {
  const url = new URL(currentURL);
  url.searchParams.set(reloadQueryParameter, sourceRevision);
  return url.toString();
}

export function claimPlayerDisplayReload(input: {
  currentURL: string;
  shellRevision: string;
  sourceRevision: string;
  storage?: Pick<Storage, "getItem" | "setItem">;
}): boolean {
  if (!sourceRevisionPattern.test(input.sourceRevision) || input.shellRevision === input.sourceRevision) return false;
  const url = new URL(input.currentURL);
  if (url.searchParams.get(reloadQueryParameter) === input.sourceRevision) return false;
  const claim = `${input.shellRevision}->${input.sourceRevision}`;
  try {
    if (input.storage?.getItem(reloadStorageKey) === claim) return false;
    input.storage?.setItem(reloadStorageKey, claim);
  } catch {
    // The revision query parameter remains a reload-loop guard when storage is unavailable.
  }
  return true;
}
