import { execFileSync } from "node:child_process";

export const motionLevelsGamesReleaseTagEnvironment = "MOTION_LEVELS_GAMES_RELEASE_TAG" as const;

const fullSourceRevisionPattern = /^[0-9a-f]{40}$/u;
const releaseTagPattern = /^games-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;

export type GamesBuildIdentity = Readonly<{
  sourceRevision: string;
  buildVersion: string;
  releaseTag: string | null;
}>;

type DeriveGamesBuildIdentityOptions = Readonly<{
  explicitReleaseTag?: string;
  exactReleaseTags?: readonly string[];
}>;

type ResolveGamesBuildIdentityOptions = Readonly<{
  cwd?: string;
  environment?: Readonly<Record<string, string | undefined>>;
}>;

/**
 * Derives the human-facing build version without weakening the full-SHA
 * runtime contract. An explicit release tag is authoritative because CI may
 * plan an immutable tag before creating it; otherwise the newest canonical
 * tag already pointing at the revision wins.
 */
export function deriveGamesBuildIdentity(
  sourceRevision: string,
  options: DeriveGamesBuildIdentityOptions = {}
): GamesBuildIdentity {
  if (!fullSourceRevisionPattern.test(sourceRevision)) {
    throw new Error(`invalid games source revision: ${sourceRevision}`);
  }

  const releaseTag = options.explicitReleaseTag === undefined
    ? highestReleaseTag(options.exactReleaseTags ?? [])
    : requireReleaseTag(options.explicitReleaseTag);

  return {
    sourceRevision,
    buildVersion: releaseTag === null ? sourceRevision.slice(0, 6) : releaseTag.slice("games-".length),
    releaseTag
  };
}

/** Resolves the optional environment override, then inspects exact Git tags. */
export function resolveGamesBuildIdentity(
  sourceRevision: string,
  options: ResolveGamesBuildIdentityOptions = {}
): GamesBuildIdentity {
  const environment = options.environment ?? process.env;
  const explicitReleaseTag = environment[motionLevelsGamesReleaseTagEnvironment];
  if (explicitReleaseTag !== undefined) {
    return deriveGamesBuildIdentity(sourceRevision, { explicitReleaseTag });
  }

  return deriveGamesBuildIdentity(sourceRevision, {
    exactReleaseTags: exactReleaseTags(sourceRevision, options.cwd ?? process.cwd())
  });
}

function exactReleaseTags(sourceRevision: string, cwd: string): string[] {
  try {
    return execFileSync(
      "git",
      ["tag", "--points-at", sourceRevision, "--list", "games-v*"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
      .split(/\r?\n/u)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function highestReleaseTag(tags: readonly string[]): string | null {
  const versions = tags
    .map((tag) => releaseTagVersion(tag))
    .filter((version): version is ReleaseTagVersion => version !== null);
  versions.sort(compareReleaseTagVersionsDescending);
  return versions[0]?.tag ?? null;
}

function requireReleaseTag(tag: string): string {
  if (!releaseTagPattern.test(tag)) throw new Error(`invalid games release tag: ${tag}`);
  return tag;
}

type ReleaseTagVersion = Readonly<{
  tag: string;
  major: bigint;
  minor: bigint;
  patch: bigint;
}>;

function releaseTagVersion(tag: string): ReleaseTagVersion | null {
  const match = releaseTagPattern.exec(tag);
  if (!match) return null;
  return {
    tag,
    major: BigInt(match[1]!),
    minor: BigInt(match[2]!),
    patch: BigInt(match[3]!)
  };
}

function compareReleaseTagVersionsDescending(left: ReleaseTagVersion, right: ReleaseTagVersion): number {
  for (const field of ["major", "minor", "patch"] as const) {
    if (left[field] > right[field]) return -1;
    if (left[field] < right[field]) return 1;
  }
  return left.tag.localeCompare(right.tag);
}
