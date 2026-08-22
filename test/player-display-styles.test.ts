import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const gameStyles = [
  ["animations", "animation"],
  ["equilibrio", "equilibrio"],
  ["estela", "estela"],
  ["guardianes", "guardianes"],
  ["pulso", "pulso"],
  ["suelo-seguro", "suelo-seguro"],
  ["tetris", "tetris"],
  ["tira-soga", "tira-soga"]
] as const;

test("game-specific display styles are colocated, imported, and namespaced", async () => {
  for (const [game, namespace] of gameStyles) {
    const sourceRoot = path.join(repoRoot, "games", game, "src");
    const [displaySource, styleSource] = await Promise.all([
      readFile(path.join(sourceRoot, "display.tsx"), "utf8"),
      readFile(path.join(sourceRoot, "display.css"), "utf8")
    ]);

    assert.match(
      displaySource,
      /if \(typeof document !== "undefined"\) void import\("\.\/display\.css"\);/u,
      `${game} does not import its display stylesheet through the browser-safe boundary`
    );
    assert.doesNotMatch(displaySource, /<style\b/u, `${game} still renders an inline style element`);
    assert.match(styleSource, new RegExp(`\\.${namespace}-display\\b`, "u"), `${game} has no namespaced display root`);
    assert.doesNotMatch(styleSource, /(?:^|\})\s*\.ml-/u, `${game} overrides a shared primitive without its game namespace`);
  }
});

test("the playground eagerly collects colocated game display styles", async () => {
  const source = await readFile(path.join(repoRoot, "apps/playground/src/main.tsx"), "utf8");
  assert.match(source, /import\.meta\.glob\("\.\.\/\.\.\/\.\.\/games\/\*\/src\/display\.css", \{ eager: true \}\)/u);
});
