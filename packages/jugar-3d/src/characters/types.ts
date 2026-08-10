import type { ComponentType } from "react";

import type { Avatar } from "../core/avatar.ts";
import type { GameSession } from "../core/session.ts";

export type CharacterProps = {
  session: GameSession;
  avatar: Avatar;
  /** Host-resolved asset URL; omitted by procedural characters. */
  modelUrl?: string;
};

/** Attribution for a third-party model, shown in the picker to satisfy CC-BY. */
export type CharacterCredit = {
  author: string;
  url: string;
  license: string;
};

export type CharacterDefinition = {
  id: string;
  label: string;
  /** One line shown in the character picker. */
  description: string;
  credit?: CharacterCredit;
  Component: ComponentType<CharacterProps>;
};
