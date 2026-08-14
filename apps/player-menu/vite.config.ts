import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

const menuBuildRevision = process.env.MOTION_LEVELS_BUILD_REVISION || gitValue("git rev-parse --short HEAD") || "dev";
const menuBuildDate = process.env.MOTION_LEVELS_BUILD_DATE || gitValue("git show -s --format=%cI HEAD") || "dev";
const gamesSourceRevision = process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION || gitValue("git rev-parse HEAD");
if (!/^[0-9a-f]{40}$/u.test(gamesSourceRevision)) throw new Error("player-menu requires a full games source revision");
const buildManifest = {
  schema: "motion-levels-player-menu-build-v1",
  menuBuildRevision,
  menuBuildDate,
  gamesSourceRevision
};

export default defineConfig({
  base: "./",
  define: {
    __MENU_BUILD_REVISION__: JSON.stringify(menuBuildRevision),
    __MENU_BUILD_DATE__: JSON.stringify(menuBuildDate),
    MOTION_LEVELS_GAMES_SOURCE_REVISION: JSON.stringify(gamesSourceRevision),
  },
  plugins: [
    react(),
    {
      name: "motion-levels-player-menu-build-manifest",
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
    port: 4103,
    strictPort: true,
    proxy: {
      "/api/game-catalog": "http://localhost:3000",
    },
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
