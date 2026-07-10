import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameConfigVar } from "@motion-levels-games/game-sdk";
import { GameConfigControl } from "../src/GameConfigControl.tsx";

function renderControl(configVar: GameConfigVar): string {
  return renderToStaticMarkup(React.createElement(GameConfigControl, {
    configVar,
    onChange: () => undefined,
    value: configVar.default
  }));
}

test("configuration controls expose player-menu availability without hiding internal settings", () => {
  const playerSetting = renderControl({
    key: "points_to_win",
    label: "Points to win",
    playerFacing: true,
    type: "int",
    default: 5,
    min: 1,
    max: 21
  });
  const internalSetting = renderControl({
    key: "initial_speed",
    label: "Initial speed",
    playerFacing: false,
    type: "float",
    default: 5.75,
    min: 1,
    max: 10
  });

  assert.match(playerSetting, /is-player-facing/);
  assert.match(playerSetting, />Player</);
  assert.match(internalSetting, /is-internal/);
  assert.match(internalSetting, />Internal</);
  assert.match(internalSetting, /Initial speed/);
});
