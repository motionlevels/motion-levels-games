import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const gameId = process.argv[2]?.trim();
if (!gameId) {
  console.error("Usage: npm run test:game <game-id> (e.g. npm run test:game arkanoid)");
  process.exit(1);
}

const gameDir = path.join(process.cwd(), "games", gameId);
if (!existsSync(gameDir)) {
  console.error(`Error: Game "${gameId}" not found under games/`);
  process.exit(1);
}

const testDir = path.join(gameDir, "test");
if (!existsSync(testDir)) {
  console.error(`Error: Game "${gameId}" has no test/ directory`);
  process.exit(1);
}

console.log(`Running tests for game "${gameId}"...`);
try {
  execFileSync("npx", ["tsx", "--test", `games/${gameId}/test/*.test.ts`], {
    stdio: "inherit",
    cwd: process.cwd()
  });
} catch {
  process.exit(1);
}
