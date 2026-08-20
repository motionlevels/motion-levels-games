import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const noController = process.argv.includes("--no-controller")
  || process.argv.includes("--mock-controller")
  || process.env.MOTION_LEVELS_MOCK_CONTROLLER === "true"
  || process.env.MOTION_LEVELS_NO_CONTROLLER === "true";
const apiOnly = process.argv.includes("--api-only")
  || process.env.MOTION_LEVELS_DEV_API_ONLY === "true";

let mockController: { close: () => Promise<void> } | undefined;
let playground: ChildProcess | undefined;
let shuttingDown = false;

if (noController) {
  process.env.MOTION_LEVELS_MOCK_CONTROLLER = "true";
  const { startMockControllerServer } = await import("../apps/venue-runtime/src/mockController.ts");
  const controllerAddr = process.env.MOTION_LEVELS_CONTROLLER_ADDR?.trim() || "127.0.0.1:4201";
  const match = controllerAddr.match(/^(?:([^:]+):)?(\d+)$/u);
  const host = match?.[1] || "127.0.0.1";
  const port = Number(match?.[2]) || 4201;
  mockController = startMockControllerServer({ host, port });
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

if (apiOnly) {
  console.log("[dev-venue] API-only mode; use npm run dev for the browser playground");
} else {
  const playgroundHost = process.env.MOTION_LEVELS_PLAYGROUND_HOST?.trim() || "127.0.0.1";
  const playgroundPort = process.env.MOTION_LEVELS_PLAYGROUND_PORT?.trim() || "4104";
  const viteEntry = path.resolve(process.cwd(), "node_modules/vite/bin/vite.js");
  playground = spawn(
    process.execPath,
    [viteEntry, "--host", playgroundHost, "--port", playgroundPort, "--strictPort"],
    {
      cwd: path.join(process.cwd(), "apps/playground"),
      env: process.env,
      stdio: "inherit"
    }
  );
  playground.once("exit", (code, signal) => {
    if (shuttingDown) return;
    process.exitCode = code ?? (signal ? 1 : 0);
    void requestShutdown("SIGTERM");
  });
  console.log(`[dev-venue] Playground available at http://${playgroundHost}:${playgroundPort}/`);
  console.log("[dev-venue] Venue API remains available at MOTION_LEVELS_ENGINE_HTTP (default http://127.0.0.1:4102)");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void requestShutdown(signal));
}

async function requestShutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  playground?.kill(signal);
  await mockController?.close().catch(() => undefined);
}
