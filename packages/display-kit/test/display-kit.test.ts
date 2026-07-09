import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFrame, setFrameCell } from "@motion-levels-games/game-sdk";
import { FloorPreview, GameDisplayShell, HeartMeter, MetricPanel, RoundStrip } from "../src/index.tsx";

const styleSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

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

test("HeartMeter renders filled and empty life slots", () => {
  const html = renderToStaticMarkup(React.createElement(HeartMeter, { lives: 2, slots: 3 }));

  assert.match(html, /ml-heart-filled/);
  assert.match(html, /ml-heart-empty/);
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
  const shuffledFrame = {
    ...frame,
    cells: [frame.cells[4 * frame.width + 3], ...frame.cells.filter((cell) => cell.x !== 3 || cell.y !== 4)]
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
    React.createElement(GameDisplayShell, { title: "Example Catch", phase: "running" }, "body")
  );

  assert.match(html, /Example Catch/);
  assert.match(html, /running/);
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
