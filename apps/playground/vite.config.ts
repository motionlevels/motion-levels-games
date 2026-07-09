import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const playgroundRoot = path.dirname(fileURLToPath(import.meta.url));
const gamesRoot = path.resolve(playgroundRoot, "../../games");
const gameRegistryPath = path.resolve(playgroundRoot, "src/gameRegistry.ts");
const webpEncoderWasmPath = path.resolve(playgroundRoot, "../../node_modules/webp-encoder/lib/assets/a.out.wasm");

export default defineConfig({
  plugins: [motionLevelsGamesWatcher(), webpEncoderWasm(), react()],
  server: {
    fs: {
      allow: [
        playgroundRoot,
        path.resolve(playgroundRoot, "../..")
      ]
    }
  }
});

function motionLevelsGamesWatcher(): PluginOption {
  return {
    name: "motion-levels-games-watcher",
    configureServer(server: ViteDevServer) {
      server.watcher.add(path.join(gamesRoot, "**/*"));
      let previousSnapshot = snapshotGamesTree();

      const refreshGames = (filePath: string) => {
        if (!path.resolve(filePath).startsWith(gamesRoot)) {
          return;
        }

        previousSnapshot = snapshotGamesTree();
        const registryModules = server.moduleGraph.getModulesByFile(gameRegistryPath);
        registryModules?.forEach((module) => server.moduleGraph.invalidateModule(module));
        server.ws.send({ type: "full-reload", path: "*" });
      };

      server.watcher.on("add", refreshGames);
      server.watcher.on("change", refreshGames);
      server.watcher.on("unlink", refreshGames);

      const interval = setInterval(() => {
        const nextSnapshot = snapshotGamesTree();
        if (nextSnapshot === previousSnapshot) {
          return;
        }

        previousSnapshot = nextSnapshot;
        refreshGames(gamesRoot);
      }, 1000);

      server.httpServer?.once("close", () => clearInterval(interval));
    }
  };
}

function webpEncoderWasm(): PluginOption {
  return {
    name: "motion-levels-webp-encoder-wasm",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/a.out.wasm", (_request, response, next) => {
        if (!existsSync(webpEncoderWasmPath)) {
          next();
          return;
        }

        response.setHeader("Content-Type", "application/wasm");
        response.end(readFileSync(webpEncoderWasmPath));
      });
    },
    writeBundle(options) {
      if (!options.dir || !existsSync(webpEncoderWasmPath)) {
        return;
      }

      mkdirSync(options.dir, { recursive: true });
      copyFileSync(webpEncoderWasmPath, path.join(options.dir, "a.out.wasm"));
    }
  };
}

function snapshotGamesTree(): string {
  if (!existsSync(gamesRoot)) {
    return "";
  }

  return listGameFiles(gamesRoot)
    .map((filePath) => {
      const stats = statSync(filePath);
      return `${path.relative(gamesRoot, filePath)}:${stats.mtimeMs}`;
    })
    .sort()
    .join("\n");
}

function listGameFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return listGameFiles(entryPath);
    }
    if (entry.isFile()) {
      return [entryPath];
    }
    return [];
  });
}
