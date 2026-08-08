import { createRoot, type Root } from "react-dom/client";
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { PlayerDisplayRuntimeProvider } from "@motion-levels-games/display-kit";
import type { Frame, GameSnapshot } from "@motion-levels-games/game-sdk";
import { reportDisplayError } from "./displayError.ts";
import { gameRegistry } from "./registry.ts";

declare const MOTION_LEVELS_GAMES_REVISION: string;
declare const MOTION_LEVELS_GAMES_DISPLAY_CSS: string;

type DisplayInput = {
  gameId: string;
  snapshot: GameSnapshot;
  frame?: Frame;
  paused?: boolean;
  onError?: (reason: unknown) => void;
};

type DisplayErrorBoundaryProps = {
  children: ReactNode;
  onError?: (reason: unknown) => void;
};

class DisplayErrorBoundary extends Component<DisplayErrorBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    reportDisplayError(this.props.onError, error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

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
    <DisplayErrorBoundary key={input.gameId} onError={input.onError}>
      <PlayerDisplayRuntimeProvider paused={input.paused === true}>
        <PlayerDisplay snapshot={input.snapshot} frame={input.frame} />
      </PlayerDisplayRuntimeProvider>
    </DisplayErrorBoundary>
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
