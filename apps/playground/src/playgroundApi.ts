import type { Frame, GameEvent, GameSnapshot } from "@motion-levels-games/game-sdk";
import type { RenderableFrame } from "./frameTransforms.ts";

export type PlaygroundCaptureSurface =
  | "display"
  | "boardPreview"
  | "boardPhysical"
  | "combined";

export type PlaygroundPointSpace = "physical" | "preview";

export type PlaygroundCapture = {
  surface: PlaygroundCaptureSurface;
  width: number;
  height: number;
  dataUrl: string;
};

export type PlaygroundState = {
  clockMillis: number;
  fps: number;
  frameMillis: number;
  gameId: string;
  status: string;
  paused: boolean;
  rotatedBoard: boolean;
  snapshot: GameSnapshot;
  frame: Frame;
  previewFrame: RenderableFrame;
  events: GameEvent[];
};

export type PlaygroundApi = {
  getState(): PlaygroundState;
  pause(): void;
  resume(): void;
  reset(): void;
  step(ms?: number): void;
  press(x: number, y: number, options?: { space?: PlaygroundPointSpace }): void;
  release(x: number, y: number, options?: { space?: PlaygroundPointSpace }): void;
  tap(x: number, y: number, options?: { space?: PlaygroundPointSpace; durationMs?: number }): void;
  capture(surfaces?: PlaygroundCaptureSurface[]): Promise<Record<PlaygroundCaptureSurface, PlaygroundCapture>>;
  copy(surface: PlaygroundCaptureSurface): Promise<PlaygroundCapture>;
};

declare global {
  interface Window {
    motionLevelsPlayground?: PlaygroundApi;
    ml?: PlaygroundApi;
  }
}

export function installPlaygroundApi(api: PlaygroundApi): () => void {
  window.motionLevelsPlayground = api;
  window.ml = api;
  document.documentElement.dataset.motionLevelsPlaygroundApi = "ready";

  return () => {
    const ownsGlobals = window.motionLevelsPlayground === api || window.ml === api;
    if (window.motionLevelsPlayground === api) {
      delete window.motionLevelsPlayground;
    }
    if (window.ml === api) {
      delete window.ml;
    }
    if (ownsGlobals) {
      delete document.documentElement.dataset.motionLevelsPlaygroundApi;
    }
  };
}
