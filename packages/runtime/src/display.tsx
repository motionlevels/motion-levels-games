import { createRoot, type Root } from "react-dom/client";
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { PlayerDisplayRuntimeProvider } from "@motion-levels-games/display-kit";
import type { FloorRotationDegrees, Frame, GameSnapshot } from "@motion-levels-games/game-sdk";
import { displayRegistry } from "./displayRegistry.ts";
import { reportDisplayError } from "./displayError.ts";

declare const MOTION_LEVELS_GAMES_REVISION: string;
declare const MOTION_LEVELS_GAMES_DISPLAY_CSS: string;

type DisplayInput = {
  gameId: string;
  snapshot: GameSnapshot;
  frame?: Frame;
  paused?: boolean;
  floorRotationDegrees?: FloorRotationDegrees;
  onError?: (reason: unknown) => void;
};

class DisplayErrorBoundary extends Component<
  { children: ReactNode; onError?: (reason: unknown) => void },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(error: unknown, _info: ErrorInfo): void { reportDisplayError(this.props.onError, error); }
  override render(): ReactNode { return this.state.failed ? null : this.props.children; }
}

const mounted = new WeakMap<Element, Root>();

function render(element: Element, input: DisplayInput): void {
  const module = displayRegistry.get(input.gameId);
  if (!module) throw new Error(`no player display registered for ${input.gameId}`);
  let root = mounted.get(element);
  if (!root) {
    root = createRoot(element);
    mounted.set(element, root);
  }
  const PlayerDisplay = module.PlayerDisplay as ComponentType<{ snapshot: GameSnapshot; frame?: Frame }>;
  root.render(
    <DisplayErrorBoundary key={input.gameId} onError={input.onError}>
      <PlayerDisplayRuntimeProvider
        paused={input.paused === true}
        floorRotationDegrees={input.floorRotationDegrees}
      >
        <PlayerDisplay snapshot={input.snapshot} frame={input.frame} />
      </PlayerDisplayRuntimeProvider>
    </DisplayErrorBoundary>
  );
}

function unmount(element: Element): void {
  mounted.get(element)?.unmount();
  mounted.delete(element);
}

let style = document.getElementById("motion-levels-games-display-styles") as HTMLStyleElement | null;
if (!style) {
  style = document.createElement("style");
  style.id = "motion-levels-games-display-styles";
  document.head.append(style);
}
style.textContent = MOTION_LEVELS_GAMES_DISPLAY_CSS;
style.dataset.revision = MOTION_LEVELS_GAMES_REVISION;

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
