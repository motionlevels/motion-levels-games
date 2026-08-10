import assert from "node:assert/strict";
import test from "node:test";
import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eventKey, isEventStreamAtLatest } from "../src/eventStream.ts";
import { PlaygroundStatusDock } from "../src/PlaygroundStatusDock.tsx";

const events = [
  { atMillis: 4_823, cue: "score", message: "Punto para azul" },
  { atMillis: 0, cue: "ready", message: "Esperando jugadores" }
];

test("status dock renders newest events first with consistent timestamps", () => {
  const html = renderToStaticMarkup(React.createElement(PlaygroundStatusDock, {
    activeRunSettings: [["Difficulty", "Medium"], ["Players", "Any"]],
    autoFollow: true,
    clockMillis: 4_823,
    eventStreamRef: createRef<HTMLOListElement>(),
    events,
    fps: 30,
    frameNumber: 145,
    gameLabel: "Ping Pong",
    onAutoFollowChange: () => undefined,
    onEventStreamScroll: () => undefined,
    phase: "running",
    score: 1,
    targets: 2
  }));

  assert.match(html, /00:00:04\.82/);
  assert.match(html, /aria-label="2 retained events"/);
  assert.match(html, /aria-pressed="true"/);
  assert.ok(html.indexOf("Punto para azul") < html.indexOf("Esperando jugadores"));
  assert.match(html, /Ping Pong/);
  assert.match(html, /Difficulty/);
});

test("event stream helpers own stable identity and follow threshold", () => {
  assert.equal(eventKey(events[0], 0), "4823:score:Punto para azul:0");
  assert.notEqual(eventKey(events[0], 0), eventKey(events[0], 1));
  assert.equal(isEventStreamAtLatest(0), true);
  assert.equal(isEventStreamAtLatest(1), true);
  assert.equal(isEventStreamAtLatest(1.01), false);
});

test("status dock exposes an explicit empty and paused-follow state", () => {
  const html = renderToStaticMarkup(React.createElement(PlaygroundStatusDock, {
    activeRunSettings: [],
    autoFollow: false,
    clockMillis: 0,
    eventStreamRef: createRef<HTMLOListElement>(),
    events: [],
    fps: 30,
    frameNumber: 0,
    gameLabel: "Arkanoid",
    onAutoFollowChange: () => undefined,
    onEventStreamScroll: () => undefined,
    phase: "waiting",
    score: 0,
    targets: 0
  }));

  assert.match(html, /No events yet/);
  assert.match(html, /aria-label="Enable event auto-follow"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /Event auto-follow paused/);
});
