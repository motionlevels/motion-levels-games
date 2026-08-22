import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FLOOR_COLS,
  FLOOR_ROWS,
  frameCell,
  type Frame,
  type GameEvent,
  type PlayerReadyZone
} from "@motion-levels-games/game-sdk";
import {
  PlayerDisplay,
  createGame,
  crowdedRunningSnapshot,
  dueloReadyZoneAnimation,
  dueloReadyZones,
  dueloStartingAnimation,
  dueloVictoryAnimation,
  dueloWaitingIdleAnimation,
  finishedFrame,
  finishedSnapshot,
  manifest,
  runningFrame,
  runningSnapshot,
  startingSnapshot,
  waitingSnapshot,
  winAnimationMillis,
  type DueloGameInstance,
  type DueloSnapshot
} from "../src/index.ts";

test("manifest exposes production Duelo with strict 2–8 player support", () => {
  assert.equal(manifest.id, "duelo");
  assert.equal(manifest.availability.production, true);
  assert.deepEqual(manifest.players, { allowAny: false, min: 2, max: 8 });
  assert.deepEqual(manifest.config?.difficulty?.options, ["medium", "hard"]);
  assert.equal(manifest.start.mode, "player-ready");
  assert.equal(manifest.start.countdownMillis, 3_000);
  assert.equal(manifest.start.releaseGraceMillis, 2_000);
});

test("every supported player count has distinct in-bounds readiness zones", () => {
  for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
    const zones = dueloReadyZones(playerCount);
    assert.equal(zones.length, playerCount);
    const occupied = new Set<string>();
    for (const zone of zones) {
      assert.ok(zone.minX >= 0 && zone.maxX < FLOOR_COLS);
      assert.ok(zone.minY >= 0 && zone.maxY < FLOOR_ROWS);
      for (let y = zone.minY; y <= zone.maxY; y += 1) {
        for (let x = zone.minX; x <= zone.maxX; x += 1) {
          const key = `${x},${y}`;
          assert.equal(occupied.has(key), false, `${playerCount} players overlap at ${key}`);
          occupied.add(key);
        }
      }
    }
  }
});

test("readiness animation keeps its occupied signal below the unoccupied band", () => {
  assert.deepEqual(dueloReadyZoneAnimation, {
    occupied: {
      maxIntensity: 42,
      minIntensity: 22,
      periodMillis: 640
    },
    transitionMillis: 160,
    unoccupied: {
      maxIntensity: 100,
      minIntensity: 60,
      periodMillis: 1_600
    }
  });
  assert.ok(
    dueloReadyZoneAnimation.occupied.maxIntensity
      < dueloReadyZoneAnimation.unoccupied.minIntensity
  );
  assert.ok(
    dueloReadyZoneAnimation.occupied.periodMillis
      < dueloReadyZoneAnimation.unoccupied.periodMillis
  );
});

