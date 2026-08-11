import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Agents 3D uses the shared Jugar Stage and one GameSession", async () => {
  const source = await readFile(new URL("../src/JugarAgentSurface.tsx", import.meta.url), "utf8");
  assert.match(source, /Stage,[\s\S]*?useGameSession/u);
  assert.match(source, /controllerSlots: "all"/u);
  assert.match(source, /session\.subscribeTrajectory/u);
  assert.match(source, /session\.presentTrajectoryFrame/u);
  assert.doesNotMatch(source, /createGameEngine|createAgentSceneRenderer|new THREE\./u);
});

test("Agents 3D exports through replay-runtime rather than a private schema", async () => {
  const source = await readFile(new URL("../src/JugarAgentSurface.tsx", import.meta.url), "utf8");
  assert.match(source, /ReplayRecorder/u);
  assert.match(source, /ReplayPlayer/u);
  assert.match(source, /encodeReplay/u);
  assert.match(source, /REPLAY_SCHEMA_VERSION/u);
  assert.doesNotMatch(source, /motion-levels-jugar-3d-trajectory/u);
});

test("Agents 3D remains a visible capability-gated top-bar surface", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /className="surface-mode-toggle"[\s\S]*?> Floor[\s\S]*?disabled=\{selectedGame\.createSessionController === undefined\}[\s\S]*?> Agents 3D/u
  );
  assert.match(source, /<JugarAgentSurface/u);
});

test("capture rejects upscaling instead of claiming synthetic native dimensions", async () => {
  const source = await readFile(new URL("../src/JugarAgentSurface.tsx", import.meta.url), "utf8");
  assert.match(source, /width > source\.width \|\| height > source\.height/u);
  assert.match(source, /cannot claim an upscaled native frame/u);
});

test("agent explanations are reachable through the shared surface selector", async () => {
  const source = await readFile(new URL("../src/JugarAgentSurface.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-label="Selected agent"/u);
  assert.match(source, /controller\.selectAgent\(event\.target\.value\)/u);
  assert.match(source, /selectedDebug\.explanation/u);
});

test("Agents 3D publishes the shared Stage diagnostic report unchanged", async () => {
  const source = await readFile(new URL("../src/JugarAgentSurface.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../src/playgroundApi.ts", import.meta.url), "utf8");
  assert.match(source, /type JugarStageDiagnostics/u);
  assert.match(source, /performanceRef\.current = diagnostics/u);
  assert.match(source, /onDiagnostics=\{handleStageDiagnostics\}/u);
  assert.match(api, /performance\?: JugarStageDiagnostics/u);
});

test("focused Duelo browser acceptance enforces desktop and capture budgets", async () => {
  const source = await readFile(
    new URL("../../../scripts/playtest-playground.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /assertJugarPerformanceBudget\(page, "desktop-medium"\)/u);
  assert.match(source, /assertJugarPerformanceBudget\(page, "capture", true\)/u);
  assert.match(source, /performance\.structuralWithinBudget/u);
  assert.match(source, /performance\.withinBudget/u);
  assert.match(source, /performance\.budgetReady[\s\S]*?&& performance\.withinBudget[\s\S]*?nativeFramebuffer/u);
  assert.match(source, /not venue-hardware certification/u);
  assert.match(source, /jugarPerformanceReadinessTimeoutMillis = 60_000/u);
  assert.match(source, /Jugar diagnostics did not become ready/u);
  assert.doesNotMatch(source, /timeout: 15_000/u);
  assert.match(
    source,
    /await prepareNativeJugarCapture\(page\);[\s\S]*?lab\.setQualityTier\("capture"\);[\s\S]*?assertJugarPerformanceBudget\(page, "capture", true\)/u
  );
});
