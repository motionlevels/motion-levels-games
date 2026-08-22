import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFrame, setFrameCell, type GameSnapshot } from "@motion-levels-games/game-sdk";
import {
  DisplayStack,
  DisplayStage,
  EventRail,
  FloorPreview,
  FramePreviewPanel,
  GameDisplayShell,
  LivesMeter,
  MetricPanel,
  MetricRow,
  PlayerCard,
  PlayerDisplayRuntimeProvider,
  PlayerReadyOverlay,
  PlayerRoster,
  PlayerScorePanel,
  ProgressMeter,
  ResultOverlay,
  RoundStrip,
  StageWithSidebar,
  TrajectoryLane,
  VersusScoreboard,
  floorTileAfterKeyboardNavigation
} from "../src/index.tsx";
import { normalizeLivesForDisplay } from "../src/lives-meter.tsx";

const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const livesComponentSource = readFileSync(new URL("../src/lives-meter.tsx", import.meta.url), "utf8");

test("Trajectory motion is namespaced and honors reduced motion", () => {
  assert.match(styleSource, /\.ml-trajectory-lane/);
  assert.match(styleSource, /\.ml-trajectory-trail-point/);
  assert.match(styleSource, /@keyframes ml-trajectory-impact/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styleSource, /\.ml-trajectory-marker/);
  assert.match(styleSource, /\.ml-trajectory-lane\.is-moving-left \.ml-trajectory-marker-core/);
  assert.match(styleSource, /\.ml-trajectory-lane\.is-moving-right \.ml-trajectory-marker-core/);
});

test("paused display shells freeze presentation keyframes", () => {
  assert.match(
    styleSource,
    /\.ml-display-shell\.is-paused \*,[\s\S]*?animation-play-state:\s*paused !important;/,
    "runtime pause must freeze game-owned CSS animations"
  );
});

