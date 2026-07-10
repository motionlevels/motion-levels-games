import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type BundleFile = { path: string; sha256: string; bytes: number };

export async function bundleFiles(root: string): Promise<BundleFile[]> {
  const files = await walk(root);
  return Promise.all(files
    .filter((file) => path.basename(file) !== "bundle.json")
    .sort()
    .map(async (file) => {
      const contents = await readFile(file);
      return {
        path: path.relative(root, file).split(path.sep).join("/"),
        sha256: createHash("sha256").update(contents).digest("hex"),
        bytes: contents.length
      };
    }));
}

export function bundleContentDigest(files: BundleFile[]): string {
  const canonical = files.map((file) => `${file.path}\0${file.sha256}\0${file.bytes}\n`).join("");
  return createHash("sha256").update(canonical).digest("hex");
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}
