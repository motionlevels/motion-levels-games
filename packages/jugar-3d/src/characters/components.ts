"use client";

import { createElement, type ComponentType } from "react";

import { Explorer, Guardian, Robot, Runner, Trickster } from "./Robot.tsx";
import { RiggedCharacter } from "./RiggedCharacter.tsx";
import { Sahur } from "./Sahur.tsx";
import type { CharacterProps } from "./types.ts";

/**
 * The renderable characters. This module pulls in three.js, so import it only
 * from the lazily-loaded stage — never from the app shell or the picker, which
 * should stay in the small entry chunk (see catalog.ts).
 */
export const characterComponents: Record<string, ComponentType<CharacterProps>> = {
  robot: Robot,
  explorer: Explorer,
  runner: Runner,
  trickster: Trickster,
  guardian: Guardian,
  adventurer: rigged("adventurer"),
  "casual-hoodie": rigged("casual-hoodie"),
  punk: rigged("punk"),
  spacesuit: rigged("spacesuit"),
  swat: rigged("swat"),
  worker: rigged("worker"),
  trailblazer: rigged("trailblazer"),
  "street-scout": rigged("street-scout"),
  "star-pilot": rigged("star-pilot"),
  mystic: rigged("mystic"),
  sahur: Sahur
};

export function characterComponent(id: string): ComponentType<CharacterProps> {
  return characterComponents[id] ?? Robot;
}

function rigged(assetId: string): ComponentType<CharacterProps> {
  function RiggedVariant(props: CharacterProps) {
    return createElement(RiggedCharacter, { ...props, assetId });
  }
  RiggedVariant.displayName = `RiggedCharacter(${assetId})`;
  return RiggedVariant;
}
