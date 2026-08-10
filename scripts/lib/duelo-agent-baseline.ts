import type { DueloAgentHarnessOptions } from "../../games/duelo/src/agent-harness.ts";

export type DueloAgentBenchmarkBaseline = Readonly<{
  version: string;
  rationale: string;
  acceleratedSolver: Readonly<{
    rationale: string;
    dimensions: Readonly<{
      seeds: readonly number[];
      difficulties: readonly NonNullable<DueloAgentHarnessOptions["difficulty"]>[];
      playerCounts: readonly number[];
      movementTilesPerSecond: number;
      maxTicks: number;
    }>;
    checksums: Readonly<Record<string, string>>;
  }>;
  productSpeedParity: Readonly<{
    rationale: string;
    dimensions: Readonly<{
      seed: number;
      difficulty: NonNullable<DueloAgentHarnessOptions["difficulty"]>;
      playerCounts: readonly number[];
      movementTilesPerSecond: number;
      maxTicks: number;
    }>;
    checksums: Readonly<Record<string, string>>;
  }>;
}>;

export function dueloBenchmarkKey(seed: number, difficulty: string, playerCount: number): string {
  return `${seed}:${difficulty}:${playerCount}`;
}

/**
 * Duelo product-reference solver: the broad matrix is intentionally
 * accelerated for CI, while parity mirrors Jugar 3D's 4.8 tiles/second motion.
 */
export const DUELO_AGENT_BENCHMARK_BASELINE = Object.freeze({
  version: "duelo-semantic-harness-2",
  rationale: "Duelo is the Jugar 3D product-reference semantic solver gate; actual product-session acceptance remains in Jugar 3D",
  acceleratedSolver: Object.freeze({
    rationale: "Accelerated 20 tiles/second solver coverage for the full seed, difficulty, and player-count CI matrix",
    dimensions: Object.freeze({
      seeds: Object.freeze([137, 271, 619]),
      difficulties: Object.freeze(["medium", "hard"] as const),
      playerCounts: Object.freeze([2, 3, 4, 5, 6, 7, 8]),
      movementTilesPerSecond: 20,
      maxTicks: 2_500
    }),
    checksums: Object.freeze({
      "137:medium:2": "d9469437",
      "137:medium:3": "eeb807d2",
      "137:medium:4": "68f03255",
      "137:medium:5": "23fc88cf",
      "137:medium:6": "8aec1db2",
      "137:medium:7": "0f898abc",
      "137:medium:8": "3bc4e39d",
      "137:hard:2": "d0d81a7d",
      "137:hard:3": "d1d9c7b2",
      "137:hard:4": "38ee335c",
      "137:hard:5": "1a9a35e5",
      "137:hard:6": "85f5a10c",
      "137:hard:7": "372ea60f",
      "137:hard:8": "04eeebed",
      "271:medium:2": "9aa2d0fb",
      "271:medium:3": "80677676",
      "271:medium:4": "af467f19",
      "271:medium:5": "b23b5dd6",
      "271:medium:6": "d77a363d",
      "271:medium:7": "070b3458",
      "271:medium:8": "9470e58c",
      "271:hard:2": "947a8fb2",
      "271:hard:3": "c4560adc",
      "271:hard:4": "24a5a46f",
      "271:hard:5": "d9b5b70c",
      "271:hard:6": "d54cac0a",
      "271:hard:7": "9609a741",
      "271:hard:8": "92b53463",
      "619:medium:2": "afcf93f0",
      "619:medium:3": "abbdadd6",
      "619:medium:4": "6ca9d410",
      "619:medium:5": "670ddf7d",
      "619:medium:6": "7d054490",
      "619:medium:7": "7cbe951f",
      "619:medium:8": "4b736dea",
      "619:hard:2": "8a29890c",
      "619:hard:3": "916b6fa5",
      "619:hard:4": "440a921a",
      "619:hard:5": "c5bcc56f",
      "619:hard:6": "7d8081e8",
      "619:hard:7": "8ad234c4",
      "619:hard:8": "92487bb5"
    })
  }),
  productSpeedParity: Object.freeze({
    rationale: "Product-reference parity at Jugar 3D BOT_SPEED 4.8; this semantic harness is not the product session",
    dimensions: Object.freeze({
      seed: 137,
      difficulty: "medium",
      playerCounts: Object.freeze([2, 3, 4, 5, 6, 7, 8]),
      movementTilesPerSecond: 4.8,
      maxTicks: 12_000
    }),
    checksums: Object.freeze({
      "137:medium:2": "e953af7d",
      "137:medium:3": "c193d30b",
      "137:medium:4": "60f54a02",
      "137:medium:5": "da0a6b26",
      "137:medium:6": "6a08dc23",
      "137:medium:7": "02ca7f0f",
      "137:medium:8": "17ec79d7"
    })
  })
} satisfies DueloAgentBenchmarkBaseline);
