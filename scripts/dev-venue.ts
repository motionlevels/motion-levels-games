import { execFileSync } from "node:child_process";

const noController = process.argv.includes("--no-controller")
  || process.argv.includes("--mock-controller")
  || process.env.MOTION_LEVELS_MOCK_CONTROLLER === "true"
  || process.env.MOTION_LEVELS_NO_CONTROLLER === "true";

if (noController) {
  process.env.MOTION_LEVELS_MOCK_CONTROLLER = "true";
  const { startMockControllerServer } = await import("../apps/venue-runtime/src/mockController.ts");
  const controllerAddr = process.env.MOTION_LEVELS_CONTROLLER_ADDR?.trim() || "127.0.0.1:4201";
  const match = controllerAddr.match(/^(?:([^:]+):)?(\d+)$/u);
  const host = match?.[1] || "127.0.0.1";
  const port = Number(match?.[2]) || 4201;
  startMockControllerServer({ host, port });
}

if (!process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION?.trim()) {
  process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8"
  }).trim();
}

if (!process.env.MOTION_LEVELS_SESSION_HISTORY_DIR?.trim()) {
  process.env.MOTION_LEVELS_SESSION_HISTORY_DIR = `${process.cwd()}/.runtime/session-history`;
}

await import("../apps/venue-runtime/src/main.ts");

