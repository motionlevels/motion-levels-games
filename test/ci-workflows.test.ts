import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const dev = await readFile(new URL("../.github/workflows/dev-games.yml", import.meta.url), "utf8");
const checks = await readFile(new URL("../.github/workflows/checks.yml", import.meta.url), "utf8");
const release = await readFile(new URL("../.github/workflows/release-bundle.yml", import.meta.url), "utf8");

test("main and dev workflows share one CI implementation", () => {
  assert.match(ci, /uses: \.\/\.github\/workflows\/checks\.yml/);
  assert.match(dev, /uses: \.\/\.github\/workflows\/checks\.yml/);
  assert.doesNotMatch(ci, /npm (?:ci|run|test)/, "the caller must not duplicate reusable CI steps");
  assert.doesNotMatch(dev, /npm (?:ci|run|test)/, "the dev caller must only add its branch policy");
});

test("CI cancels stale runs and uses least-privilege permissions", () => {
  for (const [name, workflow] of [["CI", ci], ["Dev Games CI", dev]] as const) {
    assert.match(workflow, /permissions:\s*\n\s+contents: read/);
    assert.match(workflow, /concurrency:[\s\S]*?cancel-in-progress: true/);
    assert.match(workflow, /workflow_dispatch:/, `${name} must remain manually runnable`);
  }
});

test("green main builds automatically promote one immutable release", () => {
  assert.match(ci, /^  promote-release:/m);
  assert.match(ci, /^    needs: checks$/m);
  assert.match(ci, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(ci, /permissions:\s*\n\s+actions: read\s*\n\s+contents: write/);
  assert.match(ci, /^permissions:\s*\n\s+contents: read/m);
  const promotion = ci.match(/^  promote-release:[\s\S]*$/m)?.[0] || "";
  assert.match(promotion, /defaults:[\s\S]*?working-directory: source/);
  assert.match(promotion, /actions\/checkout@v7[\s\S]*?path: source/);
  assert.match(ci, /git fetch origin main --tags/);
  assert.match(ci, /git rev-parse HEAD.*git rev-parse origin\/main/);
  assert.match(ci, /git merge-base --is-ancestor "\$latest_tag" HEAD/);
  assert.match(ci, /200\) echo present/);
  assert.match(ci, /404\) echo absent/);
  assert.match(ci, /Unexpected GitHub release API status/);
  assert.match(ci, /git diff --quiet "\$latest_tag\.\.HEAD" -- "\$\{bundle_paths\[@\]\}"/);
  assert.match(ci, /apps\/player-menu/);
  assert.match(ci, /apps\/venue-runtime/);
  assert.match(ci, /latest_major < 2/);
  assert.match(ci, /node scripts\/next-release-tag\.ts/);
  assert.match(ci, /actions\/download-artifact@v8/);
  assert.match(ci, /name: motion-levels-games-\$\{\{ github\.sha \}\}/);
  assert.match(promotion, /path: source\/dist/);
  assert.match(promotion, /source\/dist\/motion-levels-games-\$\{\{ github\.sha \}\}\.tgz/);
  assert.match(ci, /git tag --annotate "\$RELEASE_TAG"/);
  assert.match(ci, /softprops\/action-gh-release@v3/);
  assert.match(ci, /tag_name: \$\{\{ steps\.release\.outputs\.release_tag \}\}/);
  assert.match(ci, /target_commitish: \$\{\{ github\.sha \}\}/);
  assert.match(ci, /steps\.release\.outputs\.notify == 'true'/);
  assert.match(ci, /repos\/\$repository\/actions\/workflows\/sync-games-bundle\.yml\/dispatches/);
  assert.doesNotMatch(ci, /gh workflow run release-bundle\.yml/);
});

test("reusable CI separates quality, compatibility, coverage, bundle, and browser checks", () => {
  assert.match(checks, /workflow_call:/);
  for (const job of [
    "quality",
    "compatibility-tests",
    "coverage-tests",
    "build-and-playtest",
    "browser-playtest",
  ]) {
    assert.match(checks, new RegExp(`^  ${job}:`, "m"), `${job} must remain an independent job`);
  }
  assert.match(checks, /node-version: 22/);
  assert.match(checks, /node-version: 24/);
  assert.match(checks, /run: npm run test:coverage/);
  assert.match(checks, /run: npm run test:contracts/);
  assert.match(checks, /run: npm run validate:characters/);
  assert.match(checks, /run: npm run benchmark:agents/);
  assert.match(checks, /run: npm run playtest/);
  assert.match(checks, /defaults:[\s\S]*?working-directory: source/);
  assert.equal(
    (checks.match(/^\s+path: source$/gm) ?? []).length,
    5,
    "every job must use the isolated checkout directory",
  );
  assert.equal(
    (checks.match(/cache-dependency-path: source\/package-lock\.json/g) ?? []).length,
    5,
    "every Node cache must follow the isolated checkout",
  );
  const browserJob = checks.match(/^  browser-playtest:[\s\S]*$/m)?.[0] || "";
  assert.match(browserJob, /docker run --rm --ipc=host/);
  assert.match(browserJob, /--user "\$\(id -u\):\$\(id -g\)"/);
  assert.match(browserJob, /mcr\.microsoft\.com\/playwright:v1\.61\.1-noble/);
  assert.match(browserJob, /npm run playtest:browser && npm run generate:media && npm run build:bundle && npm run verify:bundle/);
  assert.match(browserJob, /source\/dist\/motion-levels-games-/);
  assert.doesNotMatch(browserJob, /^    container:/m, "the runtime image must not own the runner workspace");
  assert.doesNotMatch(checks, /\bchown\b/, "CI must not repair shared-runner ownership recursively");
  assert.doesNotMatch(checks, /playwright install/, "browser CI must use the pinned runtime image without host installation");
  assert.equal((checks.match(/timeout-minutes:/g) ?? []).length, 5, "every reusable job needs a timeout");
});

