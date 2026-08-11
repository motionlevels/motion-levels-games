"use client";

import type { ComponentType } from "react";

import { Explorer, Guardian, Robot, Runner, Trickster } from "./Robot.tsx";
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
  sahur: Sahur
};

export function characterComponent(id: string): ComponentType<CharacterProps> {
  return characterComponents[id] ?? Robot;
}
