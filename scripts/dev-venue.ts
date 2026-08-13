import { execFileSync } from "node:child_process";

if (!process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION?.trim()) {
  process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8"
  }).trim();
}

await import("../apps/venue-runtime/src/main.ts");