test("Versus center values fit the scoreboard card", () => {
  assert.match(styleSource, /\.ml-versus-center strong \{[\s\S]*font-size: clamp\(68px, 4\.4vw, 86px\);[\s\S]*white-space: nowrap;/u);
});

test("MetricPanel renders label and value without app dependencies", () => {
  const html = renderToStaticMarkup(React.createElement(MetricPanel, { label: "Score", value: 42 }));

  assert.match(html, /Score/);
  assert.match(html, /42/);
});

test("score primitives clamp progress and preserve both team identities", () => {
  const left = { label: "Rojo", score: 3, color: "#ff1c28" as const };
  const right = { label: "Azul", score: 7, color: "#145cff" as const };
  const scoreboard = renderToStaticMarkup(React.createElement(VersusScoreboard, {
    centerLabel: "Objetivo",
    centerValue: 5,
    left,
    right,
    target: 5
  }));
  const overTarget = renderToStaticMarkup(React.createElement(PlayerScorePanel, {
    player: right,
    side: "blue",
    target: 5
  }));

  assert.match(scoreboard, /aria-label="Marcador"/);
  assert.match(scoreboard, /Rojo/);
  assert.match(scoreboard, /Azul/);
  assert.match(scoreboard, /--ml-score-progress:0\.6/);
  assert.match(overTarget, /--ml-score-progress:1/);
});

test("layout primitives expose their semantic labels and column contract", () => {
  const frame = createFrame("#05070a");
  const rowProps = {
    children: React.createElement(MetricPanel, { label: "Tiempo", value: "0:30" }),
    className: "summary",
    columns: 4
  } satisfies React.ComponentProps<typeof MetricRow>;
  const row = renderToStaticMarkup(React.createElement(MetricRow, rowProps));
  const preview = renderToStaticMarkup(React.createElement(FramePreviewPanel, {
    className: "arena",
    frame,
    label: "Juego en el suelo"
  }));

  assert.match(row, /ml-metric-row summary/);
  assert.match(row, /--ml-metric-columns:4/);
  assert.match(preview, /ml-frame-preview-panel arena/);
  assert.match(preview, /Juego en el suelo/);
  assert.match(preview, /data-display-containment="frame-preview"/);
  assert.match(preview, /data-display-containment="floor-preview"/);
  assert.equal((preview.match(/data-tile-x=/g) ?? []).length, 512);
});

test("shared stage recipes expose explicit containment without constraining game content", () => {
  const stage = React.createElement(DisplayStage, {
    detail: "Ronda 2",
    eyebrow: "Objetivo",
    label: "Arena principal",
    title: "Protege el núcleo"
  }, React.createElement("div", null, "stage"));
  const sidebar = React.createElement(StageWithSidebar, {
    side: "left",
    sidebar: React.createElement("div", null, "metrics"),
    stage
  });
  const stack = renderToStaticMarkup(React.createElement(DisplayStack, {
    bottom: React.createElement(EventRail, { message: "Mantén la posición", tone: "green" }),
    top: React.createElement("div", null, "hero")
  }, sidebar));

  assert.match(stack, /data-display-containment="display-stack"/);
  assert.match(stack, /--ml-display-stack-rows:auto minmax\(0, 1fr\) auto/);
  assert.match(stack, /ml-stage-with-sidebar is-sidebar-left/);
  assert.match(stack, /data-display-containment="stage-main"/);
  assert.match(stack, /aria-label="Arena principal"/);
  assert.match(stack, /data-display-containment="stage-content"/);
  assert.match(stack, /role="status"/);
  assert.match(stack, /data-display-tone="green"/);
});

test("feedback, progress, and roster primitives normalize values and retain semantics", () => {
  const player = { color: "#36d9ff" as const, label: "Equipo Norte", score: 12 };
  const roster = React.createElement(PlayerRoster, { columns: 99 }, React.createElement(PlayerCard, {
    featured: true,
    player,
    rank: 1,
    status: "Líder",
    target: 10
  }));
  const progress = React.createElement(ProgressMeter, {
    label: "Progreso",
    max: 0,
    value: 42,
    valueLabel: "42 puntos"
  });
  const nonPointCard = React.createElement(PlayerCard, {
    player,
    scoreUnit: "rondas ganadas",
    target: 15
  });
  const longLabelCard = React.createElement(PlayerCard, {
    player: { ...player, label: "Alejandra del Equipo Relámpago" }
  });
  const html = renderToStaticMarkup(React.createElement(
    "div",
    null,
    roster,
    progress,
    nonPointCard,
    longLabelCard,
    React.createElement(ResultOverlay, {
      message: "Gran partida",
      title: "Victoria",
      tone: "green"
    })
  ));

  assert.match(html, /data-roster-columns="8"/);
  assert.match(html, /aria-label="Equipo Norte: 12 puntos"/);
  assert.match(html, /aria-label="Equipo Norte: 12 rondas ganadas"/);
  assert.match(html, /aria-valuetext="12 de 15 rondas ganadas"/);
  assert.match(html, /data-player-featured="true"/);
  assert.match(html, /ml-player-card is-label-extra-long/);
  assert.match(html, /aria-valuenow="1"/);
  assert.match(html, /aria-valuemax="1"/);
  assert.match(html, /data-display-contained-by="content"/);
  assert.match(html, /data-display-containment="result-overlay"/);
  assert.match(html, /aria-live="assertive"/);
  assert.match(styleSource, /\.ml-player-card\.is-muted\s*\{[^}]*filter:\s*saturate\(0\.54\) brightness\(0\.72\);[^}]*opacity:\s*0\.58;/s);
  assert.match(styleSource, /\.ml-player-card\.is-recent\s*\{[^}]*animation:\s*ml-player-card-recent 720ms/s);
  assert.equal(renderToStaticMarkup(React.createElement(ResultOverlay, {
    title: "Oculto",
    visible: false
  })), "");
});

