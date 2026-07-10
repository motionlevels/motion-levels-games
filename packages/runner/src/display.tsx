import { createRoot, type Root } from "react-dom/client";
import type { ComponentType } from "react";
import { PlayerDisplayRuntimeProvider } from "@motion-levels-games/display-kit";
import type { Frame, GameSnapshot } from "@motion-levels-games/game-sdk";
import { gameRegistry } from "./registry.ts";

declare const MOTION_LEVELS_GAMES_REVISION: string;
declare const MOTION_LEVELS_GAMES_DISPLAY_CSS: string;

type DisplayInput = {
  gameId: string;
  snapshot: GameSnapshot;
  frame?: Frame;
  paused?: boolean;
};

type MountedDisplay = { root: Root; input: DisplayInput };
const mounted = new WeakMap<Element, MountedDisplay>();

function render(element: Element, input: DisplayInput): void {
  const module = gameRegistry.get(input.gameId);
  if (!module?.PlayerDisplay) throw new Error(`no player display registered for ${input.gameId}`);
  let entry = mounted.get(element);
  if (!entry) {
    entry = { root: createRoot(element), input };
    mounted.set(element, entry);
  }
  entry.input = input;
  const PlayerDisplay = module.PlayerDisplay as ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>;
  entry.root.render(
    <PlayerDisplayRuntimeProvider paused={input.paused === true}>
      <PlayerDisplay snapshot={input.snapshot} frame={input.frame} />
    </PlayerDisplayRuntimeProvider>
  );
}

function unmount(element: Element): void {
  mounted.get(element)?.root.unmount();
  mounted.delete(element);
}

function installStyles(): void {
  if (document.getElementById("motion-levels-games-display-styles")) return;
  const style = document.createElement("style");
  style.id = "motion-levels-games-display-styles";
  style.textContent = MOTION_LEVELS_GAMES_DISPLAY_CSS;
  document.head.append(style);
}

installStyles();

window.MotionLevelsGamesDisplay = {
  revision: MOTION_LEVELS_GAMES_REVISION,
  mount: render,
  update: render,
  unmount
};

declare global {
  interface Window {
    MotionLevelsGamesDisplay: {
      revision: string;
      mount(element: Element, input: DisplayInput): void;
      update(element: Element, input: DisplayInput): void;
      unmount(element: Element): void;
    };
  }
}