test("waiting idle uses sparse seeded player-color pulses outside every readiness moat", () => {
  assert.deepEqual(dueloWaitingIdleAnimation, {
    cycleMillis: 4_000,
    density: 0.25,
    exclusionPadding: 2,
    maxIntensity: 16,
    pulseMillis: 1_100
  });
  assert.ok(
    dueloWaitingIdleAnimation.maxIntensity
      < dueloReadyZoneAnimation.occupied.minIntensity
  );

  for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
    const game = createGame({ playerCount, seed: 137 });
    game.init(0);
    const zones = game.playerReadyZones();
    const patterns = new Set<string>();
    let ambientTilesSeen = 0;

    for (let atMillis = 0; atMillis <= 12_000; atMillis += 400) {
      game.tick({ atMillis });
      const frame = game.render();
      assert.deepEqual(game.render(), frame, "rendering the same clock must not consume randomness");
      const active: string[] = [];

      for (const cell of frame.cells) {
        if (zones.some((zone) => cellInsideZone(cell.x, cell.y, zone))) continue;
        const insideMoat = zones.some((zone) => cellInsideZone(
          cell.x,
          cell.y,
          zone,
          dueloWaitingIdleAnimation.exclusionPadding
        ));
        if (insideMoat) {
          assert.equal(cell.color, "#03060b", `${playerCount} players leaked idle color at ${cell.x},${cell.y}`);
          continue;
        }
        if (cell.color === "#03060b") continue;
        active.push(`${cell.x},${cell.y}`);
        assert.ok(maxHexChannel(cell.color) <= 52, `idle tile ${cell.color} overpowered readiness`);
      }

      assert.ok(active.length <= 72, `${playerCount} players produced ${active.length} ambient tiles`);
      ambientTilesSeen += active.length;
      patterns.add(active.sort().join("|"));
    }

    assert.ok(ambientTilesSeen > 0, `${playerCount} players never showed an ambient tile`);
    assert.ok(patterns.size >= 4, `${playerCount} players did not change the random idle pattern`);
  }

  const customColors = createGame({
    playerCount: 2,
    players: [{ color: "#ff0000" }, { color: "#00ff00" }],
    seed: 137
  });
  customColors.init(0);
  const seenColors = new Set<string>();
  for (let atMillis = 0; atMillis <= 16_000; atMillis += 200) {
    customColors.tick({ atMillis });
    for (const cell of customColors.render().cells) {
      if (cell.color !== "#03060b" && maxHexChannel(cell.color) < 60) seenColors.add(cell.color);
    }
  }
  assert.ok([...seenColors].some((color) => hexRgb(color).r > hexRgb(color).g * 2));
  assert.ok([...seenColors].some((color) => hexRgb(color).g > hexRgb(color).r * 2));

  const firstSeed = createGame({ playerCount: 2, seed: 137 });
  const secondSeed = createGame({ playerCount: 2, seed: 2026 });
  firstSeed.init(0);
  secondSeed.init(0);
  firstSeed.tick({ atMillis: 800 });
  secondSeed.tick({ atMillis: 800 });
  assert.notDeepEqual(firstSeed.render(), secondSeed.render());
});

test("every unoccupied 4x4 zone pulses homogeneously above ambient effects", () => {
  for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
    const game = createGame({
      playerCount,
      players: Array.from({ length: playerCount }, () => ({ color: "#646464" }))
    });
    game.init(0);

    game.tick({ atMillis: 0 });
    const minimumFrame = game.render();
    for (const zone of game.playerReadyZones()) {
      assert.deepEqual(uniqueZoneColors(minimumFrame, zone), ["#3c3c3c"]);
    }

    game.tick({ atMillis: 540 });
    const ambientOverlapFrame = game.render();
    for (const zone of game.playerReadyZones()) {
      assert.equal(zoneColors(ambientOverlapFrame, zone).length, 16);
      assert.equal(uniqueZoneColors(ambientOverlapFrame, zone).length, 1);
    }

    game.tick({ atMillis: 800 });
    const maximumFrame = game.render();
    for (const zone of game.playerReadyZones()) {
      assert.deepEqual(uniqueZoneColors(maximumFrame, zone), ["#646464"]);
    }
  }
});

test("occupied zones transition smoothly and keep a faster low-intensity pulse", () => {
  const game = createGame({
    playerCount: 2,
    players: [{ color: "#646464" }, { color: "#646464" }]
  });
  game.init(0);
  const [firstZone, secondZone] = game.playerReadyZones();
  assert.ok(firstZone && secondZone);

  game.tick({ atMillis: 100 });
  const beforePress = singleZoneColor(game.render(), firstZone);
  game.press({ x: firstZone.minX, y: firstZone.minY, pressed: true, atMillis: 100 });
  assert.equal(singleZoneColor(game.render(), firstZone), beforePress);

  game.tick({ atMillis: 180 });
  const midway = singleZoneColor(game.render(), firstZone);
  game.tick({ atMillis: 260 });
  const transitioned = singleZoneColor(game.render(), firstZone);
  assert.equal(beforePress, "#3e3e3e");
  assert.equal(midway, "#303030");
  assert.equal(transitioned, "#282828");
  assert.ok(hexChannel(beforePress) > hexChannel(midway));
  assert.ok(hexChannel(midway) > hexChannel(transitioned));

  game.tick({ atMillis: 640 });
  const readyMinimum = game.render();
  game.tick({ atMillis: 960 });
  const readyMaximum = game.render();
  assert.deepEqual(uniqueZoneColors(readyMinimum, firstZone), ["#161616"]);
  assert.deepEqual(uniqueZoneColors(readyMaximum, firstZone), ["#2a2a2a"]);
});

