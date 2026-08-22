import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const audioSource = readFileSync(new URL("../src/audio.ts", import.meta.url), "utf8");
const displaySource = readFileSync(new URL("../src/MotionLevelsGamesDisplay.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../src/displayClient.ts", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("../../../packages/runtime/src/display.tsx", import.meta.url), "utf8");
const bundleSource = readFileSync(new URL("../../../scripts/build-bundle.ts", import.meta.url), "utf8");

test("new games load their revision-matched display while legacy games retain the existing app", () => {
  assert.match(appSource, /liveStatus\.sourceKind === "motion_levels_games"/u);
  assert.match(displaySource, /runtimeForRevision\(revision\)/u);
  assert.match(displaySource, /const displayAssetURL = `\$\{gamesAssetBaseURL\(\)\}\/\$\{encodeURIComponent\(revision\)\}\/display`/u);
  assert.match(displaySource, /stylesheet\.href = `\$\{displayAssetURL\}\/display\.css`/u);
  assert.match(displaySource, /script\.src = `\$\{displayAssetURL\}\/display\.js`/u);
  assert.match(displaySource, /pendingRuntime\?\.revision === revision/u);
  assert.match(displaySource, /pendingRuntime\?\.cancel\(/u);
  assert.match(displaySource, /safelyUnmount\(mountedRuntime, host\)/u);
  assert.match(displaySource, /runtimeRef\.current = runtime/u);
  assert.match(displaySource, /runtimeRetryDelayMillis\(attempt\)/u);
  assert.match(displaySource, /motion-levels-games-display-fallback/u);
});

test("the display consumes the full render feed instead of the menu status feed", () => {
  assert.match(apiSource, /\/api\/display/u);
  assert.match(apiSource, /\/api\/display\/events/u);
  assert.doesNotMatch(apiSource, /\/api\/player-state/u);
  assert.match(appSource, /addEventListener\("display", onDisplay\)/u);
  assert.doesNotMatch(appSource, /addEventListener\("player-state", onDisplay\)/u);
});

test("gateway display previews keep game assets on the proxied venue origin", () => {
  assert.match(displaySource, /\/gateways\\\/\[\^\/\]\+\)\\\/display/u);
  assert.match(displaySource, /gateway\[1\]\}\/games/u);
});

test("the kiosk reports the rendered revision, feed, paint, and viewport to the engine", () => {
  assert.match(appSource, /DISPLAY_HEARTBEAT_MS = 5000/u);
  assert.match(appSource, /lastPaintUnixMillis: lastPaintAt\.current/u);
  assert.match(appSource, /feedTransport: feedTransport\.current/u);
  assert.match(appSource, /viewportWidth:/u);
  assert.match(appSource, /shellRevision: PLAYER_DISPLAY_REVISION/u);
  assert.match(appSource, /new PlayerExperienceStateGate\(\)/u);
  assert.match(appSource, /revisionConvergenceDecision/u);
  assert.match(clientSource, /\/api\/display-client/u);
  assert.match(appSource, /!telemetryEnabled/u);
});
test("a live display accepts a restarted runtime and correlates audio diagnostics by unique id", () => {
  assert.match(appSource, /new PlayerExperienceStateGate\(\)/u);
  assert.match(appSource, /audioTestRuntimeRunID\.current !== liveStatus\.runId/u);
  assert.match(appSource, /audioOutput\.cancelTestPhrase\(\)/u);
  assert.match(appSource, /activeAudioTest\.current\.id !== outputTestID/u);
  assert.match(appSource, /\|\| !freshPendingTest/u);
  assert.match(appSource, /outputTestId: audioTestReport\.id/u);
  assert.match(clientSource, /outputTestId: string/u);
  assert.match(audioSource, /audio\/probando\.wav/u);
  assert.match(audioSource, /MOTION_LEVELS_PLAYER_DISPLAY_REVISION/u);
  assert.match(audioSource, /url\.searchParams\.set\("v", buildRevision\)/u);
});

test("the renderer keeps an embedded CSS bridge while the shell prefers revision-owned external CSS", () => {
  assert.match(runtimeSource, /@motion-levels-games\/display-kit\/styles\.css/u);
  assert.match(runtimeSource, /declare const MOTION_LEVELS_GAMES_DISPLAY_CSS: string/u);
  assert.match(runtimeSource, /style\.textContent = MOTION_LEVELS_GAMES_DISPLAY_CSS/u);
  assert.match(runtimeSource, /style\.dataset\.revision = MOTION_LEVELS_GAMES_REVISION/u);
  assert.match(runtimeSource, /window\.MotionLevelsGamesDisplays\[MOTION_LEVELS_GAMES_REVISION\] = displayRuntime/u);
  assert.match(bundleSource, /const provisionalDisplayBuild = await build\(\{ \.\.\.displayBuildOptions, write: false \}\)/u);
  assert.match(bundleSource, /provisionalDisplayBuild\.outputFiles\?\.find\(\(file\) => file\.path\.endsWith\("\.css"\)\)/u);
  assert.match(bundleSource, /MOTION_LEVELS_GAMES_DISPLAY_CSS: JSON\.stringify\(embeddedDisplayStyles\)/u);
  assert.match(displaySource, /gamesDisplayLegacyStylesID = "motion-levels-games-display-styles"/u);
  assert.match(displaySource, /gamesDisplayExternalStylesID = "motion-levels-games-display-stylesheet"/u);
  assert.match(displaySource, /legacyStyle\.media = "not all"/u);
  assert.match(displaySource, /stylesheet\.media = "not all"/u);
  assert.match(displaySource, /Promise\.allSettled\(\[stylesheetReady, runtimeReady\]\)/u);
  assert.match(displaySource, /stylesheet\.media = "all"/u);
  assert.match(displaySource, /legacyStyle\.dataset\.revision === revision/u);
  assert.match(displaySource, /legacyStyle\.media = "all"/u);
  assert.match(displaySource, /stylesheet\.dataset\.motionLevelsGamesRevision = revision/u);
  assert.match(displaySource, /runtimeLoadGeneration/u);
  assert.match(displaySource, /discardStaleRuntimeRevision/u);
});
