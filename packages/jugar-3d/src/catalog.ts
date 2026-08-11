import type { ComponentType } from "react";
import type { GameManifest } from "@motion-levels-games/game-sdk";

/**
 * The serialisable catalog projection exposed to a host picker. Runtime
 * loaders and content providers intentionally remain private to Jugar.
 */
export type JugarCatalogEntry = Readonly<{
  id: string;
  manifest: GameManifest;
}>;

export type JugarCatalogCharacter = Readonly<{
  id: string;
  label: string;
}>;

export type JugarCatalogRenderProps = Readonly<{
  entries: readonly JugarCatalogEntry[];
  character: JugarCatalogCharacter;
  onSelect(id: string): void;
  onOpenCharacterPicker(): void;
}>;

/** A component boundary so host catalog implementations may safely use hooks. */
export type JugarCatalogRenderer = ComponentType<JugarCatalogRenderProps>;
