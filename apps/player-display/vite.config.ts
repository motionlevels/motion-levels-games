import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
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
