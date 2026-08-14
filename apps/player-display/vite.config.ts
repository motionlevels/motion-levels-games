import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

const displayBuildRevision = process.env.MOTION_LEVELS_BUILD_REVISION || gitValue("git rev-parse HEAD");
const displayBuildDate = process.env.MOTION_LEVELS_BUILD_DATE || gitValue("git show -s --format=%cI HEAD") || "dev";
const gamesSourceRevision = process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION || gitValue("git rev-parse HEAD");
if (!/^[0-9a-f]{40}$/u.test(displayBuildRevision)) throw new Error("player-display requires a full build revision");
if (!/^[0-9a-f]{40}$/u.test(gamesSourceRevision)) throw new Error("player-display requires a full games source revision");
const buildManifest = {
  schema: "motion-levels-player-display-build-v1",
  displayBuildRevision,
  displayBuildDate,
  gamesSourceRevision
};

export default defineConfig({
  base: "./",
  define: {
    MOTION_LEVELS_PLAYER_DISPLAY_REVISION: JSON.stringify(displayBuildRevision),
  },
  plugins: [
    react(),
    {
      name: "motion-levels-player-display-build-manifest",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "build.json",
          source: `${JSON.stringify(buildManifest, null, 2)}\n`
        });
      }
    }
  ],
  server: {
    host: "0.0.0.0",
    port: 4104,
    strictPort: true,
    // Workspace packages are the only source outside this app root.
    fs: {
      allow: ["../.."],
    },
  },
});

function gitValue(command: string) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
