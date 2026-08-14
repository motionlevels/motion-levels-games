import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { resolveGamesBuildIdentity } from "../../scripts/build-version.ts";

const gamesSourceRevision = String(
  process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION
  || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
).trim();
const { buildVersion } = resolveGamesBuildIdentity(gamesSourceRevision);

export default defineConfig({
  base: "./",
  define: {
    __MOTION_LEVELS_GAMES_BUILD_VERSION__: JSON.stringify(buildVersion)
  },
  plugins: [react()],
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
