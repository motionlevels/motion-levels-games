import type { GameReplay, GhostTrack } from "@motion-levels-games/replay-runtime";
import type { DueloReplayRecordOptions } from "./replay.ts";
import { recordDueloAgentReplay } from "./replay.ts";

export const CURATED_DUELO_DEMONSTRATION_ID = "duelo-synthetic-rival-aware-v1";

export const CURATED_DUELO_DEMONSTRATION_METADATA = Object.freeze({
  id: CURATED_DUELO_DEMONSTRATION_ID,
  source: "synthetic-agent" as const,
  containsHumanData: false,
  description: "Seeded four-player Duelo reference showing ownership-aware routes"
});

export const CURATED_DUELO_DEMONSTRATION_OPTIONS: DueloReplayRecordOptions = Object.freeze({
  seed: 137,
  playerCount: 4,
  difficulty: "medium",
  profile: "duelo-reference",
  movementTilesPerSecond: 20,
  maxTicks: 2_500,
  snapshotIntervalTicks: 100
});

/** Full deterministic tooling replay generated exclusively from synthetic agents. */
export function createCuratedDueloDemonstrationReplay(): GameReplay {
  return recordDueloAgentReplay(CURATED_DUELO_DEMONSTRATION_OPTIONS);
}

/** Updated only when an intentional replay, brain, or authoritative game change is accepted. */
export const CURATED_DUELO_GOLDEN_REPLAY_CHECKSUM = "490af50f";
export const CURATED_DUELO_FINAL_AUTHORITATIVE_CHECKSUM = "56f64b64";

/**
 * Authored sparse, non-authoritative preview track. A renderer may interpolate
 * these logical samples, but must never feed them back into GameEngine.
 */
export const CURATED_DUELO_GHOST: GhostTrack = Object.freeze({
  agentId: "duelo-player-4",
  samples: [
    ghostSample(0, 13, 1, 0, "waiting", "wait for Duelo", 0),
    ghostSample(150, 13, 1, 0, "planning", "claim duelo-target:3:14,2", 0),
    ghostSample(300, 7, 24, -Math.PI / 2, "moving", "claim duelo-target:3:7,25", 19),
    ghostSample(450, 7, 17, -Math.PI / 2, "planning", "claim duelo-target:3:7,16", 32),
    ghostSample(600, 1, 13, 0, "moving", "claim duelo-target:3:0,13", 47),
    ghostSample(750, 13, 2, Math.PI / 2, "moving", "claim duelo-target:3:15,3", 56),
    ghostSample(900, 5, 22, -Math.PI / 2, "moving", "claim duelo-target:3:1,22", 67),
    ghostSample(1_079, 11, 0, Math.PI / 2, "complete", "won Duelo", 76)
  ]
});

function ghostSample(
  tick: number,
  x: number,
  y: number,
  facingRadians: number,
  action: string,
  intention: string,
  score: number
) {
  return Object.freeze({
    id: "duelo-player-4",
    tick,
    position: Object.freeze({ x, y }),
    facingRadians,
    action,
    score,
    state: Object.freeze({ intention })
  });
}
