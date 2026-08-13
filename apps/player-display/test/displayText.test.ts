import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { gameTitleES, levelLabelES, playerLifecycleLabelES } from "../src/displayText.ts";

describe("gameTitleES", () => {
  it("uses native runtime ids instead of level labels", () => {
    assert.equal(gameTitleES("memory-lights", "Nivel 3"), "Reto de memoria");
    assert.equal(gameTitleES("authored-memoria-v2", "Nivel 7"), "Memoria v2");
  });

  it("uses catalog labels for level games instead of local id exceptions", () => {
    assert.equal(gameTitleES("parkour", "Parkour"), "Parkour");
    assert.equal(gameTitleES("temporada1-niveles", "Temporada 1"), "Temporada 1");
    assert.equal(gameTitleES("parkour", "level-1-2"), "parkour");
  });

  it("keeps custom labels for unknown non-level games", () => {
    assert.equal(gameTitleES("custom-game", "Juego personalizado"), "Juego personalizado");
  });

  it("does not promote level labels to titles for UUID level games", () => {
    assert.equal(gameTitleES("8b20d467-b2d1-4d62-9ef3-8455adb61393", "Temporada 1 / Nivel 1"), "Juego de niveles");
    assert.equal(gameTitleES("8b20d467-b2d1-4d62-9ef3-8455adb61393", "Parkour"), "Parkour");
  });
});

describe("displayGameTitle wiring", () => {
  it("does not hard-code UUID level games as Temporada 1", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /return "Temporada 1";/);
  });

  it("labels the authoritative lifecycle instead of inventing a local phase", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    assert.match(source, /eyebrow:\s*playerLifecycleLabelES\(status\.lifecycle\),/);
    assert.doesNotMatch(source, /eyebrow:\s*levelGame \?/);
    assert.match(source, /<span>\{model\.eyebrow\}<\/span>/);
  });

  it("does not render event message footer bars", () => {
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const cssSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

    assert.doesNotMatch(appSource, /arcade-bottom|arcade-event|event-strip|showFooterEvent/);
    assert.doesNotMatch(cssSource, /\.arcade-bottom|\.arcade-event|\.event-strip|has-event/);
  });

  it("keeps the countdown metric in Spanish", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    assert.match(source, /label: "Cuenta atrás"/);
    assert.doesNotMatch(source, /label: "Countdown"/);
  });
});

describe("playerLifecycleLabelES", () => {
  it("reflects pause and terminal state in Spanish", () => {
    assert.equal(playerLifecycleLabelES("running"), "Juego en curso");
    assert.equal(playerLifecycleLabelES("paused"), "Juego pausado");
    assert.equal(playerLifecycleLabelES("finished"), "Juego terminado");
    assert.equal(playerLifecycleLabelES("idle"), "Juego seleccionado");
  });
});

describe("arcade display reference styling", () => {
  it("generates level and code displays through the same gold-standard shell", () => {
    const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

    assert.match(source, /function createArcadeDisplayModel\(status: DisplayStatus, connected: boolean, error: string\): ArcadeDisplayModel/);
    assert.match(source, /function ArcadeDisplayShell\(\{ model, children \}: \{ model: ArcadeDisplayModel; children: ReactNode \}\)/);
    assert.match(source, /<ArcadeDisplayShell model=\{displayModel\}>/);
    assert.match(source, /levelGame \? "level-display level-points-display" : ""/);
    assert.match(source, /!levelGame && !memoryGame \? "reference-brand" : ""/);
    assert.equal(source.match(/<header className="arcade-top">/g)?.length, 1);
  });

  it("keeps code-style arcade games close to the level display brand reference", () => {
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const cssSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

    assert.match(appSource, /!levelGame && !memoryGame \? "reference-brand" : ""/);
    assert.match(appSource, /rootClassName: rootClasses\.filter\(Boolean\)\.join\(" "\)/);
    assert.match(cssSource, /\.level-points-display\.level-display \.arcade-top\s*\{[^}]*grid-template-columns:\s*minmax\(440px, 0\.74fr\) minmax\(700px, 1\.36fr\) minmax\(440px, 0\.74fr\);/);
    assert.match(cssSource, /\.arcade-display\.reference-brand \.arcade-brand-panel/);
    assert.match(cssSource, /\.arcade-display\.reference-brand \.arcade-brand-mark\s*\{[^}]*width:\s*104px;/);
  });

  it("renders Memoria v2 with its own team-level HUD", () => {
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const cssSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

    assert.match(appSource, /function MemoriaV2Board/);
    assert.match(appSource, /function isMemoriaV2Game/);
    assert.match(appSource, /memoriaV2Game \? "memoria-v2-display" : ""/);
    assert.match(appSource, /case "memoria-v2":/);
    assert.match(appSource, /value=\{<HeartMeter model=\{\{ lives: status\.lives < 0 \? 3 : status\.lives, slots: 3 \}\} \/>/);
    assert.match(cssSource, /\.memoria-v2-board/);
    assert.doesNotMatch(cssSource, /\.memoria-v2-hearts/);
  });
});

describe("arcade display readability", () => {
  it("keeps player and metric typography large enough for venue displays", () => {
    const cssSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

    assert.match(cssSource, /\.arcade-metric span,[\s\S]*?font-size:\s*1\.28rem;/);
    assert.match(cssSource, /\.arcade-metric strong\s*\{[^}]*font-size:\s*5rem;/);
    assert.match(cssSource, /\.arcade-player-name span\s*\{[^}]*font-size:\s*2\.4rem;/);
    assert.match(cssSource, /\.arcade-player-card > strong\s*\{[^}]*font-size:\s*7\.25rem;/);
    assert.match(cssSource, /\.memory-player-score__name span\s*\{[^}]*font-size:\s*1\.72rem;/);
  });
});

describe("kiosk preview viewport", () => {
  it("can lock the display app to the fixed TV design viewport for scaled embeds", () => {
    const source = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
    assert.match(source, /function fixedKioskPreviewViewport\(\)/);
    assert.match(source, /if \(fixedKioskPreviewViewport\(\)\) return 1;/);
    assert.match(source, /get\("kioskViewport"\) === `\$\{kioskDesignWidth\}x\$\{kioskDesignHeight\}`/);
  });
});

describe("levelLabelES", () => {
  it("normalizes human and internal level labels", () => {
    assert.equal(levelLabelES("Nivel 2"), "Nivel 2");
    assert.equal(levelLabelES("level-1-2"), "Nivel 2");
    assert.equal(levelLabelES("Temporada 1 / Nivel 1"), "Nivel 1");
    assert.equal(levelLabelES("temporada1-level-20"), "Nivel 20");
  });

  it("ignores non-level labels", () => {
    assert.equal(levelLabelES("Parkour"), "");
    assert.equal(levelLabelES("Reto de memoria"), "");
  });
});
