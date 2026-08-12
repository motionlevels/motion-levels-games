import type { Frame, GameConfigOptions, GameDifficulty, GameEvent, GameSnapshot } from "@motion-levels-games/game-sdk";
import type { JugarStageDiagnostics, JugarStageQuality } from "@motion-levels-games/jugar-3d/react";
import type { PlaygroundAgentProfile } from "./gameRegistry.ts";
import type { RenderableFrame } from "./frameTransforms.ts";
import type { AnimationMediaBundle, PlaygroundMediaBundle, PlaygroundMediaOptions } from "./mediaAssets.ts";

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

export type AgentLabCapture = {
  surface: "agents3d";
  width: number;
  height: number;
  dataUrl: string;
};

export type AgentLabDebugOptions = {
  paths?: boolean;
  reservations?: boolean;
  targets?: boolean;
};

export type AgentLabState = {
  available: boolean;
  active: boolean;
  paused: boolean;
  replayMode: boolean;
  replayPaused: boolean;
  recording: boolean;
  agentCount: number;
  profile: PlaygroundAgentProfile;
  qualityTier: JugarStageQuality;
  speed: number;
  replaySpeed: number;
  replayEndTick: number;
  selectedAgentId?: string;
  seed: number;
  tick: number;
  checksum: string;
  debug: Required<AgentLabDebugOptions>;
  metrics?: Readonly<Record<string, number | boolean>>;
  performance?: JugarStageDiagnostics;
};

export type AgentLabApi = {
  getState(): AgentLabState;
  setActive(active: boolean): void;
  play(): void;
  pause(): void;
  step(ticks?: number): void;
  reset(options?: { newSeed?: boolean }): void;
  setAgentCount(count: number): void;
  setProfile(profile: PlaygroundAgentProfile): void;
  setQualityTier(tier: JugarStageQuality): void;
  setSpeed(speed: number): void;
  selectAgent(agentId?: string): void;
  setDebug(options: AgentLabDebugOptions): void;
  startRecording(): void;
  stopRecording(): void;
  exportReplay(): string;
  replay: {
    enter(): void;
    exit(): void;
    play(): void;
    pause(): void;
    seek(tick: number): void;
    setSpeed(speed: number): void;
  };
  capture(options?: { width?: number; height?: number }): Promise<AgentLabCapture>;
};

export type PlaygroundState = {
  clockMillis: number;
  fps: number;
  frameMillis: number;
  difficulty: GameDifficulty;
  gameId: string;
  options: GameConfigOptions;
  status: string;
  seed: number;
  paused: boolean;
  playerCount: number;
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
  media(gameId?: string, options?: PlaygroundMediaOptions): Promise<PlaygroundMediaBundle>;
  animationMedia(animationId: string): Promise<AnimationMediaBundle>;
  /** Present in current playgrounds; optional in the type for older embedded clients. */
  agentLab?: AgentLabApi;
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
