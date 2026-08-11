import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as duelo from "@motion-levels-games/duelo";
import type {
  JugarCatalogPresentation,
  JugarCatalogRenderer,
  JugarCatalogRenderProps
} from "../src/catalog.ts";
import type { GameEntry } from "../src/contracts.ts";
import {
  GamePickerFrame,
  projectCatalogEntries,
  resolveCatalogSelection,
  resolveGameDialogPresentation,
  type JugarCatalogSelection
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

test("custom presentation opens Jugar's existing dialog without replacing canonical selection", () => {
  let selected: JugarCatalogSelection | null = null;
  let catalogProps: JugarCatalogRenderProps | undefined;

  const HostCatalog: JugarCatalogRenderer = (props) => {
    catalogProps = props;
    const [marker] = useState("host-catalog");
    return createElement("section", { "data-catalog": marker }, props.entries[0]?.id);
  };

  const onSelect = (id: string, presentation?: JugarCatalogPresentation) => {
    selected = resolveCatalogSelection([entry], id, presentation);
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

  const hostRules = ["Regla publicada", "Mantén el equilibrio"];
  const hostPresentation = {
    label: "Duelo renombrado",
    color: "#ff33aa",
    category: "Torneo escolar",
    modeLabel: "Rondas editadas",
    durationLabel: "12 minutos",
    rules: hostRules
  } satisfies JugarCatalogPresentation;
  catalogProps.onSelect(entry.manifest.id, hostPresentation);
  const selectedAfterHostCallback: JugarCatalogSelection | null = currentSelection();
  assert.ok(selectedAfterHostCallback);
  assert.equal(selectedAfterHostCallback.entry, entry);
  assert.equal(selectedAfterHostCallback.entry.manifest.id, duelo.manifest.id);
  assert.notEqual(selectedAfterHostCallback.presentation, hostPresentation);
  assert.notEqual(selectedAfterHostCallback.presentation?.rules, hostRules);
  hostRules.push("Cambio posterior del host");

  const setupHtml = render();
  assert.match(setupHtml, /data-catalog="host-catalog"/u);
  assert.match(setupHtml, /role="dialog"/u);
  assert.match(setupHtml, /Jugar ahora/u);
  assert.match(setupHtml, /Duelo renombrado/u);
  assert.match(setupHtml, /Torneo escolar/u);
  assert.match(setupHtml, /Rondas editadas · 12 minutos/u);
  assert.match(setupHtml, /Regla publicada/u);
  assert.match(setupHtml, /Mantén el equilibrio/u);
  assert.match(setupHtml, /--accent:#ff33aa/u);
  assert.doesNotMatch(setupHtml, /Cambio posterior del host/u);

  onCloseGame();
  const returnedHtml = render();
  assert.match(returnedHtml, /data-catalog="host-catalog"/u);
  assert.doesNotMatch(returnedHtml, /role="dialog"/u);

  function currentSelection(): JugarCatalogSelection | null {
    return selected;
  }
});

test("presentation fallback and invalid host ids cannot change the manifest-owned entry", () => {
  assert.equal(resolveCatalogSelection([entry], "not-a-canonical-id", {
    label: "No debe abrirse"
  }), null);

  const selection = resolveCatalogSelection([entry], entry.manifest.id, {
    label: "  Nombre publicado  ",
    rules: ["  Primera regla  ", "   "]
  });
  assert.ok(selection);
  assert.equal(selection.entry, entry);
  assert.deepEqual(resolveGameDialogPresentation(
    selection.entry.manifest,
    selection.presentation
  ), {
    label: "Nombre publicado",
    color: entry.manifest.catalog.color,
    category: entry.manifest.catalog.category,
    modeLabel: entry.manifest.catalog.modeLabel,
    durationLabel: entry.manifest.catalog.durationLabel,
    rules: ["Primera regla"]
  });
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

test("Jugar's base button reset has zero specificity so host button classes win", async () => {
  const styles = await readFile(new URL("../src/minigame.css", import.meta.url), "utf8");
  assert.match(styles, /:where\(\.mlg\) :where\(button\)\s*\{/u);
  assert.doesNotMatch(styles, /\n\s*& button\s*\{/u);
  assert.doesNotMatch(styles, /\.mlg\s+button\s*\{/u);
});