test("starting reveals the real player territories outward with synchronized zone beats", () => {
  assert.deepEqual(dueloStartingAnimation, {
    beatAttackMillis: 80,
    beatReleaseMillis: 300,
    confirmationMillis: 220,
    launchFlashIntensity: 96,
    launchFlashMillis: 220,
    previewMaxIntensity: 40,
    revealFadeSpan: 0.16,
    zoneBaseIntensity: 48,
    zoneBeatIntensity: 72
  });

  for (let playerCount = 2; playerCount <= 8; playerCount += 1) {
    const game = createGame({
      playerCount,
      players: Array.from({ length: playerCount }, () => ({ color: "#646464" })),
      seed: 137
    });
    game.init(0);
    occupyReadyZones(game, 100);
    assert.equal(game.snapshot().phase, "starting");
    const zones = game.playerReadyZones();

    const renderAt = (atMillis: number) => {
      game.tick({ atMillis });
      const frame = game.render();
      assert.deepEqual(game.render(), frame, "starting render must not mutate reveal state");
      return frame;
    };
    const targetCount = (frame: Frame) => frame.cells.filter((cell) => (
      game.targetOwner(cell.x, cell.y) >= 0
      && !zones.some((zone) => cellInsideZone(cell.x, cell.y, zone))
      && cell.color !== "#03060b"
    )).length;

    const zoneBase = renderAt(100);
    const zonePeak = renderAt(180);
    const confirmation = renderAt(319);
    const firstReveal = renderAt(900);
    const middleReveal = renderAt(1_900);
    const completeReveal = renderAt(3_080);
    const totalTargetsOutsideZones = completeReveal.cells.filter((cell) => (
      game.targetOwner(cell.x, cell.y) >= 0
      && !zones.some((zone) => cellInsideZone(cell.x, cell.y, zone))
    )).length;

    assert.equal(targetCount(confirmation), 0);
    assert.ok(targetCount(firstReveal) > 0);
    assert.ok(targetCount(middleReveal) > targetCount(firstReveal));
    assert.equal(targetCount(completeReveal), totalTargetsOutsideZones);
    for (const frame of [firstReveal, middleReveal, completeReveal]) {
      for (const cell of frame.cells) {
        if (cell.color === "#03060b" || zones.some((zone) => cellInsideZone(cell.x, cell.y, zone))) continue;
        assert.ok(game.targetOwner(cell.x, cell.y) >= 0, `revealed neutral tile at ${cell.x},${cell.y}`);
        assert.ok(maxHexChannel(cell.color) <= 40, `starting tile ${cell.color} reached play intensity`);
      }
    }

    for (const zone of zones) {
      assert.deepEqual(uniqueZoneColors(zoneBase, zone), ["#303030"]);
      assert.deepEqual(uniqueZoneColors(zonePeak, zone), ["#484848"]);
    }
  }

  const launch = createGame({
    playerCount: 2,
    players: [{ color: "#646464" }, { color: "#646464" }],
    seed: 137
  });
  launch.init(0);
  occupyReadyZones(launch, 100);
  launch.tick({ atMillis: 3_100 });
  assert.equal(launch.snapshot().phase, "running");
  const launchFrame = launch.render();
  assert.ok(launchFrame.cells
    .filter((cell) => launch.targetOwner(cell.x, cell.y) >= 0)
    .every((cell) => cell.color === "#606060"));
  launch.tick({ atMillis: 3_320 });
  assert.ok(averageTargetChannel(launch, launchFrame) > averageTargetChannel(launch, launch.render()));
});

