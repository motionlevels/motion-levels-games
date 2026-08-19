import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { resolveGamesBuildIdentity } from "../../scripts/build-version.ts";

const playgroundRoot = path.dirname(fileURLToPath(import.meta.url));
const gamesRoot = path.resolve(playgroundRoot, "../../games");
const gameRegistryPath = path.resolve(playgroundRoot, "src/gameRegistry.ts");
const playerMenuRoot = path.resolve(playgroundRoot, "../player-menu");
const characterAssetsSubmoduleRoot = path.resolve(playgroundRoot, "../../assets/3d/characters");
const characterAssetsFallbackRoot = path.resolve(playgroundRoot, "../../packages/character-runtime/assets");
const characterAssetsRoot = existsSync(characterAssetsSubmoduleRoot)
  ? characterAssetsSubmoduleRoot
  : characterAssetsFallbackRoot;
const mediaSubmoduleRoot = path.resolve(playgroundRoot, "../../assets/media/games");
const generatedMediaRoot = existsSync(mediaSubmoduleRoot)
  ? mediaSubmoduleRoot
  : path.resolve(playgroundRoot, "../../dist/media");
const webpEncoderWasmPath = path.resolve(playgroundRoot, "../../node_modules/webp-encoder/lib/assets/a.out.wasm");
const menuBuildRevision = process.env.MOTION_LEVELS_BUILD_REVISION || gitValue("git rev-parse --short HEAD") || "dev";
const menuBuildDate = process.env.MOTION_LEVELS_BUILD_DATE || gitValue("git show -s --format=%cI HEAD") || "dev";
const gamesSourceRevision = process.env.MOTION_LEVELS_GAMES_SOURCE_REVISION || gitValue("git rev-parse HEAD");
if (!/^[0-9a-f]{40}$/u.test(gamesSourceRevision)) throw new Error("playground requires a full games source revision");
const { buildVersion } = resolveGamesBuildIdentity(gamesSourceRevision);
const playgroundBase = process.env.VITE_PLAYGROUND_BASE || "/";

export default defineConfig({
  base: playgroundBase,
  publicDir: path.resolve(playerMenuRoot, "public"),
  define: {
    __MENU_BUILD_REVISION__: JSON.stringify(menuBuildRevision),
    __MENU_BUILD_DATE__: JSON.stringify(menuBuildDate),
    __MOTION_LEVELS_GAMES_BUILD_VERSION__: JSON.stringify(buildVersion),
    MOTION_LEVELS_GAMES_SOURCE_REVISION: JSON.stringify(gamesSourceRevision),
  },
  plugins: [motionLevelsGamesWatcher(), generatedMedia(), characterModels(), webpEncoderWasm(), react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4102",
        changeOrigin: true,
      },
      "/engine": {
        target: "http://127.0.0.1:4102",
        changeOrigin: true,
      },
    },
    fs: {
      allow: [
        playgroundRoot,
        path.resolve(playgroundRoot, "../..")
      ]
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(playgroundRoot, "index.html"),
        "player-menu/index": path.resolve(playgroundRoot, "player-menu/index.html"),
      },
    },
  },
});

function generatedMedia(): PluginOption {
  const install = (server: Pick<ViteDevServer, "middlewares">) => {
    server.middlewares.use((request, response, next) => {
      let pathname: string;
      try {
        pathname = decodeURIComponent((request.url ?? "").split("?", 1)[0] ?? "");
      } catch {
        next();
        return;
      }
      const mediaPrefixOffset = pathname.indexOf("/media/");
      if (mediaPrefixOffset < 0) {
        next();
        return;
      }
      const source = path.resolve(generatedMediaRoot, pathname.slice(mediaPrefixOffset + "/media/".length));
      if (!source.startsWith(`${generatedMediaRoot}${path.sep}`) || !existsSync(source) || !statSync(source).isFile()) {
        next();
        return;
      }
      response.setHeader("Content-Type", source.endsWith(".webp") ? "image/webp" : "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(readFileSync(source));
    });
  };
  return {
    name: "motion-levels-generated-media",
    configureServer: install,
    configurePreviewServer: install
  };
}

function gitValue(command: string) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

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

function characterModels(): PluginOption {
  return {
    name: "motion-levels-character-models",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/models", (request, response, next) => {
        const source = characterModelSource(request.url ?? "");
        if (!source || !existsSync(source)) {
          next();
          return;
        }

        response.setHeader("Content-Type", "model/gltf-binary");
        response.setHeader("Cache-Control", "public, max-age=3600");
        response.end(readFileSync(source));
      });
    },
    writeBundle(options) {
      if (!options.dir || !existsSync(characterAssetsRoot)) return;
      const modelsOutput = path.join(options.dir, "models");
      const quaterniusOutput = path.join(modelsOutput, "quaternius");
      mkdirSync(quaterniusOutput, { recursive: true });
      for (const entry of readdirSync(characterAssetsRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[a-z0-9-]+\.glb$/u.test(entry.name)) continue;
        const destination = entry.name === "tung-tung-tung-sahur.glb"
          ? path.join(modelsOutput, entry.name)
          : path.join(quaterniusOutput, entry.name);
        copyFileSync(path.join(characterAssetsRoot, entry.name), destination);
      }
    }
  };
}

function characterModelSource(requestUrl: string): string | undefined {
  let relative: string;
  try {
    relative = decodeURIComponent(requestUrl.split("?", 1)[0] ?? "").replace(/^\/+/, "");
  } catch {
    return undefined;
  }
  if (relative === "tung-tung-tung-sahur.glb") {
    return path.join(characterAssetsRoot, relative);
  }
  const match = /^quaternius\/([a-z0-9-]+\.glb)$/u.exec(relative);
  return match?.[1] ? path.join(characterAssetsRoot, match[1]) : undefined;
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
