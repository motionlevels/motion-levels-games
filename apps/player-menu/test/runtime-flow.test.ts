import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { idleLoopSyncDecision, visibleActiveLevelLaunch } from "../src/runtimeFlow.ts";

describe("runtime screen flow", () => {
  it("keeps the game screen after a level was stopped", () => {
    assert.deepEqual(
      idleLoopSyncDecision({
        launchedGameID: "temporada1-niveles",
        launchingGameID: null,
        screenMode: "game",
        stoppedLevelGameID: "temporada1-niveles",
      }),
      { action: "hold-stopped", message: "Nivel detenido" },
    );
  });

  it("keeps the game screen while a replacement level launch is in flight", () => {
    assert.deepEqual(
      idleLoopSyncDecision({
        launchedGameID: "temporada1-niveles",
        launchingGameID: "temporada1-niveles",
        screenMode: "game",
        stoppedLevelGameID: null,
      }),
      { action: "hold-launching" },
    );
  });

  it("returns to browse only for an idle loop with no stopped or launching level", () => {
    assert.deepEqual(
      idleLoopSyncDecision({
        launchedGameID: "temporada1-niveles",
        launchingGameID: null,
        screenMode: "game",
        stoppedLevelGameID: null,
      }),
      { action: "return-to-browse", message: "Juego finalizado" },
    );
  });

  it("ignores idle sync outside the game screen", () => {
    assert.deepEqual(
      idleLoopSyncDecision({
        launchedGameID: "temporada1-niveles",
        launchingGameID: null,
        screenMode: "browse",
        stoppedLevelGameID: "temporada1-niveles",
      }),
      { action: "ignore" },
    );
  });

  it("shows active level launch progress on the current game screen", () => {
    assert.deepEqual(
      visibleActiveLevelLaunch({
        gameID: "temporada1-niveles",
        launch: { gameID: "temporada1-niveles", levelID: "temporada1-level-20", phase: "loading" },
        screenMode: "game",
      }),
      { gameID: "temporada1-niveles", levelID: "temporada1-level-20", phase: "loading" },
    );
  });

  it("does not show active level launch progress in browse or for another game", () => {
    assert.equal(
      visibleActiveLevelLaunch({
        gameID: "temporada1-niveles",
        launch: { gameID: "temporada1-niveles", levelID: "temporada1-level-20", phase: "stopping" },
        screenMode: "browse",
      }),
      null,
    );
    assert.equal(
      visibleActiveLevelLaunch({
        gameID: "reto-memoria",
        launch: { gameID: "temporada1-niveles", levelID: "temporada1-level-20", phase: "loading" },
        screenMode: "game",
      }),
      null,
    );
  });

  it("advances the selected level after free-mode success so controls follow engine status", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    assert.match(source, /if \(levelModeFor\(game, state\) === "free"\)/);
    assert.match(source, /const difficultyLevels = levelsForDifficulty\(game, difficulty\);/);
    assert.match(source, /const nextLevel = finishedIndex >= 0 \? difficultyLevels\[finishedIndex \+ 1\] : null;/);
    assert.match(source, /\[game\.id\]: nextLevel\.id/);
  });

  it("does not use catalog estimated duration as a level-game time limit", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    assert.match(source, /durationSeconds: launchGame\.levels\?\.length \? undefined : launchGame\.estimatedDurationSeconds \|\| undefined/);
    assert.match(source, /const totalMillis = hasLevels \? 0 : Math\.max\(0, Math\.round\(\(game\.estimatedDurationSeconds \|\| 0\) \* 1000\)\);/);
  });

  it("sends the selected catalog label to the engine for UUID level games", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    assert.match(source, /gameLabel: launchGame\.label/);
  });

  it("keeps challenge mode focused on current run state", () => {
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const cssSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

    assert.doesNotMatch(appSource, /level-browser-difficulty/);
    assert.doesNotMatch(cssSource, /level-browser-difficulty/);
    assert.match(appSource, /const bestDifficulty = challengeMode \? undefined : progress\.bestByLevel\[level\.id\]/);
    assert.match(appSource, /challengeCompleted \? \(\s*<span className="level-state challenge-state challenge-done">Hecho<\/span>/);
    assert.match(appSource, /challengeMode \? \(\s*<span className="level-state challenge-state challenge-pending">Pendiente<\/span>/);
    assert.match(appSource, /void launch\(selectedGame\.id, \{ resetChallengeRun: selectedLevelMode === "challenge" \}\)/);
    assert.match(appSource, /const stopLevelOnly = action === "exit" && activeMode === "free" && isLevelRuntimeActive\(status, launchedGame\)/);
    assert.match(appSource, /exitLabel=\{launchedLevelActive && launchedLevelMode === "free" \? "Terminar nivel" : "Salir del juego"\}/);
  });

  it("serializes polling and protects engine commands from rapid repeated taps", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

    assert.match(source, /nextRefresh = window\.setTimeout\(refresh, 2500\)/);
    assert.match(source, /nextRefresh = window\.setTimeout\(refreshMenuState, 700\)/);
    assert.match(source, /if \(launchInFlightRef\.current\) return false/);
    assert.match(source, /if \(controlInFlightRef\.current\) return/);
    assert.match(source, /setPendingControlAction\(action\)/);
    assert.match(source, /status\.pressureStreamConnected === false/);
    assert.match(source, /floorBlocked \? "Suelo sin señal"/);
  });

  it("schedules the inactivity deadline instead of waiting for another pressure update", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

    assert.match(source, /const remainingMillis = Math\.max\(0, noPressureSessionLimitMillis - idleMillis\)/);
    assert.match(source, /window\.setTimeout\(\(\) => \{\s*void closeSession\("no_pressure_1h"\)/);
  });

  it("persists replay protection and Party progress across renderer reloads", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

    assert.match(source, /processedAttemptIDs: \[\]/);
    assert.match(source, /processedAttemptIDs = \[\.\.\.new Set\(\[\.\.\.nextMenu\.processedAttemptIDs, \.\.\.processedIDs\]\)\]\.slice\(-maxProcessedAttemptIDs\)/);
    assert.match(source, /if \(!status\?\.sessionId \|\| !menu\.sessionId\) return/);
    assert.match(source, /attempt\.venueSessionId === menu\.sessionId/);
    assert.match(source, /localStorage\.setItem\(partyRunStorageKey, JSON\.stringify\(partyRun\)\)/);
  });

  it("fails closed for an empty category and confirms destructive controls", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

    assert.match(source, /const categorySelectionValid = visibleGames\.some/);
    assert.match(source, /if \(categoryGames\.length === 0\) return current/);
    assert.match(source, /className="empty-category"/);
    assert.match(source, /\{categorySelectionValid \? \(/);
    assert.match(source, /title=\{pendingGameControl === "restart" \? "¿Reiniciar partida\?"/);
    assert.match(source, /onNarration=\{\(\) => sendGameControl\("narration"\)\}/);
  });

  it("keeps modal and mirror recovery semantics robust", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

    assert.match(source, /current === "Sin conexión con el menú principal" \? "" : current/);
    assert.match(source, /<header className="topbar" inert=\{teamOpen\}>/);
    assert.match(source, /<section className="main-panel" inert=\{teamOpen\}>/);
    assert.match(source, /onKeyDown=\{\(event\) => trapKioskFocus\(event, \(\) => setTeamOpen\(false\)\)\}/);
  });
});
