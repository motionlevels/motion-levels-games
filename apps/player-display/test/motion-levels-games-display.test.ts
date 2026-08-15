import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const audioSource = readFileSync(new URL("../src/audio.ts", import.meta.url), "utf8");
const displaySource = readFileSync(new URL("../src/MotionLevelsGamesDisplay.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../src/displayClient.ts", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("../../../packages/runtime/src/display.tsx", import.meta.url), "utf8");

test("new games load their revision-matched display while legacy games retain the existing app", () => {
  assert.match(appSource, /liveStatus\.sourceKind === "motion_levels_games"/u);
  assert.match(displaySource, /runtime\?\.revision !== revision/u);
  assert.match(displaySource, /encodeURIComponent\(revision\)\}\/display\/display\.js/u);
  assert.match(displaySource, /pendingRuntime\?\.revision === revision/u);
  assert.match(displaySource, /pendingRuntime\?\.script\.remove\(\)/u);
  assert.match(displaySource, /safelyUnmount\(mountedRuntime, host\)/u);
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

test("a newly loaded display registry replaces revision-owned styles", () => {
  assert.match(runtimeSource, /style\.textContent = MOTION_LEVELS_GAMES_DISPLAY_CSS/u);
  assert.match(runtimeSource, /style\.dataset\.revision = MOTION_LEVELS_GAMES_REVISION/u);
});
