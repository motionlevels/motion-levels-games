import { createRoot, type Root } from "react-dom/client";
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { PlayerDisplayRuntimeProvider } from "@motion-levels-games/display-kit";
import "@motion-levels-games/display-kit/styles.css";
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

const legacyStylesID = "motion-levels-games-display-styles";

function installLegacyStyles(): void {
  const existing = document.getElementById(legacyStylesID);
  let style: HTMLStyleElement;
  if (existing instanceof HTMLStyleElement) {
    style = existing;
  } else {
    existing?.remove();
    style = document.createElement("style");
    style.id = legacyStylesID;
    document.head.append(style);
  }
  style.textContent = MOTION_LEVELS_GAMES_DISPLAY_CSS;
  style.dataset.revision = MOTION_LEVELS_GAMES_REVISION;
}

installLegacyStyles();

const displayRuntime = {
  revision: MOTION_LEVELS_GAMES_REVISION,
  mount: render,
  update: render,
  unmount
};

window.MotionLevelsGamesDisplays ??= {};
window.MotionLevelsGamesDisplays[MOTION_LEVELS_GAMES_REVISION] = displayRuntime;
window.MotionLevelsGamesDisplay = displayRuntime;

declare global {
  interface Window {
    MotionLevelsGamesDisplay?: {
      revision: string;
      mount(element: Element, input: DisplayInput): void;
      update(element: Element, input: DisplayInput): void;
      unmount(element: Element): void;
    };
    MotionLevelsGamesDisplays?: Record<string, NonNullable<Window["MotionLevelsGamesDisplay"]>>;
  }
}