test("TrajectoryLane clamps normalized 2D geometry and bounds decorative history", () => {
  const html = renderToStaticMarkup(React.createElement(TrajectoryLane, {
    caption: "Trayectoria actual",
    direction: "right",
    impact: { position: { x: 0.9, y: -0.4 }, side: "right" },
    left: { color: "#ff364a", label: "Rojo", value: 2 },
    pace: 0.75,
    position: { x: 1.7, y: -0.3 },
    right: { color: "#2f73ff", label: "Azul", value: 4 },
    trail: Array.from({ length: 20 }, (_, index) => ({
      x: (index - 2) / 10,
      y: (18 - index) / 10
    }))
  }));

  assert.match(html, /data-display-containment="trajectory-lane"/);
  assert.match(html, /data-display-containment="trajectory-track"/);
  assert.doesNotMatch(html, /data-display-overflow="allow"/);
  assert.match(html, /data-lane-position="1,0"/);
  assert.match(html, /data-lane-position-x="1"/);
  assert.match(html, /data-lane-position-y="0"/);
  assert.match(html, /--ml-lane-position-x:100%/);
  assert.match(html, /--ml-lane-position-y:0%/);
  assert.match(html, /--ml-lane-transition-duration:105ms/);
  assert.match(html, /data-lane-impact="right"/);
  assert.match(html, /data-lane-impact-x="0\.9"/);
  assert.match(html, /data-lane-impact-y="0"/);
  assert.equal((html.match(/data-lane-trail-position=/g) ?? []).length, 12);
  assert.equal((html.match(/data-display-item="trajectory-trail"/g) ?? []).length, 12);
  assert.match(styleSource, /\.ml-trajectory-track\s*\{[^}]*overflow:\s*hidden;[^}]*position:\s*relative;/s);
  assert.match(styleSource, /left:\s*clamp\([\s\S]*?var\(--ml-lane-position-x, 50%\)[\s\S]*?calc\(100% - var\(--ml-lane-marker-size\) \/ 2\)/s);
  assert.match(styleSource, /top:\s*clamp\([\s\S]*?var\(--ml-lane-position-y, 50%\)[\s\S]*?calc\(100% - var\(--ml-lane-marker-size\) \/ 2\)/s);
});

test("LivesMeter renders stable inline SVG slots for remaining and lost hearts", () => {
  const html = renderToStaticMarkup(React.createElement(LivesMeter, { lives: 2, maxLives: 3 }));

  assert.match(html, /aria-label="2 de 3 vidas restantes"/);
  assert.match(html, /data-lives-meter="true"/);
  assert.equal((html.match(/data-life-state="remaining"/g) ?? []).length, 2);
  assert.equal((html.match(/data-life-state="lost"/g) ?? []).length, 1);
  assert.equal((html.match(/class="ml-life-heart-svg"/g) ?? []).length, 3);
  assert.equal((html.match(/data-life-slot=/g) ?? []).length, 3);
  assert.equal((html.match(/data-display-scale-envelope="1\.25"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /♥/, "heart geometry must not depend on a platform font glyph");
  assert.match(styleSource, /\.ml-life-heart\.is-remaining\s*\{[^}]*color:\s*#ff2036;/s);
  assert.match(styleSource, /\.ml-life-heart\.is-lost\s*\{[^}]*color:\s*#566171;/s);
  assert.match(styleSource, /\.ml-life-heart-svg\s*\{[^}]*fill:\s*currentColor;/s);
});

test("LivesMeter uses a deterministic two-axis grid with animation-safe slots", () => {
  const html = renderToStaticMarkup(React.createElement(LivesMeter, { lives: 12, maxLives: 12 }));

  assert.equal((html.match(/data-life-state="remaining"/g) ?? []).length, 12);
  assert.match(html, /data-life-columns="6"/);
  assert.match(html, /data-life-rows="2"/);
  assert.match(styleSource, /\.ml-lives-meter\s*\{[\s\S]*container-type:\s*size;[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(var\(--ml-life-columns, 1\), minmax\(0, 1fr\)\);[\s\S]*grid-template-rows:\s*repeat\(var\(--ml-life-rows, 1\), minmax\(0, 1fr\)\);[\s\S]*overflow:\s*clip;/s);
  assert.match(styleSource, /\.ml-life-heart\s*\{[\s\S]*contain:\s*size layout paint;[\s\S]*container-type:\s*size;[\s\S]*overflow:\s*clip;/s);
  assert.match(styleSource, /\.ml-life-heart-visual\s*\{[\s\S]*height:\s*min\(76cqh, 76cqw, var\(--ml-life-size\)\);[\s\S]*width:\s*min\(76cqh, 76cqw, var\(--ml-life-size\)\);/s);
});

test("LivesMeter owns calm idle and life-change motion", () => {
  assert.match(livesComponentSource, /const previousLivesRef = useRef\(remainingLives\)/);
  assert.match(livesComponentSource, /lifeChange\.to > lifeChange\.from[\s\S]*?"is-regained"[\s\S]*?"is-losing"/);
  assert.match(livesComponentSource, /data-life-change=\{changeClass \|\| undefined\}/);
  assert.match(styleSource, /\.ml-life-heart-visual\s*\{[^}]*animation:\s*ml-heart-pulse 3\.4s/s);
  assert.match(styleSource, /\.ml-life-heart-visual\.is-losing\s*\{[^}]*animation:\s*ml-life-lost 900ms/s);
  assert.match(styleSource, /\.ml-life-heart-visual\.is-regained\s*\{[^}]*animation:\s*ml-life-regained 1s/s);
  assert.match(styleSource, /@keyframes ml-heart-pulse/);
  assert.match(styleSource, /@keyframes ml-life-lost/);
  assert.match(styleSource, /@keyframes ml-life-regained/);
  assert.match(
    styleSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ml-life-heart-visual\s*\{\s*animation:\s*none;/,
    "heart motion must honor reduced-motion preferences"
  );
});

test("LivesMeter normalizes invalid snapshots and caps visual DOM growth", () => {
  const invalid = normalizeLivesForDisplay(Number.NaN, -4);
  const overLimit = normalizeLivesForDisplay(37, 100);
  const html = renderToStaticMarkup(React.createElement(LivesMeter, { lives: 37, maxLives: 100 }));

  assert.equal(invalid.totalLives, 0);
  assert.equal(invalid.remainingLives, 0);
  assert.ok(invalid.diagnostics.length >= 2);
  assert.equal(overLimit.compact, true);
  assert.equal(overLimit.renderedSlots, 0);
  assert.match(html, /data-life-mode="compact"/);
  assert.match(html, /data-life-summary="true"/);
  assert.match(html, /× 37/);
  assert.match(html, /de 100/);
  assert.doesNotMatch(html, /data-life-slot=/);
  assert.equal((html.match(/class="ml-life-heart-svg"/g) ?? []).length, 1);
});

test("shared result motion is contained and honors reduced motion", () => {
  assert.match(styleSource, /\.ml-result-overlay-card\s*\{[^}]*animation:\s*ml-result-overlay-enter/s);
  assert.match(styleSource, /@keyframes ml-result-overlay-enter/);
  assert.match(
    styleSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ml-result-overlay-card[\s\S]*?animation:\s*none;/
  );
});

test("primary solo metrics use distance-readable typography", () => {
  assert.match(
    styleSource,
    /\.ml-solo-number-row \.ml-metric-value\s*\{[^}]*font-size:\s*clamp\(104px, 28cqw, 150px\);/s
  );
  assert.match(
    styleSource,
    /\.ml-solo-number-row \.ml-lives-meter\s*\{[^}]*--ml-life-size:\s*clamp\(64px, 7vw, 124px\);/s
  );
});

test("FloorPreview renders the 16x32 frame with tile metadata", () => {
  const frame = setFrameCell(createFrame("#05070a"), 3, 4, "#148cff");
  const html = renderToStaticMarkup(React.createElement(FloorPreview, { frame }));

  assert.match(html, /data-tile-x="3"/);
  assert.match(html, /data-tile-y="4"/);
  assert.match(html, /data-color="#148cff"/);
});

test("FloorPreview exposes authoritative pressure separately from remote input", () => {
  const frame = createFrame("#05070a");
  const pressedCellIndex = 4 * frame.width + 3;
  const cells = frame.cells.map((cell, index) => index === pressedCellIndex
    ? { ...cell, pressed: true }
    : cell);
  const html = renderToStaticMarkup(React.createElement(FloorPreview, {
    ariaLabel: "Suelo autoritativo de Sala",
    frame: { ...frame, cells },
    interactive: true
  }));

  assert.match(html, /aria-label="Suelo autoritativo de Sala"/);
  assert.match(
    html,
    /class="ml-floor-tile ml-floor-tile-authoritative-pressed"[^>]*data-tile-x="3"[^>]*data-tile-y="4"/
  );
  assert.match(html, /data-authoritative-pressed="true"/);
  assert.match(html, /aria-label="Baldosa 3, 4; presión física detectada"/);
  assert.match(
    styleSource,
    /\.ml-floor-tile-authoritative-pressed,\s*\.ml-floor-tile\[data-input-pressed="true"\]\s*\{[^}]*inset 0 0 0 2px rgba\(255, 74, 96, 0\.98\)[^}]*filter:\s*brightness/s,
    "physical and local input pressure must share the clear red inset border"
  );
  assert.match(
    html,
    /data-authoritative-pressed="true"[^>]*data-input-pressed="false"[^>]*aria-pressed="false"/,
    "physical pressure must not masquerade as the locally latched remote input"
  );
});

test("interactive FloorPreview has one roving keyboard stop", () => {
  const html = renderToStaticMarkup(React.createElement(FloorPreview, {
    frame: createFrame("#05070a"),
    interactive: true
  }));

  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  assert.equal((html.match(/tabindex="-1"/g) ?? []).length, 511);
});

test("FloorPreview keyboard navigation stays within the floor grid", () => {
  assert.deepEqual(floorTileAfterKeyboardNavigation({ x: 3, y: 4 }, "ArrowLeft", 16, 32), { x: 2, y: 4 });
  assert.deepEqual(floorTileAfterKeyboardNavigation({ x: 3, y: 4 }, "ArrowDown", 16, 32), { x: 3, y: 5 });
  assert.deepEqual(floorTileAfterKeyboardNavigation({ x: 0, y: 0 }, "ArrowLeft", 16, 32), { x: 0, y: 0 });
  assert.deepEqual(floorTileAfterKeyboardNavigation({ x: 15, y: 31 }, "ArrowDown", 16, 32), { x: 15, y: 31 });
  assert.deepEqual(floorTileAfterKeyboardNavigation({ x: 7, y: 4 }, "Home", 16, 32), { x: 0, y: 4 });
  assert.deepEqual(floorTileAfterKeyboardNavigation({ x: 7, y: 4 }, "End", 16, 32), { x: 15, y: 4 });
  assert.equal(floorTileAfterKeyboardNavigation({ x: 3, y: 4 }, "Enter", 16, 32), null);
});

test("FloorPreview positions tiles by coordinates instead of cell order", () => {
  const frame = setFrameCell(createFrame("#05070a"), 3, 4, "#148cff");
  const positionedCell = frame.cells[4 * frame.width + 3];
  assert.ok(positionedCell);
  const shuffledFrame = {
    ...frame,
    cells: [positionedCell, ...frame.cells.filter((cell) => cell.x !== 3 || cell.y !== 4)]
  };
  const html = renderToStaticMarkup(React.createElement(FloorPreview, { frame: shuffledFrame }));

  assert.match(html, /grid-column-start:4/);
  assert.match(html, /grid-row-start:5/);
  assert.match(html, /data-color="#148cff"/);
});

test("FloorPreview rotates the board without changing logical tile identity", () => {
  const frame = setFrameCell(createFrame("#05070a"), 3, 4, "#148cff");
  const html = renderToStaticMarkup(React.createElement(
    PlayerDisplayRuntimeProvider,
    { floorRotationDegrees: 180, paused: false },
    React.createElement(FloorPreview, { frame })
  ));

  assert.match(html, /data-floor-rotation="180"/);
  assert.match(html, /--ml-floor-cols:16/);
  assert.match(html, /--ml-floor-rows:32/);
  assert.match(
    html,
    /grid-column-start:13;grid-row-start:28[^>]*data-tile-x="3"[^>]*data-tile-y="4"/
  );
});

test("FloorPreview sideways rotation swaps the visual board dimensions", () => {
  const html = renderToStaticMarkup(React.createElement(FloorPreview, {
    frame: createFrame("#05070a"),
    rotationDegrees: 90
  }));

  assert.match(html, /data-floor-rotation="90"/);
  assert.match(html, /--ml-floor-cols:32/);
  assert.match(html, /--ml-floor-rows:16/);
  assert.match(html, /aria-colcount="32"/);
  assert.match(html, /aria-rowcount="16"/);
  assert.match(
    styleSource,
    /\.ml-frame-preview-panel \.ml-floor-preview:is\(\[data-floor-rotation="90"\], \[data-floor-rotation="270"\]\)\s*\{[^}]*height:\s*auto;[^}]*width:\s*360px;/s
  );
  assert.match(styleSource, /\.ml-floor-preview\s*\{[^}]*box-sizing:\s*border-box;/s);
});

test("FloorPreview keeps pointer hover separate from persistent focus", () => {
  assert.doesNotMatch(
    styleSource,
    /\.ml-floor-interactive \.ml-floor-tile:hover\s*,\s*\.ml-floor-interactive \.ml-floor-tile:focus-visible/,
    "pointer hover and keyboard focus must never share a visual state"
  );
  assert.match(
    styleSource,
    /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.ml-floor-interactive \.ml-floor-tile:hover/,
    "tile hover styling must require a device with real hover support"
  );
  assert.match(
    styleSource,
    /\.ml-floor-interactive \.ml-floor-tile:focus-visible\s*\{[^}]*outline:\s*2px solid rgba\(54, 217, 255, 0\.9\);[^}]*outline-offset:\s*-5px;/s,
    "the cyan keyboard focus ring must remain visibly separate from the red pressure border"
  );
  assert.doesNotMatch(styleSource, /\[aria-pressed="true"\]/, "pressure styling must use the explicit input data contract");
});

test("GameDisplayShell renders title and phase", () => {
  const html = renderToStaticMarkup(
    React.createElement(GameDisplayShell, { title: "Hello World", phase: "running" }, "body")
  );

  assert.match(html, /Hello World/);
  assert.match(html, /running/);
  assert.match(html, /data-display-root="true"/);
  assert.match(html, /data-display-containment="content"/);
});

test("GameDisplayShell replaces the live TV status while the runner is paused", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      PlayerDisplayRuntimeProvider,
      { paused: true },
      React.createElement(GameDisplayShell, { title: "Ping Pong", phase: "running" }, "body")
    )
  );

  assert.match(html, /data-paused="true"/);
  assert.match(html, /ml-status-paused/);
  assert.match(html, /En pausa/);
  assert.doesNotMatch(html, /En juego/);
});

test("PlayerReadyOverlay renders shared waiting and countdown states in Spanish", () => {
  const baseSnapshot: GameSnapshot = {
    currentGame: "test",
    label: "Test",
    phase: "waiting",
    playerCount: 2,
    players: [],
    score: 0,
    lives: -1,
    elapsedMillis: 0,
    remainingMillis: 0,
    activeTargets: 0,
    success: false,
    lastEventCue: "ready",
    lastEventMessage: "Esperando jugadores",
    readyPlayers: 1,
    requiredPlayers: 2
  };
  const waitingHtml = renderToStaticMarkup(React.createElement(PlayerReadyOverlay, { snapshot: baseSnapshot }));
  const startingHtml = renderToStaticMarkup(React.createElement(PlayerReadyOverlay, {
    snapshot: { ...baseSnapshot, phase: "starting", countdownMillis: 1_200, readyPlayers: 2 }
  }));

  assert.match(waitingHtml, /Esperando jugadores/);
  assert.match(waitingHtml, /1\/2/);
  assert.match(startingHtml, /Todos listos/);
  assert.match(startingHtml, />2<\/strong>/);
  assert.match(styleSource, /@keyframes ml-ready-ring/);
  assert.equal(
    renderToStaticMarkup(React.createElement(PlayerReadyOverlay, {
      snapshot: { ...baseSnapshot, phase: "running" }
    })),
    "",
    "the readiness overlay must leave live gameplay unobstructed"
  );
});

test("GameDisplayShell balances its brand and status rails inside a paint-contained root", () => {
  assert.match(styleSource, /--ml-header-side-width:\s*clamp\(260px, 18vw, 330px\);/);
  assert.match(
    styleSource,
    /\.ml-display-header\s*\{[^}]*grid-template-columns:\s*var\(--ml-header-side-width\) minmax\(0, 1fr\) var\(--ml-header-side-width\);/s
  );
  assert.match(
    styleSource,
    /\.ml-tv-brand,\s*\.ml-status-pill\s*\{[^}]*min-height:\s*68px;[^}]*width:\s*100%;/s
  );
  assert.match(
    styleSource,
    /\.ml-display-content\s*\{[^}]*contain:\s*layout paint;[^}]*overflow:\s*hidden;[^}]*position:\s*relative;/s,
    "absolute game content must be scoped to the shell content region"
  );
  assert.match(styleSource, /\.ml-tv-title\s*\{[^}]*border-radius:\s*var\(--ml-radius-md\);/s);
  assert.match(styleSource, /\.ml-status-pill\s*\{[^}]*border-radius:\s*var\(--ml-radius-md\);/s);
});

test("RoundStrip can render a full match path with pending rounds", () => {
  const html = renderToStaticMarkup(
    React.createElement(RoundStrip, {
      rounds: [{ index: 1, winnerIndex: 0, winnerLabel: "Red", hits: 3 }],
      totalRounds: 3
    })
  );

  assert.match(html, /1<\/strong><span>de 3/);
  assert.match(html, /R3/);
  assert.match(html, /Pendiente/);
  assert.match(html, /is-current/);
  assert.match(html, /Ronda actual/);
  assert.match(html, /3 golpes/);
});

test("RoundStrip keeps long matches focused on a visible twelve-round window", () => {
  const html = renderToStaticMarkup(
    React.createElement(RoundStrip, {
      activeCaption: "Por comenzar",
      activeLabel: "Siguiente",
      activeRound: 1,
      rounds: [],
      totalRounds: 41
    })
  );

  assert.match(html, /Rondas 1-12 de 41/);
  assert.match(html, /R1/);
  assert.match(html, /R12/);
  assert.doesNotMatch(html, /R13/);
  assert.equal((html.match(/ml-round-card /g) ?? []).length, 12);
});
