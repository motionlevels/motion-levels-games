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

/**
 * Optional host-owned copy for Jugar's setup dialog. These fields are purely
 * presentational: the selected catalog id still resolves the canonical game
 * entry, whose manifest owns mechanics, runtime loading and run identity.
 */
export type JugarCatalogPresentation = Readonly<{
  label?: string;
  color?: string;
  category?: string;
  modeLabel?: string;
  durationLabel?: string;
  rules?: readonly string[];
}>;

export type JugarCatalogRenderProps = Readonly<{
  entries: readonly JugarCatalogEntry[];
  character: JugarCatalogCharacter;
  onSelect(id: string, presentation?: JugarCatalogPresentation): void;
  onOpenCharacterPicker(): void;
}>;

/** A component boundary so host catalog implementations may safely use hooks. */
export type JugarCatalogRenderer = ComponentType<JugarCatalogRenderProps>;
