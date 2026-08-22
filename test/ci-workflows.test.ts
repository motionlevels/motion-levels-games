import assert from "node:assert/strict";
import { glob, readFile } from "node:fs/promises";
import test from "node:test";

const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const dev = await readFile(new URL("../.github/workflows/dev-games.yml", import.meta.url), "utf8");
const checks = await readFile(new URL("../.github/workflows/checks.yml", import.meta.url), "utf8");
const release = await readFile(new URL("../.github/workflows/release-bundle.yml", import.meta.url), "utf8");
const generatedMedia = await readFile(
  new URL("../.github/workflows/generated-media.yml", import.meta.url),
  "utf8",
);
const nodeVersion = (await readFile(new URL("../.node-version", import.meta.url), "utf8")).trim();
const npmConfig = (await readFile(new URL("../.npmrc", import.meta.url), "utf8")).trim();
const rootPackage = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
};

test("main and dev workflows share one reusable CI implementation", () => {
  assert.match(ci, /uses: \.\/\.github\/workflows\/checks\.yml/u);
  assert.match(dev, /uses: \.\/\.github\/workflows\/checks\.yml/u);
  assert.doesNotMatch(ci, /npm (?:ci|run|test)/u);
  assert.doesNotMatch(dev, /npm (?:ci|run|test)/u);
});

test("ordinary CI is read-only, cancellable, and never renders generated media", () => {
  assert.match(ci, /permissions:\s*\n\s+contents: read/u);
  assert.match(ci, /cancel-in-progress: true/u);
  assert.match(ci, /workflow_dispatch:/u);
  assert.doesNotMatch(ci, /promote-release:/u);
  assert.doesNotMatch(ci, /generate:media|build:bundle|action-gh-release/u);
  assert.doesNotMatch(ci, /build_release_bundle:\s*true/u);
  assert.doesNotMatch(dev, /build_release_bundle:\s*true/u);
});

test("reusable checks make bundle assembly an explicit opt-in", () => {
  assert.match(checks, /workflow_call:[\s\S]*?build_release_bundle:/u);
  assert.match(checks, /default: false/u);
  assert.match(checks, /if: inputs\.build_release_bundle/u);
  assert.match(checks, /BUILD_RELEASE_BUNDLE: \$\{\{ inputs\.build_release_bundle \}\}/u);
  assert.match(
    checks,
    /if \[\[ "\$BUILD_RELEASE_BUNDLE" == "true" \]\]; then[\s\S]*?npm run build:bundle[\s\S]*?npm run verify:bundle/u,
  );
  assert.match(checks, /git rev-parse HEAD:assets/u);
  assert.match(checks, /repository: motionlevels\/motion-levels-assets/u);
  assert.match(checks, /token: \$\{\{ secrets\.MOTION_LEVELS_ASSETS_TOKEN \}\}/u);
  assert.doesNotMatch(checks, /npm run generate:media|MOTION_LEVELS_GAMES_MEDIA_DIR=dist\/media/u);
  assert.match(checks, /npm run playtest:browser/u);
  assert.match(checks, /npm run test:player-menu/u);
  assert.match(checks, /mcr\.microsoft\.com\/playwright:v1\.61\.1-noble/u);
  assert.match(checks, /if: inputs\.build_release_bundle[\s\S]*?actions\/upload-artifact@v7/u);
});

test("nightly/manual workflow is the normal home of generated previews and thumbnails", () => {
  assert.match(generatedMedia, /schedule:\s*\n\s+- cron: "17 3 \* \* \*"/u);
  assert.match(generatedMedia, /workflow_dispatch:[\s\S]*?inputs:[\s\S]*?ref:/u);
  assert.match(generatedMedia, /npm run generate:media/u);
  assert.match(generatedMedia, /npm run benchmark:agents/u);
  assert.match(generatedMedia, /npm run playtest:browser/u);
  assert.match(generatedMedia, /retention-days: 14/u);
  assert.match(generatedMedia, /cancel-in-progress: true/u);
  assert.doesNotMatch(generatedMedia, /contents: write/u);
});

