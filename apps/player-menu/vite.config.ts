import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

const menuBuildRevision = process.env.MOTION_LEVELS_BUILD_REVISION || gitValue("git rev-parse --short HEAD") || "dev";
const menuBuildDate = process.env.MOTION_LEVELS_BUILD_DATE || gitValue("git show -s --format=%cI HEAD") || "dev";

export default defineConfig({
  base: "./",
  define: {
    __MENU_BUILD_REVISION__: JSON.stringify(menuBuildRevision),
    __MENU_BUILD_DATE__: JSON.stringify(menuBuildDate),
  },
  plugins: [react()],
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
