import { execFileSync } from "node:child_process";

type CoverageTarget = {
  name: string;
  files: string;
  include: string;
  lines: number;
  functions: number;
  branches: number;
};

const targets: CoverageTarget[] = [
  {
    name: "game-sdk",
    files: "packages/game-sdk/test/*.test.ts",
    include: "packages/game-sdk/src/**",
    lines: 90,
    functions: 90,
    branches: 80
  },
  {
    name: "display-kit",
    files: "packages/display-kit/test/*.test.ts",
    include: "packages/display-kit/src/**",
    lines: 75,
    functions: 60,
    branches: 70
  },
  {
    name: "games",
    files: "games/*/test/*.test.ts",
    include: "games/*/src/**",
    lines: 85,
    functions: 80,
    branches: 80
  },
  {
    name: "runtimes",
    files: "packages/agent-runtime/test/*.test.ts packages/replay-runtime/test/*.test.ts packages/character-runtime/test/*.test.ts packages/agent-analytics/test/*.test.ts",
    include: "packages/agent-runtime/src/**,packages/replay-runtime/src/**,packages/character-runtime/src/**,packages/agent-analytics/src/**",
    lines: 90,
    functions: 80,
    branches: 65
  },
  {
    name: "published-level-runtime",
    files: "packages/published-level-runtime/test/*.test.ts",
    include: "packages/published-level-runtime/src/**",
    lines: 90,
    functions: 90,
    branches: 80
  }
];

const targetFilter = process.argv[2]?.trim();
const selectedTargets = targetFilter
  ? targets.filter((t) => t.name === targetFilter)
  : targets;

if (selectedTargets.length === 0) {
  console.error(`Unknown coverage target: "${targetFilter}". Available targets: ${targets.map((t) => t.name).join(", ")}`);
  process.exit(1);
}

for (const target of selectedTargets) {
  console.log(`\n--- Running coverage for ${target.name} ---`);
  const includes = target.include.split(",").map((inc) => `--test-coverage-include=${inc}`);
  const args = [
    "--test",
    "--experimental-test-coverage",
    ...includes,
    `--test-coverage-lines=${target.lines}`,
    `--test-coverage-functions=${target.functions}`,
    `--test-coverage-branches=${target.branches}`,
    ...target.files.split(" ")
  ];

  execFileSync("npx", ["tsx", ...args], {
    stdio: "inherit",
    cwd: process.cwd()
  });
}

console.log("\nAll coverage thresholds passed successfully.");
