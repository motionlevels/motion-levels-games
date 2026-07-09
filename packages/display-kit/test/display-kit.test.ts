import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFrame, setFrameCell } from "@motion-levels-games/game-sdk";
import { FloorPreview, GameDisplayShell, HeartMeter, MetricPanel, RoundStrip } from "../src/index.tsx";

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

test("GameDisplayShell renders title and phase", () => {
  const html = renderToStaticMarkup(
    React.createElement(GameDisplayShell, { title: "Example Catch", phase: "running" }, "body")
  );

  assert.match(html, /Example Catch/);
  assert.match(html, /running/);
});

test("RoundStrip can render a full match path with pending rounds", () => {
  const html = renderToStaticMarkup(
    React.createElement(RoundStrip, {
      rounds: [{ index: 1, winnerIndex: 0, winnerLabel: "Red", hits: 3 }],
      totalRounds: 3
    })
  );

  assert.match(html, /1\/3/);
  assert.match(html, /#3/);
  assert.match(html, /Pending/);
});
