import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginOption, ViteDevServer } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audioRoot = path.join(repositoryRoot, "assets/audio");
const shippedExtensions = new Set([".json", ".md", ".mp3", ".ogg", ".wav"]);

/** Serves and bundles the exact audio revision pinned by the assets submodule. */
export function motionLevelsAudioAssets(): PluginOption {
  const install = (server: Pick<ViteDevServer, "middlewares">) => {
    server.middlewares.use((request, response, next) => {
      const relative = audioRequestPath(request.url ?? "");
      if (!relative) {
        next();
        return;
      }
      const source = safeAudioSource(relative);
      if (!source) {
        next();
        return;
      }
      response.setHeader("Content-Type", audioContentType(source));
      response.setHeader("Cache-Control", "no-store");
      response.end(readFileSync(source));
    });
  };
  return {
    name: "motion-levels-audio-assets",
    configureServer: install,
    configurePreviewServer: install,
    writeBundle(options) {
      if (!options.dir || !existsSync(audioRoot)) return;
      copyAudioTree(audioRoot, path.join(options.dir, "audio"));
    }
  };
}

function audioRequestPath(requestUrl: string): string | undefined {
  let pathname: string;
  try {
    pathname = decodeURIComponent(requestUrl.split("?", 1)[0] ?? "");
  } catch {
    return undefined;
  }
  const marker = "/audio/";
  const offset = pathname.indexOf(marker);
  return offset >= 0 ? pathname.slice(offset + marker.length) : undefined;
}

function safeAudioSource(relative: string): string | undefined {
  if (!relative || relative.includes("..") || !shippedExtensions.has(path.extname(relative).toLowerCase())) return undefined;
  const source = path.resolve(audioRoot, relative);
  if (!source.startsWith(`${audioRoot}${path.sep}`) || !existsSync(source) || !statSync(source).isFile()) return undefined;
  return source;
}

function copyAudioTree(sourceRoot: string, destinationRoot: string): void {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      copyAudioTree(source, destination);
      continue;
    }
    if (!entry.isFile() || !shippedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function audioContentType(filePath: string): string {
  if (filePath.endsWith(".mp3")) return "audio/mpeg";
  if (filePath.endsWith(".ogg")) return "audio/ogg";
  if (filePath.endsWith(".wav")) return "audio/wav";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/markdown; charset=utf-8";
}
