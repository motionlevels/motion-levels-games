import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lifeMeterModel, teamLivesFromPlayers } from "../src/lifeMeter.ts";

describe("player menu life meter", () => {
  it("keeps the starting slot count when a life is lost", () => {
    const full = lifeMeterModel(6, null, 0);
    assert.equal(full.slots, 6);
    assert.equal(full.lives, 6);
    assert.deepEqual(full.lostIndexes, []);

    const afterLoss = lifeMeterModel(5, full.lives, full.slots);
    assert.equal(afterLoss.slots, 6);
    assert.equal(afterLoss.lives, 5);
    assert.deepEqual(afterLoss.lostIndexes, [5]);
  });

  it("marks every newly emptied heart when multiple lives are lost between polls", () => {
    const afterLoss = lifeMeterModel(3, 6, 6);
    assert.equal(afterLoss.slots, 6);
    assert.deepEqual(afterLoss.lostIndexes, [3, 4, 5]);
  });

  it("uses the shared team lives from player snapshots without summing duplicate shared lives", () => {
    assert.equal(teamLivesFromPlayers([
      { lives: 6 },
      { lives: 6 },
      { lives: 6 },
    ]), 6);
    assert.equal(teamLivesFromPlayers([
      { lives: -1 },
      { lives: -1 },
    ]), -1);
    assert.equal(teamLivesFromPlayers([]), null);
  });

  it("wires the active game screen to fixed heart slots and lost-life animation styles", () => {
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const cssSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

    assert.match(appSource, /teamLivesFromPlayers\(status\?\.players\)/);
    assert.match(appSource, /lifeMeterModel\(currentLives, previousLifeMeter\.lives, previousLifeMeter\.slots\)/);
    assert.match(appSource, /className=\{`active-life-heart \$\{filled \? "filled" : "empty"\} \$\{lost \? "lost" : ""\}`\}/);
    assert.match(cssSource, /grid-template-columns: repeat\(var\(--life-slots\), minmax\(0, 1fr\)\)/);
    assert.match(cssSource, /\.active-life-heart\.empty \{[\s\S]*animation: activeLifeLost 720ms/);
    assert.match(cssSource, /\.active-life-heart\.lost/);
    assert.match(cssSource, /@keyframes activeLifeLost/);
  });
});
