import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFrame, setFrameCell, type GameSnapshot } from "@motion-levels-games/game-sdk";
import {
  FloorPreview,
  FramePreviewPanel,
  GameDisplayShell,
  LivesMeter,
  MetricPanel,
  MetricRow,
  PlayerDisplayRuntimeProvider,
  PlayerReadyOverlay,
  PlayerScorePanel,
  RoundStrip,
  VersusScoreboard
} from "../src/index.tsx";

const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const componentSource = readFileSync(new URL("../src/index.tsx", import.meta.url), "utf8");

test("Ping Pong motion is namespaced and honors reduced motion", () => {
  assert.match(styleSource, /\.ping-pong-rally-lane/);
  assert.match(styleSource, /\.ping-pong-ball-trail/);
  assert.match(styleSource, /@keyframes pingPongScorePop/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styleSource, /\.ping-pong-display \*/);
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
  assert.equal((preview.match(/data-tile-x=/g) ?? []).length, 512);
});

test("LivesMeter renders red remaining hearts and gray lost hearts", () => {
  const html = renderToStaticMarkup(React.createElement(LivesMeter, { lives: 2, maxLives: 3 }));

  assert.match(html, /aria-label="2 de 3 vidas restantes"/);
  assert.equal((html.match(/data-life-state="remaining"/g) ?? []).length, 2);
  assert.equal((html.match(/data-life-state="lost"/g) ?? []).length, 1);
  assert.equal((html.match(/♥/g) ?? []).length, 3, "lost lives must remain filled heart shapes");
  assert.match(styleSource, /\.ml-life-heart\.is-remaining\s*\{[^}]*color:\s*#ff2036;/s);
  assert.match(styleSource, /\.ml-life-heart\.is-lost\s*\{[^}]*color:\s*#566171;/s);
});

test("LivesMeter owns calm idle and life-change motion", () => {
  assert.match(componentSource, /const previousLivesRef = useRef\(remainingLives\)/);
  assert.match(componentSource, /lifeChange\.to > lifeChange\.from[\s\S]*?"is-regained"[\s\S]*?"is-losing"/);
  assert.match(componentSource, /data-life-change=\{changeClass \|\| undefined\}/);
  assert.match(styleSource, /\.ml-life-heart-glyph\s*\{[^}]*animation:\s*ml-heart-pulse 3\.4s/s);
  assert.match(styleSource, /\.ml-life-heart\.is-losing\s*\{[^}]*animation:\s*ml-life-lost 900ms/s);
  assert.match(styleSource, /\.ml-life-heart\.is-regained\s*\{[^}]*animation:\s*ml-life-regained 1s/s);
  assert.match(styleSource, /@keyframes ml-heart-pulse/);
  assert.match(styleSource, /@keyframes ml-life-lost/);
  assert.match(styleSource, /@keyframes ml-life-regained/);
  assert.match(
    styleSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ml-life-heart,[\s\S]*?\.ml-life-heart-glyph\s*\{\s*animation:\s*none;/,
    "heart motion must honor reduced-motion preferences"
  );
});

test("Hola Mundo result motion is distinct and honors reduced motion", () => {
  assert.match(styleSource, /\.hello-world-display\.is-result-win \.ml-solo-message\s*\{[^}]*helloWorldWinGlow/s);
  assert.match(styleSource, /\.hello-world-display\.is-result-lose \.ml-solo-message\s*\{[^}]*helloWorldLosePulse/s);
  assert.match(styleSource, /@keyframes helloWorldResultEnter/);
  assert.match(
    styleSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.hello-world-display\.is-result-win[\s\S]*?animation:\s*none;/
  );
});

test("primary solo metrics use distance-readable typography", () => {
  assert.match(
    styleSource,
    /\.ml-solo-number-row \.ml-metric-value\s*\{[^}]*font-size:\s*clamp\(136px, 8\.2vw, 164px\);/s
  );
  assert.match(
    styleSource,
    /\.ml-solo-number-row \.ml-life-heart\s*\{[^}]*font-size:\s*clamp\(116px, 6\.8vw, 136px\);/s
  );
});

test("FloorPreview renders the 16x32 frame with tile metadata", () => {
  const frame = setFrameCell(createFrame("#05070a"), 3, 4, "#148cff");
  const html = renderToStaticMarkup(React.createElement(FloorPreview, { frame }));

  assert.match(html, /data-tile-x="3"/);
  assert.match(html, /data-tile-y="4"/);
  assert.match(html, /data-color="#148cff"/);
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
});

test("GameDisplayShell renders title and phase", () => {
  const html = renderToStaticMarkup(
    React.createElement(GameDisplayShell, { title: "Hello World", phase: "running" }, "body")
  );

  assert.match(html, /Hello World/);
  assert.match(html, /running/);
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

test("GameDisplayShell balances its brand and status rails", () => {
  assert.match(styleSource, /--ml-header-side-width:\s*360px;/);
  assert.match(
    styleSource,
    /\.ml-display-header\s*\{[^}]*grid-template-columns:\s*var\(--ml-header-side-width\) minmax\(0, 1fr\) var\(--ml-header-side-width\);/s
  );
  assert.match(
    styleSource,
    /\.ml-tv-brand,\s*\.ml-status-pill\s*\{[^}]*min-height:\s*76px;[^}]*width:\s*100%;/s
  );
  assert.match(
    styleSource,
    /\.ml-status-pill\s*\{[^}]*clip-path:\s*polygon\(4% 0, 100% 0, 100% 100%, 4% 100%, 0 50%\);/s,
    "the status rail must mirror the brand rail toward the title"
  );
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