test("release grace retains the ready pulse before transitioning back", () => {
  const game = createGame({
    playerCount: 2,
    players: [{ color: "#646464" }, { color: "#646464" }]
  });
  game.init(0);
  occupyReadyZones(game, 0);
  const zone = game.playerReadyZones()[0];
  assert.ok(zone);

  game.release({ x: zone.minX, y: zone.minY, pressed: false, atMillis: 200 });
  game.tick({ atMillis: 2_200 });
  assert.equal(game.snapshot().phase, "starting");
  const startingColor = singleZoneColor(game.render(), zone);
  assert.ok(hexChannel(startingColor) >= dueloStartingAnimation.zoneBaseIntensity);
  assert.ok(hexChannel(startingColor) <= dueloStartingAnimation.zoneBeatIntensity);

  game.tick({ atMillis: 2_201 });
  assert.equal(game.snapshot().phase, "waiting");
  const transitionStart = singleZoneColor(game.render(), zone);
  game.tick({ atMillis: 2_361 });
  const unoccupiedTarget = singleZoneColor(game.render(), zone);
  assert.ok(Math.abs(hexChannel(transitionStart) - hexChannel(startingColor)) <= 1);
  assert.equal(unoccupiedTarget, "#646464");
});

test("board targets are exactly fair and difficulty controls density", () => {
  for (const playerCount of [2, 3, 4, 5, 6, 7, 8]) {
    const medium = createGame({ playerCount, difficulty: "medium", seed: 137 });
    medium.init(0);
    const mediumSnapshot = medium.snapshot();
    assert.equal(new Set(mediumSnapshot.playerProgress.map((player) => player.target)).size, 1);
    assert.ok(mediumSnapshot.totalTargets <= Math.round(512 * 0.6));
    assert.ok(mediumSnapshot.totalTargets > Math.round(512 * 0.6) - playerCount);

    const hard = createGame({ playerCount, difficulty: "hard", seed: 137 });
    hard.init(0);
    const hardSnapshot = hard.snapshot();
    assert.equal(new Set(hardSnapshot.playerProgress.map((player) => player.target)).size, 1);
    assert.ok(hardSnapshot.totalTargets > mediumSnapshot.totalTargets);
    assert.equal(hardSnapshot.fillPercent, 90);
  }
});

test("manifest-owned tuning variables normalize fill values", () => {
  const game = createGame({
    playerCount: 2,
    difficulty: "hard",
    options: {
      base_fill_percent: 20,
      hard_fill_multiplier: 9,
      undeclared: 123
    }
  });
  game.init(0);
  assert.equal(game.snapshot().fillPercent, 54);
});

test("same seed produces the same organic board and another seed changes it", () => {
  const board = (seed: number) => {
    const game = createGame({ playerCount: 5, difficulty: "hard", seed });
    game.init(0);
    return Array.from({ length: FLOOR_COLS * FLOOR_ROWS }, (_, index) => (
      game.targetOwner(index % FLOOR_COLS, Math.floor(index / FLOOR_COLS))
    ));
  };
  assert.deepEqual(board(137), board(137));
  assert.notDeepEqual(board(137), board(138));
});

test("readiness stays live and cancels when a player leaves after grace", () => {
  const game = createGame({ playerCount: 3 });
  game.init(0);
  occupyReadyZones(game, 100);
  assert.equal(game.snapshot().phase, "starting");
  assert.deepEqual(game.snapshot().readyPlayerIndices, [0, 1, 2]);

  const zone = game.playerReadyZones()[1];
  assert.ok(zone);
  game.release({ x: zone.minX, y: zone.minY, pressed: false, atMillis: 200 });
  game.tick({ atMillis: 2_201 });
  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().readyPlayers, 2);

  game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis: 2_300 });
  game.tick({ atMillis: 5_300 });
  assert.equal(game.snapshot().phase, "running");
});