test("manual release recovery passes the shared quality gate and identifies current main exactly", () => {
  assert.match(release, /workflow_dispatch:/);
  assert.doesNotMatch(release, /^\s{2}push:/m, "the tag created by main CI must not start a duplicate release gate");
  assert.doesNotMatch(release, /^\s{4}tags:/m);
  assert.match(release, /^\s{2}release-policy:/m);
  const releasePolicy = release.match(/^  release-policy:[\s\S]*?(?=^  checks:)/m)?.[0] || "";
  assert.match(releasePolicy, /defaults:[\s\S]*?working-directory: source/);
  assert.match(releasePolicy, /actions\/checkout@v7[\s\S]*?path: source/);
  assert.match(release, /\^games-v\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\$/);
  assert.match(release, /git fetch --no-tags origin main/);
  assert.match(release, /git rev-list -n 1 "\$GITHUB_REF_NAME"/);
  assert.match(release, /BASH_REMATCH\[1\] >= 2/);
  assert.match(release, /test "\$source_revision" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(release, /^\s{2}checks:[\s\S]*?uses: \.\/\.github\/workflows\/checks\.yml/m);
  assert.match(release, /^\s{2}bundle:[\s\S]*?needs:[\s\S]*?- release-policy[\s\S]*?- checks/m);
  assert.match(checks, /MOTION_LEVELS_GAMES_SOURCE_REVISION: \$\{\{ github\.sha \}\}/);
});

test("bundle generation has enough time for every production game", () => {
  assert.match(
    checks,
    /^  browser-playtest:[\s\S]*?timeout-minutes: 30[\s\S]*?npm run playtest:browser[\s\S]*?npm run generate:media[\s\S]*?npm run build:bundle/m
  );
  assert.doesNotMatch(
    checks.match(/^  build-and-playtest:[\s\S]*?(?=^  browser-playtest:)/m)?.[0] || "",
    /playwright|generate:media|build:bundle/,
    "host-only build job must not depend on browser libraries",
  );
});

test("main release bundles embed the planned tag before promotion creates it", () => {
  const browserJob = checks.match(/^  browser-playtest:[\s\S]*$/m)?.[0] || "";
  assert.match(browserJob, /fetch-depth: 0/);
  assert.match(browserJob, /name: Resolve the player-facing release tag/);
  assert.match(browserJob, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(browserJob, /git fetch origin main --tags/);
  assert.match(browserJob, /git tag --points-at HEAD --sort=-v:refname/);
  assert.match(browserJob, /node scripts\/next-release-tag\.ts/);
  assert.match(browserJob, /MOTION_LEVELS_GAMES_RELEASE_TAG=\$release_tag.*GITHUB_ENV/);
  assert.match(browserJob, /--env MOTION_LEVELS_GAMES_RELEASE_TAG/);
});

test("release reuses the exact bundle that passed the quality gate", () => {
  const releaseBundle = release.match(/^  bundle:[\s\S]*?(?=^  notify-platform:)/m)?.[0] || "";
  assert.match(releaseBundle, /timeout-minutes: 10/);
  assert.match(releaseBundle, /defaults:[\s\S]*?working-directory: source/);
  assert.match(releaseBundle, /actions\/checkout@v7[\s\S]*?path: source/);
  assert.match(releaseBundle, /actions\/download-artifact@v8/);
  assert.match(releaseBundle, /name: motion-levels-games-\$\{\{ env\.SOURCE_REVISION \}\}/);
  assert.match(releaseBundle, /path: source\/dist/);
  assert.match(releaseBundle, /source\/dist\/motion-levels-games-\$\{\{ env\.SOURCE_REVISION \}\}\.tgz/);
  assert.match(releaseBundle, /sha256sum --check "\$archive\.sha256"/);
  assert.match(releaseBundle, /apps\/player-menu/);
  assert.match(releaseBundle, /apps\/venue-runtime/);
  assert.doesNotMatch(releaseBundle, /npm run generate:media|npm run build:bundle/);
});

test("published release assets are immutable and dispatch their exact identity to the platform", () => {
  assert.match(release, /overwrite_files: false/);
  assert.match(release, /target_commitish: \$\{\{ env\.SOURCE_REVISION \}\}/);
  assert.match(release, /secrets\.PLATFORM_SYNC_TOKEN/);
  assert.match(release, /test -n "\$PLATFORM_SYNC_TOKEN"/);
  assert.match(release, /ref:\$ref,inputs:\{release_tag:\$release_tag,source_revision:\$source_revision\}/);
  assert.match(release, /repos\/motionlevels\/motion-levels-platform\/actions\/workflows\/sync-games-bundle\.yml\/dispatches/);
  assert.match(release, /^  notify-platform:[\s\S]*?needs:[\s\S]*?- bundle/m);
  assert.doesNotMatch(release, /motion-levels-venue|VENUE_SYNC_TOKEN|notify-venue/);
  assert.match(release, /--retry 3/);
  assert.match(release, /group: games-bundle-release/);
  assert.match(release, /cancel-in-progress: false/);
  assert.match(release, /git diff --quiet "\$SOURCE_REVISION\.\.origin\/main"/);
});
