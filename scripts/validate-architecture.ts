import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

type ArchitectureConfig = {
  schema: string;
  gameRoot: string;
  engineAuthority: string;
  coreRoots: string[];
  compositionRoots: string[];
  allowedConcreteGameConsumers: string[];
  forbiddenEngineRoots: string[];
};

type PackageManifest = {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type WorkspacePackage = {
  root: string;
  name: string;
  manifest: PackageManifest;
};

const repoRoot = process.cwd();
const config = JSON.parse(
  await readFile(path.join(repoRoot, "architecture-boundaries.json"), "utf8")
) as ArchitectureConfig;
const strict = process.argv.includes("--strict");
const problems: string[] = [];

if (config.schema !== "motion-levels-games-architecture-v1") {
  problems.push(`unsupported architecture schema: ${config.schema}`);
}

const packages = await discoverWorkspacePackages();
const byRoot = new Map(packages.map((workspace) => [workspace.root, workspace] as const));
const games = packages.filter((workspace) => pathWithin(workspace.root, config.gameRoot));
const gamePackageNames = new Set(games.map((workspace) => workspace.name));
const allowedConcreteConsumers = new Set(config.allowedConcreteGameConsumers);

for (const forbiddenRoot of config.forbiddenEngineRoots) {
  if (await exists(path.join(repoRoot, forbiddenRoot))) {
    problems.push(
      `${forbiddenRoot}: a second engine root is forbidden; the canonical engine authority is ${config.engineAuthority}`
    );
  }
}

for (const game of games) {
  for (const dependency of runtimeDependencies(game.manifest)) {
    if (gamePackageNames.has(dependency) && dependency !== game.name) {
      problems.push(
        `${game.root}: game package ${game.name} depends on concrete game ${dependency}; games must be independently extractable`
      );
    }
  }
  await scanGameSourceImports(game, gamePackageNames, problems);
}

for (const workspace of packages.filter((candidate) => candidate.root.startsWith("packages/"))) {
  const concreteDependencies = runtimeDependencies(workspace.manifest)
    .filter((dependency) => gamePackageNames.has(dependency));
  if (concreteDependencies.length === 0) continue;
  if (!allowedConcreteConsumers.has(workspace.root)) {
    problems.push(
      `${workspace.root}: package-layer code depends on concrete games (${concreteDependencies.join(", ")}); move catalog composition to an application/composition root`
    );
  }
}

for (const exceptionRoot of allowedConcreteConsumers) {
  const workspace = byRoot.get(exceptionRoot);
  if (!workspace) {
    problems.push(`${exceptionRoot}: stale allowedConcreteGameConsumers entry does not identify a workspace package`);
    continue;
  }
  const concreteDependencies = runtimeDependencies(workspace.manifest)
    .filter((dependency) => gamePackageNames.has(dependency));
  if (concreteDependencies.length === 0) {
    problems.push(`${exceptionRoot}: stale concrete-game composition exception can now be removed`);
  }
}

for (const coreRoot of config.coreRoots) {
  await scanCoreSourceImports(coreRoot, gamePackageNames, problems);
}

await validateSingleEngineAuthority(packages, config.engineAuthority, problems);

if (strict && config.allowedConcreteGameConsumers.length > 0) {
  problems.push(
    `strict mode: concrete-game package exceptions remain: ${config.allowedConcreteGameConsumers.join(", ")}`
  );
}

if (problems.length > 0) {
  console.error([
    "Architecture boundary validation failed:",
    ...problems.map((problem) => `- ${problem}`),
  ].join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Architecture boundaries valid: ${games.length} games, ${packages.length} workspace packages, engine=${config.engineAuthority}`
  );
}

async function discoverWorkspacePackages(): Promise<WorkspacePackage[]> {
  const roots = ["packages", "games", "apps"];
  const discovered: WorkspacePackage[] = [];
  for (const root of roots) {
    const absoluteRoot = path.join(repoRoot, root);
    if (!await exists(absoluteRoot)) continue;
    for (const entry of await readdir(absoluteRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const workspaceRoot = path.posix.join(root, entry.name);
      const manifestPath = path.join(repoRoot, workspaceRoot, "package.json");
      if (!await exists(manifestPath)) continue;
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackageManifest;
      const name = String(manifest.name ?? "").trim();
      if (!name) {
        problems.push(`${workspaceRoot}: package.json must declare a package name`);
        continue;
      }
      discovered.push({ root: workspaceRoot, name, manifest });
    }
  }
  return discovered.sort((left, right) => left.root.localeCompare(right.root));
}

function runtimeDependencies(manifest: PackageManifest): string[] {
  return [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])].sort();
}

async function scanCoreSourceImports(
  coreRoot: string,
  concreteGames: ReadonlySet<string>,
  problemList: string[]
): Promise<void> {
  const sourceRoot = path.join(repoRoot, coreRoot, "src");
  if (!await exists(sourceRoot)) return;
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      const packageName = internalPackageName(specifier);
      if (packageName && concreteGames.has(packageName)) {
        problemList.push(
          `${relative(file)}: core root ${coreRoot} imports concrete game ${packageName}`
        );
      }
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        if (pathWithin(relative(target), config.gameRoot)) {
          problemList.push(`${relative(file)}: core root ${coreRoot} reaches into games/ by relative import`);
        }
      }
    }
  }
}

async function scanGameSourceImports(
  game: WorkspacePackage,
  concreteGames: ReadonlySet<string>,
  problemList: string[]
): Promise<void> {
  const sourceRoot = path.join(repoRoot, game.root, "src");
  if (!await exists(sourceRoot)) return;
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      const packageName = internalPackageName(specifier);
      if (packageName && concreteGames.has(packageName) && packageName !== game.name) {
        problemList.push(`${relative(file)}: ${game.name} imports concrete game ${packageName}`);
      }
      if (!specifier.startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), specifier);
      const targetRelative = relative(target);
      if (pathWithin(targetRelative, config.gameRoot) && !pathWithin(targetRelative, game.root)) {
        problemList.push(`${relative(file)}: ${game.name} reaches into another game with ${specifier}`);
      }
    }
  }
}

async function validateSingleEngineAuthority(
  workspaces: WorkspacePackage[],
  engineAuthority: string,
  problemList: string[]
): Promise<void> {
  const implementationPattern = /\b(?:function\s+createGameEngine|class\s+GameEngine)\b/u;
  for (const workspace of workspaces) {
    const sourceRoot = path.join(repoRoot, workspace.root, "src");
    if (!await exists(sourceRoot)) continue;
    for (const file of await sourceFiles(sourceRoot)) {
      const source = await readFile(file, "utf8");
      if (!implementationPattern.test(source)) continue;
      if (!pathWithin(relative(file), engineAuthority)) {
        problemList.push(
          `${relative(file)}: engine implementation detected outside canonical authority ${engineAuthority}`
        );
      }
    }
  }
}

function moduleSpecifiers(source: string): string[] {
  const result = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[\w*\s{},]*\s+from\s+)?["']([^"']+)["']/gu,
    /import\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) result.add(specifier);
    }
  }
  return [...result];
}

function internalPackageName(specifier: string): string | null {
  const match = specifier.match(/^(@motion-levels-games\/[^/]+)/u);
  return match?.[1] ?? null;
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(target);
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        files.push(target);
      }
    }
  }
  await walk(root);
  return files.sort();
}

function relative(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function pathWithin(candidate: string, root: string): boolean {
  const normalizedCandidate = candidate.split(path.sep).join("/").replace(/^\.\//u, "");
  const normalizedRoot = root.split(path.sep).join("/").replace(/\/+$/u, "");
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}
