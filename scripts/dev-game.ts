import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const gameId = process.argv[2]?.trim();
if (!gameId) {
  console.error("Usage: npm run dev:game <game-id> (e.g. npm run dev:game arkanoid)");
  process.exit(1);
}

const gameDir = path.join(process.cwd(), "games", gameId);
if (!existsSync(gameDir)) {
  console.error(`Error: Game "${gameId}" not found under games/`);
  process.exit(1);
}

console.log(`Starting playground focused on game: ${gameId}`);
console.log(`Open: http://127.0.0.1:4104/?game=${gameId}\n`);

const child = spawn(
  "npx",
  ["vite", "--host", "127.0.0.1", "--port", "4104", "--strictPort"],
  {
    stdio: "inherit",
    cwd: path.join(process.cwd(), "apps/playground"),
    env: { ...process.env, MOTION_LEVELS_GAMES_DEFAULT_GAME: gameId }
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
