import { createPublishedLevelContent } from "@motion-levels-games/published-level-runtime/content";

import { temporada1EngineGame, temporada1GameId } from "./manifest.ts";

// This compact catalog is used only by deterministic preview/display fixtures.
// Production fallbackContent is generated from games/temporada1-niveles/content/.
type Cell = readonly [number, number, number, string?];

export const testContent = createPublishedLevelContent({
  gameId: temporada1GameId,
  engineGame: temporada1EngineGame,
  selectedLevelId: "22222222-2222-4222-8222-222222222201",
  selectedLevelSlug: "level-1",
  mode: "challenge",
  levelsPayload: [
    temporadaLevel("22222222-2222-4222-8222-222222222201", "level-1", "Temporada 1 / Nivel 1", 0),
    temporadaLevel("22222222-2222-4222-8222-222222222202", "level-2", "Temporada 1 / Nivel 2", 2)
  ],
  resultAnimationsPayload: {
    levels: [resultAnimation("game-pass", "#35d7ff", victoryCells()), resultAnimation("game-fail", "#ff2036", defeatCells())]
  }
});

function temporadaLevel(id: string, slug: string, label: string, offset: number) {
  return {
    id,
    slug,
    label,
    description: "Esquiva las líneas rojas y recoge todos los objetivos azules y morados.",
    life: 4,
    pass_score: 10,
    time_limit_seconds: 75,
    frame_tick_ms: 25,
    rules: {
      victory_condition: "collect_all",
      difficulty_changes_layout: false,
      difficulty_settings: {
        easy: { life: 5, gameplay_time_limit_seconds: 100, speed_multiplier: 0.8 },
        medium: { life: 4, gameplay_time_limit_seconds: 75, speed_multiplier: 1 },
        hard: { life: 3, gameplay_time_limit_seconds: 60, speed_multiplier: 1.25 },
        expert: { life: 2, gameplay_time_limit_seconds: 45, speed_multiplier: 1.5 }
      },
      red_floor_animation: "none",
      red_damage_grace_period: false,
      green_platform_load_animation: true,
      green_platform_load_side: "left",
      green_platform_disappear: false,
      green_platform_impact_ripple: false,
      blue_platform_turn_green: false,
      blue_platform_capture_area: false
    },
    result_animations: {
      victory_animations: ["game-pass"],
      defeat_animations: ["game-fail"]
    },
    music_ref: "Motion/canciones/Background07.mp3",
    music_volume: 0.18,
    coin_cue_ref: "Motion/sonidos/coin.wav",
    double_coin_cue_ref: "Motion/sonidos/coin.wav",
    damage_cue_ref: "Motion/sonidos/fallo.mp3",
    win_cue_ref: "Motion/sonidos/victoria.mp3",
    defeat_cue_ref: "Motion/sonidos/fallo.mp3",
    frames: [
      { r: 24, c: temporadaCells(offset, 0) },
      { r: 24, c: temporadaCells(offset, 1) },
      { r: 24, c: temporadaCells(offset, 2) }
    ]
  };
}

function temporadaCells(levelOffset: number, motionOffset: number): Cell[] {
  const cells: Cell[] = [];
  for (let y = 28; y < 32; y += 1) {
    for (let x = 3; x <= 12; x += 1) cells.push([x, y, 0, `safe-${x}-${y}`]);
  }
  for (let y = 3; y <= 26; y += 6) {
    for (let x = 5; x <= 10; x += 1) cells.push([x, y, 0, `rest-${x}-${y}`]);
  }
  const lineA = 8 + (motionOffset + levelOffset) % 3;
  const lineB = 19 - (motionOffset + levelOffset) % 3;
  for (let x = 0; x < 16; x += 1) {
    cells.push([x, lineA, 2, `laser-a-${x}`], [x, lineB, 2, `laser-b-${x}`]);
  }
  cells.push(
    [2 + levelOffset, 5, 1, `blue-a-${levelOffset}`],
    [13 - levelOffset, 24, 1, `blue-b-${levelOffset}`],
    [8, 14, 3, `purple-${levelOffset}`]
  );
  return cells;
}

function resultAnimation(slug: string, color: string, cells: Cell[]) {
  return {
    slug,
    frame_tick_ms: 50,
    tile_effects: { 0: { color } },
    frames: [{ r: 10, c: cells }, { r: 10, c: cells.map(([x, y, kind]) => [15 - x, y, kind]) }]
  };
}

function victoryCells(): Cell[] {
  const cells: Cell[] = [];
  for (let radius = 0; radius <= 7; radius += 1) {
    cells.push([7 - radius, 16, 0], [8 + radius, 16, 0], [7, 16 - radius, 0], [8, 16 + radius, 0]);
  }
  return cells.filter(([x, y]) => x >= 0 && x < 16 && y >= 0 && y < 32);
}

function defeatCells(): Cell[] {
  const cells: Cell[] = [];
  for (let y = 7; y < 25; y += 1) cells.push([5, y, 0], [10, y, 0]);
  for (let x = 5; x <= 10; x += 1) cells.push([x, 7, 0], [x, 24, 0]);
  return cells;
}
