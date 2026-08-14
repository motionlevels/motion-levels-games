import {
  animationContentSchema,
  animationLibrary,
  animationLibraryById,
  findAnimation,
  normalizeAnimationRuntimeContent,
  renderAnimationFrame,
  type NativeAnimation,
  type PressurePoint
} from "@motion-levels-games/animation-runtime";
import {
  gameEvent,
  normalizeGameConfig,
  readGameConfigOption,
  type Frame,
  type GameConfig,
  type GameEvent,
  type GameInstance,
  type GameSnapshot,
  type NormalizedGameConfig,
  type PressEvent,
  type TickEvent
} from "@motion-levels-games/game-sdk";
import { animationOption, manifest, modeOption, rotationSecondsOption, speedOption } from "./manifest.ts";

export { animationContentSchema } from "@motion-levels-games/animation-runtime";
const pressureLifetimeMillis = 900;

export type AnimationSnapshot = GameSnapshot & {
  animationId: string;
  animationLabel: string;
  category: NativeAnimation["category"];
  contentRevision: string;
  librarySize: number;
  palette: readonly string[];
  rotationIndex: number;
  rotationSize: number;
};

export type AnimationGameInstance = Omit<GameInstance, "snapshot"> & { snapshot(): AnimationSnapshot };

export function createGame(config: GameConfig): AnimationGameInstance {
  return new AnimationGame(config);
}

class AnimationGame implements AnimationGameInstance {
  private config: NormalizedGameConfig;
  private lastEvent: GameEvent;
  private nowMillis: number;
  private pressure = new Map<string, PressurePoint>();
  private startedAtMillis: number;

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.nowMillis = this.config.nowMillis;
    this.startedAtMillis = this.config.nowMillis;
    this.lastEvent = gameEvent("ambient", "Animación preparada", this.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.nowMillis = nowMillis;
    this.startedAtMillis = nowMillis;
    this.pressure.clear();
    this.lastEvent = gameEvent("ambient", `${this.currentAnimation().label} en la pista`, nowMillis);
    return [this.lastEvent];
  }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (!event.pressed) return [];
    this.pressure.set(`${event.x}:${event.y}`, { x: event.x, y: event.y, startedAtMillis: event.atMillis });
    this.lastEvent = gameEvent("effect", "La pista responde a tu paso", event.atMillis);
    return [this.lastEvent];
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    const previousId = this.currentAnimation().id;
    this.nowMillis = event.atMillis;
    for (const [key, point] of this.pressure) {
      if (event.atMillis - point.startedAtMillis > pressureLifetimeMillis) this.pressure.delete(key);
    }
    const current = this.currentAnimation();
    if (current.id !== previousId) {
      this.lastEvent = gameEvent("change", `${current.label} entra en escena`, event.atMillis);
      return [this.lastEvent];
    }
    return [];
  }

  render(): Frame {
    const speed = readGameConfigOption(this.config.options, speedOption);
    return renderAnimationFrame(this.currentAnimation(), {
      atMillis: (this.nowMillis - this.startedAtMillis) * speed,
      seed: this.config.seed,
      pressure: [...this.pressure.values()].map((point) => ({ ...point, startedAtMillis: (point.startedAtMillis - this.startedAtMillis) * speed }))
    });
  }

  snapshot(): AnimationSnapshot {
    const animation = this.currentAnimation();
    const rotation = this.rotation();
    const rotationIndex = Math.max(0, rotation.findIndex((entry) => entry.id === animation.id));
    return {
      currentGame: manifest.id,
      label: manifest.label,
      phase: "running",
      playerCount: this.config.playerCount,
      players: [],
      score: 0,
      lives: -1,
      elapsedMillis: Math.max(0, this.nowMillis - this.startedAtMillis),
      remainingMillis: 0,
      activeTargets: this.pressure.size,
      success: false,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      animationId: animation.id,
      animationLabel: animation.label,
      category: animation.category,
      contentRevision: this.content().contentRevision,
      librarySize: animationLibrary.length,
      palette: animation.palette,
      rotationIndex,
      rotationSize: rotation.length
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.init(config.nowMillis ?? this.nowMillis);
  }

  private currentAnimation(): NativeAnimation {
    const mode = readGameConfigOption(this.config.options, modeOption);
    const content = this.content();
    if (mode !== "rotation") return findAnimation(content.selectedAnimationId ?? readGameConfigOption(this.config.options, animationOption));
    const rotation = this.rotation();
    const seconds = content.rotationSeconds ?? readGameConfigOption(this.config.options, rotationSecondsOption);
    const index = Math.floor(Math.max(0, this.nowMillis - this.startedAtMillis) / (seconds * 1_000)) % rotation.length;
    return rotation[index] ?? findAnimation("aurora");
  }

  private rotation(): NativeAnimation[] {
    const ids = this.content().rotationIds;
    const selected = ids
      .map((id) => animationLibraryById.get(id))
      .filter((animation): animation is NativeAnimation => animation !== undefined)
      .filter((animation, index, all) => all.findIndex((candidate) => candidate.id === animation.id) === index);
    return selected.length ? selected : [...animationLibrary];
  }

  private content() {
    return normalizeAnimationRuntimeContent(this.config.content) ?? {
      schema: animationContentSchema,
      contentRevision: "builtin",
      rotationIds: []
    };
  }
}
