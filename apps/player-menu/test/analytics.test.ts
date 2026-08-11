import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyticsSafeProperties } from "../src/analytics.ts";

describe("player-menu analytics privacy", () => {
  it("removes player and team identity while retaining operational context", () => {
    assert.deepEqual(
      analyticsSafeProperties({
        game: "lava",
        player_count: 2,
        player_name: "Ana",
        players: [{ label: "Ana" }, { label: "Bea" }],
        team_name: "Equipo privado",
      }),
      {
        game: "lava",
        player_count: 2,
      },
    );
  });

  it("keeps automatic DOM analytics disabled and masks name-bearing UI", () => {
    const analyticsSource = readFileSync(new URL("../src/analytics.ts", import.meta.url), "utf8");
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

    assert.match(analyticsSource, /autocapture: false/);
    assert.match(analyticsSource, /capture_heatmaps: false/);
    assert.match(appSource, /className={`player ph-no-capture/);
    assert.match(appSource, /className="modal-body ph-mask"/);
  });
});
