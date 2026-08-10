import type { GameReplay, GhostTrack } from "@motion-levels-games/replay-runtime";
import type { CruceHarnessOptions } from "./agents.ts";
import { runCruceHeadless } from "./headless.ts";

export const CURATED_CRUCE_DEMONSTRATION_OPTIONS: CruceHarnessOptions = Object.freeze({
  seed: 424_242,
  profile: "expert",
  agentCount: 3,
  speed: 3,
  difficulty: "medium",
  durationMillis: 75_000,
  replaySnapshotIntervalTicks: 25
});

/** Authored lightweight ghost for previews that do not need the full replay. */
export const CURATED_CRUCE_GHOST: GhostTrack = Object.freeze({
  agentId: "curated-pilot",
  samples: [
    ghostSample(0, 6, 30, Math.PI, "none", "wait"),
    ghostSample(110, 6, 24, Math.PI, "none", "checkpoint-1"),
    ghostSample(135, 5, 17, Math.PI, "dodge", "checkpoint-2"),
    ghostSample(160, 7, 10, Math.PI, "none", "checkpoint-3"),
    ghostSample(185, 6, 3, Math.PI, "none", "portal"),
    ghostSample(210, 6, 2, Math.PI, "celebrate-large", "complete")
  ]
});

/** Updated only when an intentional authoritative simulation change is accepted. */
export const CURATED_CRUCE_GOLDEN_CHECKSUM = "cf4b3030";

export function createCuratedCruceDemonstrationReplay(): GameReplay {
  return runCruceHeadless({
    ...CURATED_CRUCE_DEMONSTRATION_OPTIONS,
    maxTicks: 1_500
  }).replay;
}

function ghostSample(
  tick: number,
  x: number,
  y: number,
  facingRadians: number,
  action: string,
  intention: string
) {
  return Object.freeze({
    id: "curated-pilot",
    tick,
    position: Object.freeze({ x, y }),
    facingRadians,
    action,
    state: Object.freeze({ intention })
  });
}