test("neutral, released, duplicate, and out-of-bounds inputs never score", () => {
  const game = createGame({ playerCount: 2, options: { base_fill_percent: 30 }, seed: 12 });
  game.init(0);
  startGame(game);
  const neutral = findTile(game, -1);
  const target = findTile(game, 0);
  assert.ok(neutral && target);
  const scoreBefore = game.snapshot().score;

  assert.deepEqual(game.press({ ...neutral, pressed: true, atMillis: 3_200 }), []);
  assert.deepEqual(game.release({ ...target, pressed: false, atMillis: 3_210 }), []);
  assert.deepEqual(game.press({ x: -1, y: 99, pressed: true, atMillis: 3_220 }), []);
  const first = game.press({ ...target, pressed: true, atMillis: 3_230 });
  assert.equal(first.length, 1);
  assert.deepEqual(game.press({ ...target, pressed: true, atMillis: 3_240 }), []);
  assert.equal(game.snapshot().score, scoreBefore + 1);
});

test("claim feedback stays on the pressed tile for its full animation", () => {
  const config = { playerCount: 2, options: { base_fill_percent: 30 }, seed: 137 };
  const control = createGame(config);
  const claimed = createGame(config);
  control.init(0);
  claimed.init(0);
  startGame(control);
  startGame(claimed);

  const target = findTile(claimed, 0, true);
  assert.ok(target);
  claimed.press({ ...target, pressed: true, atMillis: 3_200 });

  for (const offset of [0, 159, 160, 319, 320, 419, 420, 699, 700]) {
    const atMillis = 3_200 + offset;
    control.tick({ atMillis });
    claimed.tick({ atMillis });
    const controlFrame = control.render();
    const claimedFrame = claimed.render();
    const changedTiles = claimedFrame.cells.flatMap((cell, index) => (
      cell.color === controlFrame.cells[index]?.color ? [] : [`${cell.x},${cell.y}`]
    ));

    assert.deepEqual(changedTiles, [`${target.x},${target.y}`], `unexpected feedback at ${offset}ms`);
  }
});

test("a unique leader appears only after progress breaks the tie", () => {
  const game = createGame({ playerCount: 4, seed: 137 });
  game.init(0);
  startGame(game);
  assert.equal(game.snapshot().leaderIndex, -1);
  const target = findTile(game, 2);
  assert.ok(target);
  game.press({ ...target, pressed: true, atMillis: 3_200 });
  assert.equal(game.snapshot().leaderIndex, 2);
});

test("winner celebration locks scoring and automatically resets after five seconds", () => {
  const game = createGame({ playerCount: 2, seed: 9, options: { base_fill_percent: 30 } });
  game.init(0);
  startGame(game);
  const win = claimAll(game, 0, 4_000);
  assert.equal(win.filter((event) => event.cue === "win").length, 1);
  const finished = game.snapshot();
  assert.equal(finished.phase, "finished");
  assert.equal(finished.winnerIndex, 0);
  assert.equal(finished.success, true);
  assert.doesNotMatch(finished.lastEventMessage, /\.$/);

  const otherTarget = findTile(game, 1);
  assert.ok(otherTarget);
  const score = game.snapshot().score;
  assert.deepEqual(game.press({ ...otherTarget, pressed: true, atMillis: 4_500 }), []);
  assert.equal(game.snapshot().score, score);

  const winAt = finished.elapsedMillis + 3_100;
  game.tick({ atMillis: winAt + 120 });
  const impactFrame = game.render();
  game.tick({ atMillis: winAt + 1_050 });
  const revealFrame = game.render();
  game.tick({ atMillis: winAt + 2_600 });
  const celebrationFrame = game.render();
  game.tick({ atMillis: winAt + 4_850 });
  const fadeFrame = game.render();

  assert.deepEqual(dueloVictoryAnimation, {
    celebrationEndMillis: 4_400,
    celebrationPulseMaxIntensity: 58,
    celebrationPulseMinIntensity: 48,
    celebrationPulsePeriodMillis: 1_800,
    celebrationSparkleCycleMillis: 1_100,
    celebrationSparkleDensity: 0.25,
    celebrationSparkleIntensity: 96,
    celebrationSparkleMillis: 700,
    fadeMillis: 600,
    impactMillis: 350,
    revealBaseIntensity: 58,
    revealFadeSpan: 0.08,
    revealMillis: 1_450,
    revealVariationIntensity: 12
  });
  assert.notDeepEqual(revealFrame.cells, impactFrame.cells);
  assert.ok(new Set(celebrationFrame.cells.map((cell) => cell.color)).size > 1);
  assert.ok(celebrationFrame.cells.every((cell) => cell.color !== "#ffffff"));
  assert.equal(new Set(fadeFrame.cells.map((cell) => cell.color)).size, 1);

  game.tick({ atMillis: winAt + winAnimationMillis - 1 });
  assert.equal(game.snapshot().phase, "finished");
  const resetEvents = game.tick({ atMillis: winAt + winAnimationMillis });
  assert.equal(resetEvents[0]?.message, "Nuevo duelo");
  assert.equal(game.snapshot().phase, "waiting");
  assert.equal(game.snapshot().score, 0);
});

