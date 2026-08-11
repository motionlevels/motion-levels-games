import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as duelo from "@motion-levels-games/duelo";
import type {
  JugarCatalogRenderer,
  JugarCatalogRenderProps
} from "../src/catalog.ts";
import type { GameEntry } from "../src/contracts.ts";
import {
  GamePickerFrame,
  projectCatalogEntries
} from "../src/ui/GamePicker.tsx";

const entry: GameEntry = {
  manifest: duelo.manifest,
  load: async () => {
    throw new Error("Catalog tests must not load the game runtime");
  }
};

test("host catalog receives only serialisable identity and manifest data", () => {
  const [catalogEntry] = projectCatalogEntries([entry]);
  assert.ok(catalogEntry);
  assert.deepEqual(Object.keys(catalogEntry), ["id", "manifest"]);
  assert.equal(catalogEntry.id, duelo.manifest.id);
  assert.equal(catalogEntry.manifest, duelo.manifest);
  assert.equal("load" in catalogEntry, false);
  assert.equal("contentSource" in catalogEntry, false);
  assert.doesNotThrow(() => JSON.stringify(catalogEntry));
});

test("custom selection opens Jugar's existing setup dialog and close returns to the custom picker", () => {
  let selected: GameEntry | null = null;
  let catalogProps: JugarCatalogRenderProps | undefined;

  const HostCatalog: JugarCatalogRenderer = (props) => {
    catalogProps = props;
    const [marker] = useState("host-catalog");
    return createElement("section", { "data-catalog": marker }, props.entries[0]?.manifest.label);
  };

  const onSelect = (id: string) => {
    selected = id === entry.manifest.id ? entry : null;
  };
  const onCloseGame = () => {
    selected = null;
  };
  const render = () => renderToStaticMarkup(createElement(GamePickerFrame, {
    catalogEntries: projectCatalogEntries([entry]),
    catalogRenderer: HostCatalog,
    character: { id: "motion-explorer", label: "Explorer" },
    characterOpen: false,
    onCharacterChange: () => undefined,
    onCloseCharacter: () => undefined,
    onCloseGame,
    onOpenCharacterPicker: () => undefined,
    onPlay: () => undefined,
    onSelect,
    selected
  }));

  const pickerHtml = render();
  assert.match(pickerHtml, /data-catalog="host-catalog"/u);
  assert.doesNotMatch(pickerHtml, /role="dialog"/u);
  assert.ok(catalogProps);

  catalogProps.onSelect(entry.manifest.id);
  const setupHtml = render();
  assert.match(setupHtml, /data-catalog="host-catalog"/u);
  assert.match(setupHtml, /role="dialog"/u);
  assert.match(setupHtml, /Jugar ahora/u);
  assert.match(setupHtml, new RegExp(entry.manifest.label, "u"));

  onCloseGame();
  const returnedHtml = render();
  assert.match(returnedHtml, /data-catalog="host-catalog"/u);
  assert.doesNotMatch(returnedHtml, /role="dialog"/u);
});

test("default catalog remains the fallback and play exit returns through the picker branch", async () => {
  const html = renderToStaticMarkup(createElement(GamePickerFrame, {
    catalogEntries: projectCatalogEntries([entry]),
    character: { id: "motion-explorer", label: "Explorer" },
    characterOpen: false,
    onCharacterChange: () => undefined,
    onCloseCharacter: () => undefined,
    onCloseGame: () => undefined,
    onOpenCharacterPicker: () => undefined,
    onPlay: () => undefined,
    onSelect: () => undefined,
    selected: null
  }));
  assert.match(html, /Juegos disponibles/u);
  assert.match(html, /Personaje/u);
  assert.match(html, new RegExp(entry.manifest.label, "u"));

  const appSource = await readFile(new URL("../src/MinigameApp.tsx", import.meta.url), "utf8");
  assert.match(appSource, /handleExit = useCallback\(\(\) => setScreen\(\{ kind: "picker" \}\)/u);
  assert.match(appSource, /catalogRenderer=\{catalogRenderer\}/u);
});