test("manual release opts into the expensive bundle gate and reuses its exact artifact", () => {
  assert.match(release, /workflow_dispatch:/u);
  assert.doesNotMatch(release, /^\s{2}push:/mu);
  assert.match(
    release,
    /checks:[\s\S]*?uses: \.\/\.github\/workflows\/checks\.yml[\s\S]*?with:[\s\S]*?build_release_bundle: true/u,
  );
  assert.match(release, /actions\/download-artifact@v8/u);
  assert.match(release, /MOTION_LEVELS_ASSETS_TOKEN: \$\{\{ secrets\.MOTION_LEVELS_ASSETS_TOKEN \}\}/u);
  assert.match(release, /name: motion-levels-games-\$\{\{ env\.SOURCE_REVISION \}\}/u);
  assert.match(release, /sha256sum --check "\$archive\.sha256"/u);
  assert.match(release, /overwrite_files: false/u);
  assert.match(release, /target_commitish: \$\{\{ env\.SOURCE_REVISION \}\}/u);
  assert.match(release, /git diff --quiet "\$SOURCE_REVISION\.\.origin\/main"/u);
  assert.match(release, /sync-games-bundle\.yml\/dispatches/u);
});

test("CI keeps independent quality, tests, coverage, build, and browser lanes", () => {
  for (const job of [
    "quality",
    "compatibility-tests",
    "coverage-tests",
    "build-and-playtest",
    "browser-playtest",
  ]) {
    assert.match(checks, new RegExp(`^  ${job}:`, "m"), `${job} must remain independent`);
  }
  assert.match(checks, /run: npm run validate:architecture/u);
  assert.match(checks, /run: npm run test:all/u);
  assert.match(checks, /run: npm run test:dev:venue/u);
  assert.match(checks, /run: npm run test:coverage/u);
  assert.match(checks, /run: npm run build/u);
  assert.match(checks, /run: npm run playtest/u);
  assert.equal((checks.match(/timeout-minutes:/gu) ?? []).length, 5);
  assert.equal((checks.match(/cache-dependency-path: source\/package-lock\.json/gu) ?? []).length, 5);
  assert.doesNotMatch(checks, /\bchown\b/u);
  assert.doesNotMatch(checks, /playwright install/u);
});

test("coverage no longer repeats contract and scaffold tests already owned by test:all", () => {
  const coverage = checks.match(
    /^  coverage-tests:[\s\S]*?(?=^  build-and-playtest:)/mu,
  )?.[0] ?? "";
  assert.match(coverage, /npm run test:coverage/u);
  assert.match(coverage, /@motion-levels-games\/playground/u);
  assert.doesNotMatch(coverage, /test:contracts|test:scaffold/u);
});

test("architecture validation is part of local fast checks and CI", () => {
  assert.match(rootPackage.scripts?.["validate:architecture"] ?? "", /validate-architecture\.ts/u);
  assert.match(rootPackage.scripts?.["check:fast"] ?? "", /validate:architecture/u);
  assert.match(rootPackage.scripts?.check ?? "", /validate:architecture/u);
  assert.match(checks, /npm run validate:architecture/u);
});

test("the Node 24 toolchain has one version source", async () => {
  assert.equal(nodeVersion, "24.17.0");
  assert.equal(npmConfig, "engine-strict=true");
  assert.equal(rootPackage.packageManager, "npm@11.13.0");
  assert.deepEqual(rootPackage.engines, {
    node: ">=24 <25",
    npm: ">=11 <12",
  });
  assert.equal((checks.match(/node-version-file: source\/\.node-version/gu) ?? []).length, 5);
  assert.match(generatedMedia, /node-version-file: source\/\.node-version/u);

  const nodeTypeVersions = new Set<string>();
  for await (const packagePath of glob(["package.json", "{apps,games,packages}/*/package.json"], {
    cwd: new URL("..", import.meta.url),
  })) {
    const manifest = JSON.parse(
      await readFile(new URL(`../${packagePath}`, import.meta.url), "utf8"),
    ) as { devDependencies?: Record<string, string> };
    const nodeTypes = manifest.devDependencies?.["@types/node"];
    if (nodeTypes) nodeTypeVersions.add(nodeTypes);
  }
  assert.deepEqual([...nodeTypeVersions], ["^24.13.3"]);
});