test("fixtures cover every phase and displays keep long names without ellipses", () => {
  assert.equal(waitingSnapshot.phase, "waiting");
  assert.equal(startingSnapshot.phase, "starting");
  assert.equal(runningSnapshot.phase, "running");
  assert.equal(finishedSnapshot.phase, "finished");
  assert.equal(crowdedRunningSnapshot.players.length, 8);
  assert.ok(frameCell(runningFrame, 0, 0));
  assert.ok(frameCell(finishedFrame, 0, 0));

  for (const snapshot of [waitingSnapshot, startingSnapshot, runningSnapshot, crowdedRunningSnapshot, finishedSnapshot]) {
    const html = renderDisplay(snapshot);
    assert.match(html, /Duelo/);
    assert.match(html, /Restantes/);
    assert.match(html, /aria-label="[^"]+: [0-9]+ baldosas restantes"/);
    assert.doesNotMatch(html, /…|\.\.\./);
  }
  assert.match(renderDisplay(crowdedRunningSnapshot), /Alejandra del Equipo Relámpago/);
  assert.match(renderDisplay(crowdedRunningSnapshot), /Objetivo/);
  assert.match(renderDisplay(crowdedRunningSnapshot), /Jugadores/);
  assert.match(renderDisplay(waitingSnapshot), /aria-label="Dificultad: Media"/);
  assert.match(renderDisplay(startingSnapshot), /aria-label="Dificultad: Difícil"/);
  assert.match(renderDisplay(waitingSnapshot), /is-heading-status-right/);
  assert.match(renderDisplay(waitingSnapshot), /is-heading-centered/);
  assert.doesNotMatch(renderDisplay(waitingSnapshot), /data-player-state="ready"/);
  const readyWaitingHtml = renderDisplay({
    ...waitingSnapshot,
    readyPlayerIndices: [0],
    readyPlayers: 1
  });
  assert.match(readyWaitingHtml, /data-player-state="ready"/);
  assert.match(readyWaitingHtml, /✓ Listo/);
  const singularRemainingHtml = renderDisplay({
    ...runningSnapshot,
    playerProgress: runningSnapshot.playerProgress.map((player, index) => index === 0
      ? { ...player, remaining: 1 }
      : player)
  });
  assert.match(singularRemainingHtml, /aria-label="[^"]+: 1 baldosa restante"/);
  assert.match(singularRemainingHtml, />Restante</);
  assert.match(renderDisplay(startingSnapshot), /ml-player-ready-overlay is-starting/);
  assert.match(renderDisplay(startingSnapshot), /<strong>2<\/strong>/);
  assert.match(renderDisplay(startingSnapshot), /<h2>Busca tu color<\/h2>/);
  assert.match(renderDisplay(startingSnapshot), /2\/2 colocados/);
  assert.match(renderDisplay(finishedSnapshot), /Nueva partida en/);
  assert.match(renderDisplay(finishedSnapshot), /data-result-variant="victory"/);
  assert.match(renderDisplay(finishedSnapshot), /style="--ml-tone:#24d9ff"/);
});

