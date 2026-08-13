import { pathToFileURL } from "node:url";

const releaseTagPattern = /^games-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export type ReleaseChange = "major" | "minor" | "patch";

export function nextReleaseTag(currentTag: string, change: ReleaseChange): string {
  const match = releaseTagPattern.exec(currentTag);
  if (!match) {
    throw new Error(`Invalid games release tag: ${currentTag}`);
  }
  if (change !== "major" && change !== "minor" && change !== "patch") {
    throw new Error(`Unsupported release change: ${String(change)}`);
  }

  const major = BigInt(match[1]!);
  const minor = BigInt(match[2]!);
  const patch = BigInt(match[3]!);
  if (change === "major") {
    return `games-v${major + 1n}.0.0`;
  }
  if (change === "minor") {
    return `games-v${major}.${minor + 1n}.0`;
  }
  return `games-v${major}.${minor}.${patch + 1n}`;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entryUrl === import.meta.url) {
  const [, , currentTag, change] = process.argv;
  try {
    process.stdout.write(`${nextReleaseTag(currentTag ?? "", change as ReleaseChange)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
