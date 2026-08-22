import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const gamesRoot = path.join(repoRoot, "games");
const displayKitStyles = path.join(repoRoot, "packages/display-kit/src/styles.css");
const displayKitComponents = path.join(repoRoot, "packages/display-kit/src/index.tsx");

test("display-kit owns only ml-namespaced shared styles", async () => {
  const [styles, components, gameEntries] = await Promise.all([
    readFile(displayKitStyles, "utf8"),
    readFile(displayKitComponents, "utf8"),
    readdir(gamesRoot, { withFileTypes: true })
  ]);
  const classNames = [...styles.matchAll(/(?<![\w-])\.([a-z][\w-]*)/giu)].map((match) => match[1]!);
  const nonSharedClasses = [...new Set(classNames.filter(
    (className) => !className.startsWith("ml-") && !className.startsWith("is-")
  ))].sort();

  assert.deepEqual(
    nonSharedClasses,
    [],
    `display-kit CSS must not own game or app selectors: ${nonSharedClasses.join(", ")}`
  );

  for (const entry of gameEntries.filter((candidate) => candidate.isDirectory())) {
    const gameToken = new RegExp(`\\b${escapeRegExp(entry.name)}(?:-|\\b)`, "iu");
    assert.doesNotMatch(styles, gameToken, `display-kit CSS must not mention game slug ${entry.name}`);
    assert.doesNotMatch(components, gameToken, `display-kit components must not mention game slug ${entry.name}`);
  }
});

test("game displays never inject stylesheet strings into React markup", async () => {
  const gameEntries = (await readdir(gamesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory());

  for (const entry of gameEntries) {
    const sourcePath = path.join(gamesRoot, entry.name, "src/display.tsx");
    const source = await readFile(sourcePath, "utf8");

    assert.doesNotMatch(source, /<style(?:\s|>)/iu, `${entry.name} must import a colocated display.css file`);
    assert.doesNotMatch(
      source,
      /const\s+\w*styles?\s*=\s*`/iu,
      `${entry.name} must not embed CSS in a template literal`
    );
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