test("Duelo display composes the shared display system", () => {
  const source = readFileSync(new URL("../src/display.tsx", import.meta.url), "utf8");
  assert.match(source, /DisplayStack/);
  assert.match(source, /PlayerReadyOverlay/);
  assert.match(source, /PlayerRoster/);
  assert.match(source, /ProgressMeter/);
  assert.match(source, /ResultOverlay/);
  assert.match(source, /emphasis="score"/);
  assert.match(source, /emphasis="strong"/);
  assert.doesNotMatch(source, /duelo-display|duelo-player/);
});

function occupyReadyZones(game: DueloGameInstance, atMillis: number): void {
  game.playerReadyZones().forEach((zone) => {
    game.press({ x: zone.minX, y: zone.minY, pressed: true, atMillis });
  });
}

function startGame(game: DueloGameInstance): void {
  occupyReadyZones(game, 100);
  game.tick({ atMillis: 3_100 });
  assert.equal(game.snapshot().phase, "running");
}

function findTile(
  game: DueloGameInstance,
  owner: number,
  interior = false
): { x: number; y: number } | undefined {
  const inset = interior ? 1 : 0;
  for (let y = inset; y < FLOOR_ROWS - inset; y += 1) {
    for (let x = inset; x < FLOOR_COLS - inset; x += 1) {
      if (game.targetOwner(x, y) === owner) return { x, y };
    }
  }
  return undefined;
}

function claimAll(game: DueloGameInstance, owner: number, atMillis: number): GameEvent[] {
  const events: GameEvent[] = [];
  let offset = 0;
  for (let y = 0; y < FLOOR_ROWS; y += 1) {
    for (let x = 0; x < FLOOR_COLS; x += 1) {
      if (game.targetOwner(x, y) !== owner) continue;
      events.push(...game.press({ x, y, pressed: true, atMillis: atMillis + offset }));
      offset += 1;
    }
  }
  return events;
}

function renderDisplay(snapshot: DueloSnapshot): string {
  return renderToStaticMarkup(React.createElement(PlayerDisplay, { snapshot }));
}

function zoneColors(frame: Frame, zone: PlayerReadyZone): string[] {
  const colors: string[] = [];
  for (let y = zone.minY; y <= zone.maxY; y += 1) {
    for (let x = zone.minX; x <= zone.maxX; x += 1) {
      const color = frameCell(frame, x, y)?.color;
      if (color) colors.push(color);
    }
  }
  return colors;
}

function uniqueZoneColors(frame: Frame, zone: PlayerReadyZone): string[] {
  return [...new Set(zoneColors(frame, zone))];
}

function singleZoneColor(frame: Frame, zone: PlayerReadyZone): string {
  const colors = uniqueZoneColors(frame, zone);
  assert.equal(colors.length, 1);
  return colors[0] ?? "";
}

function hexChannel(color: string): number {
  return Number.parseInt(color.slice(1, 3), 16);
}

function cellInsideZone(x: number, y: number, zone: PlayerReadyZone, padding = 0): boolean {
  return x >= zone.minX - padding
    && x <= zone.maxX + padding
    && y >= zone.minY - padding
    && y <= zone.maxY + padding;
}

function hexRgb(color: string): { b: number; g: number; r: number } {
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16)
  };
}

function maxHexChannel(color: string): number {
  const rgb = hexRgb(color);
  return Math.max(rgb.r, rgb.g, rgb.b);
}

function averageTargetChannel(game: DueloGameInstance, frame: Frame): number {
  const channels = frame.cells.flatMap((cell) => (
    game.targetOwner(cell.x, cell.y) >= 0 ? [maxHexChannel(cell.color)] : []
  ));
  return channels.reduce((sum, value) => sum + value, 0) / Math.max(1, channels.length);
}
