import { createPublishedLevelContent } from "@motion-levels-games/published-level-runtime/content";

import { parkourEngineGame, parkourGameId } from "./manifest.ts";

// This compact catalog is used only by deterministic preview/display fixtures.
// Production fallbackContent is generated from games/parkour/content/.
type Cell = readonly [number, number, number, string?];

export const testContent = createPublishedLevelContent({
  gameId: parkourGameId,
  engineGame: parkourEngineGame,
  selectedLevelId: "11111111-1111-4111-8111-111111111101",
  selectedLevelSlug: "level-1",
  mode: "challenge",
  levelsPayload: [
    parkourLevel("11111111-1111-4111-8111-111111111101", "level-1", "Parkour / Nivel 1", 0),
    parkourLevel("11111111-1111-4111-8111-111111111102", "level-2", "Parkour / Nivel 2", 2)
  ],
  resultAnimationsPayload: {
    levels: [resultAnimation("game-pass", "#00ff48", victoryCells()), resultAnimation("game-fail", "#ff2036", defeatCells())]
  }
});

function parkourLevel(id: string, slug: string, label: string, shift: number) {
  return {
    id,
    slug,
    label,
    description: "Cruza la lava por las plataformas verdes y captura la plataforma azul.",
    life: 3,
    pass_score: 3,
    time_limit_seconds: 0,
    frame_tick_ms: 25,
    rules: {
      victory_condition: "score_at_least",
      difficulty_changes_layout: true,
      difficulty_settings: {
        easy: { life: 5, speed_multiplier: 0.8 },
        medium: { life: 3, speed_multiplier: 1 },
        hard: { life: 2, speed_multiplier: 1.3 }
      },
      red_floor_animation: "parkour_lava",
      red_damage_grace_period: false,
      green_platform_load_animation: true,
      green_platform_load_side: "left",
      green_platform_disappear: true,
      green_platform_impact_ripple: true,
      blue_platform_turn_green: true,
      blue_platform_capture_area: true
    },
    result_animations: {
      victory_animations: ["game-pass"],
      defeat_animations: ["game-fail"]
    },
    music_ref: "Motion/canciones/Background07.mp3",
    music_volume: 0.18,
    coin_cue_ref: "Motion/sonidos/coin.wav",
    damage_cue_ref: "Motion/sonidos/fallo.mp3",
    win_cue_ref: "Motion/sonidos/victoria.mp3",
    defeat_cue_ref: "Motion/sonidos/fallo.mp3",
    frames: [
      { r: 100, c: parkourCells(shift, 0) },
      { r: 100, c: parkourCells(shift, 1) }
    ]
  };
}

function parkourCells(levelShift: number, motionShift: number): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 16; x += 1) cells.push([x, y, 2, `lava-${x}-${y}`]);
  }
  for (let y = 28; y < 32; y += 1) {
    for (let x = 5; x <= 10; x += 1) cells.push([x, y, 0, `start-${x}-${y}`]);
  }
  const islands = [23, 18, 13, 9].map((y, index) => ({
    x: 3 + (index % 2) * 6 + ((motionShift + levelShift) % 2),
    y: y - levelShift
  }));
  for (const [index, island] of islands.entries()) {
    for (let y = island.y; y <= island.y + 1; y += 1) {
      for (let x = island.x; x <= island.x + 3; x += 1) cells.push([x, y, 0, `island-${index}-${x}-${y}`]);
    }
  }
  const targetY = Math.max(2, 5 - levelShift);
  for (let x = 7; x <= 9; x += 1) cells.push([x, targetY, 1, `goal-${levelShift}-${x}`]);
  return cells;
}

function resultAnimation(slug: string, color: string, cells: Cell[]) {
  return {
    slug,
    frame_tick_ms: 50,
    tile_effects: { 0: { color } },
    frames: [{ r: 12, c: cells }, { r: 12, c: cells.map(([x, y, kind]) => [15 - x, 31 - y, kind]) }]
  };
}

function victoryCells(): Cell[] {
  const cells: Cell[] = [];
  for (let x = 0; x < 16; x += 1) cells.push([x, 0, 0], [x, 31, 0]);
  for (let y = 1; y < 31; y += 1) cells.push([0, y, 0], [15, y, 0]);
  for (let step = 0; step < 8; step += 1) cells.push([4 + step, 12 + step, 0], [11 - step, 12 + step, 0]);
  return cells;
}

function defeatCells(): Cell[] {
  const cells: Cell[] = [];
  for (let step = 0; step < 16; step += 1) cells.push([step, 8 + step, 0], [15 - step, 8 + step, 0]);
  return cells;
}
