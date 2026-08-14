import {
  FLOOR_COLS,
  FLOOR_ROWS,
  createFrame,
  gameEvent,
  inFloorBounds,
  normalizeGameConfig,
  paintFrameCell,
  rgbToHex,
  type Frame,
  type GameConfig,
  type GameConfigPlayer,
  type GameEvent,
  type GamePlayer,
  type HexColor,
  type NormalizedGameConfig,
  type PlayerReadyZone,
  type PressEvent,
  type RgbColor,
  type TickEvent
} from "@motion-levels-games/game-sdk";

import { normalizeLevelId, parsePublishedLevelContent } from "./content.ts";
import type {
  PublishedAnimationRecord,
  PublishedLevelAudio,
  PublishedLevelAttemptTransition,
  PublishedLevelContent,
  PublishedLevelGameInstance,
  PublishedLevelProduct,
  PublishedLevelRecord,
  PublishedLevelSemanticTile,
  PublishedLevelSnapshot
} from "./types.ts";

const frameSize = FLOOR_COLS * FLOOR_ROWS;
const countdownDuration = 3_000;
const greenAppearWindow = 400;
const greenDisappearWindow = 800;
const greenImpactDuration = 1_100;
const blueCaptureWindow = 600;
const damageCooldown = 1_000;
const resultDuration = 1_250;
const failureRestartDuration = 3_000;

const black: RgbColor = { r: 0, g: 0, b: 0 };
const safeGreen: RgbColor = { r: 0, g: 255, b: 72 };
const blue: RgbColor = { r: 0, g: 0, b: 255 };
const red: RgbColor = { r: 255, g: 0, b: 0 };
const purple: RgbColor = { r: 245, g: 38, b: 255 };
const heldPurple: RgbColor = { r: 245, g: 250, b: 255 };
const hitYellow: RgbColor = { r: 255, g: 236, b: 82 };

const defaultAudio: PublishedLevelAudio = Object.freeze({
  musicRef: "Motion/canciones/Background07.mp3",
  musicVolume: 0.18,
  narrationCueRef: "",
  startCueRef: "",
  coinCueRef: "Motion/sonidos/coin.wav",
  doubleCoinCueRef: "Motion/sonidos/coin.wav",
  damageCueRef: "Motion/sonidos/fallo.mp3",
  winCueRef: "Motion/sonidos/victoria.mp3",
  defeatCueRef: "Motion/sonidos/fallo.mp3"
});

type TilePoint = Readonly<{ present: boolean; kind: number; uniq: string }>;
type CompiledFrame = Readonly<{ duration: number; points: readonly (TilePoint | undefined)[] }>;
type CompiledAnimation = Readonly<{
  ids: readonly string[];
  frameTick: number;
  totalDuration: number;
  frames: readonly CompiledFrame[];
  colors: ReadonlyMap<number, RgbColor>;
}>;
type CompiledLevel = Readonly<{
  id: string;
  slug: string;
  aliases: readonly string[];
  label: string;
  description: string;
  difficulty: string;
  lives: number;
  passScore: number;
  timeLimit: number;
  frameTick: number;
  winCondition: "collect_all" | "score_at_least";
  redAnimation: "none" | "parkour_lava";
  victoryAnimations: readonly string[];
  defeatAnimations: readonly string[];
  greenFade: boolean;
  greenImpact: boolean;
  greenLoad: boolean;
  greenLoadSide: "left" | "right";
  blueTurnGreen: boolean;
  blueCapture: boolean;
  damageGrace: boolean;
  totalDuration: number;
  frames: readonly CompiledFrame[];
  scoreUniqs: ReadonlySet<string>;
  audio: PublishedLevelAudio;
}>;
type Ripple = Readonly<{ centerX: number; centerY: number; startedAt: number }>;

export function createPublishedLevelGame(
  product: PublishedLevelProduct,
  config: GameConfig
): PublishedLevelGameInstance {
  return new PublishedLevelGame(product, config);
}

class PublishedLevelGame implements PublishedLevelGameInstance {
  private readonly product: PublishedLevelProduct;
  private config: NormalizedGameConfig;
  private content: PublishedLevelContent;
  private levels: readonly CompiledLevel[] = [];
  private animations = new Map<string, CompiledAnimation>();
  private level!: CompiledLevel;
  private players: GamePlayer[] = publishedPlayers(1);
  private nowMillis = 0;
  private createdAt = 0;
  private startedAt = countdownDuration;
  private endedAt = 0;
  private restartAt = 0;
  private score = 0;
  private lives = 5;
  private success = false;
  private ended = false;
  private removed = new Set<string>();
  private purpleHeld = new Set<string>();
  private purplePrimed = new Set<string>();
  private pressed = new Set<number>();
  private greenImpacts = new Set<string>();
  private ripples: Ripple[] = [];
  private capturedAt = new Map<string, number>();
  private lastDamageAt = Number.NEGATIVE_INFINITY;
  private lastDamageBy = new Map<number, number>();
  private hitFlash = new Map<number, number>();
  private lastEvent = gameEvent("none", "Listo", 0);
  private automaticAttemptTransitionsBlocked = false;

  constructor(product: PublishedLevelProduct, config: GameConfig) {
    this.product = product;
    this.config = normalizeGameConfig(config, product.manifest);
    this.content = this.resolveContent(this.config);
    this.rebuild(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] {
    this.rebuild(nowMillis);
    return this.record([gameEvent("ready", `Prepárate para ${this.level.label}`, nowMillis)]);
  }

  press(event: PressEvent): GameEvent[] {
    if (!inFloorBounds(event.x, event.y)) return [];
    this.nowMillis = event.atMillis;
    const events = this.tickState(event.atMillis);
    const key = cellIndex(event.x, event.y);
    if (event.pressed) this.pressed.add(key);
    else {
      this.pressed.delete(key);
      this.releasePurple(key, event.atMillis);
    }
    if (!event.pressed || this.ended || event.atMillis < this.startedAt) return this.record(events);
    this.triggerGreenImpact(key, event.atMillis);
    const pointEvents = this.applyPoint(this.pointAt(key, event.atMillis), key, event.atMillis);
    const completionEvents = this.tickState(event.atMillis);
    return this.record([
      ...events,
      ...pointEvents,
      ...completionEvents
    ]);
  }

  release(event: PressEvent): GameEvent[] {
    return this.press({ ...event, pressed: false });
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    return this.record(this.tickState(event.atMillis));
  }

  render(): Frame {
    const frame = createFrame("#000000");
    for (let y = 0; y < FLOOR_ROWS; y += 1) {
      for (let x = 0; x < FLOOR_COLS; x += 1) {
        paintFrameCell(frame, x, y, rgbToHex(this.colorAt(cellIndex(x, y), this.nowMillis)));
      }
    }
    return frame;
  }

  snapshot(): PublishedLevelSnapshot {
    const phase = this.ended ? "finished" : this.nowMillis < this.startedAt ? "countdown" : "running";
    const elapsedMillis = Math.max(0, this.nowMillis - this.startedAt);
    const remainingMillis = this.level.timeLimit > 0 && !this.ended
      ? Math.max(0, this.startedAt + this.level.timeLimit - this.nowMillis)
      : 0;
    const countdownMillis = this.nowMillis < this.startedAt ? this.startedAt - this.nowMillis : 0;
    const players = this.players.map((player) => ({ ...player, score: this.score, lives: this.lives }));
    return Object.freeze({
      currentGame: this.content.gameId,
      engineGame: this.content.engineGame,
      contentRevision: this.content.contentRevision,
      label: this.product.manifest.label,
      phase,
      playerCount: players.length,
      players,
      score: this.score,
      lives: this.lives,
      maxLives: this.startingLives(),
      elapsedMillis,
      remainingMillis,
      activeTargets: Math.max(0, this.level.scoreUniqs.size - this.removed.size),
      success: this.success,
      lastEventCue: this.lastEvent.cue,
      lastEventMessage: this.lastEvent.message,
      lastEventMillis: this.lastEvent.atMillis,
      countdownMillis,
      difficulty: String(this.config.difficulty),
      level: this.level.id,
      levelSlug: this.level.slug,
      levelNumber: levelNumber(this.level.slug),
      levelCount: this.levels.length,
      levelLabel: this.level.label,
      levelDescription: this.level.description,
      isFinalLevel: this.levels.at(-1)?.id === this.level.id,
      objectivesTotal: this.level.scoreUniqs.size,
      objectivesRemaining: Math.max(0, this.level.scoreUniqs.size - this.removed.size),
      resultMillis: this.ended
        ? Math.max(0, (this.success ? resultDuration : failureRestartDuration) - (this.nowMillis - this.endedAt))
        : 0,
      mode: this.content.mode,
      attemptCreatedMillis: this.createdAt,
      attemptStartedMillis: this.startedAt,
      attemptEndedMillis: this.endedAt,
      audio: this.level.audio
    });
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, this.product.manifest);
    this.content = this.resolveContent(this.config);
    this.rebuild(this.config.nowMillis);
  }

  setAutomaticAttemptTransitionsBlocked(blocked: boolean): void {
    this.automaticAttemptTransitionsBlocked = blocked;
  }

  pendingAutomaticAttemptTransition(): PublishedLevelAttemptTransition | null {
    if (!this.ended) return null;
    if (!this.success && this.restartAt > 0 && this.nowMillis >= this.restartAt) {
      return {
        kind: "retry",
        fromLevelId: this.level.id,
        fromLevelSlug: this.level.slug,
        toLevelId: this.level.id,
        toLevelSlug: this.level.slug
      };
    }
    if (this.success && this.nowMillis >= this.endedAt + resultDuration) {
      const index = this.levels.findIndex((candidate) => candidate.id === this.level.id);
      const next = index >= 0 ? this.levels[index + 1] : undefined;
      return next ? {
        kind: "level_advance",
        fromLevelId: this.level.id,
        fromLevelSlug: this.level.slug,
        toLevelId: next.id,
        toLevelSlug: next.slug
      } : null;
    }
    return null;
  }

  advanceAutomaticAttemptTransition(): readonly GameEvent[] {
    const pending = this.pendingAutomaticAttemptTransition();
    if (!pending) return [];
    if (pending.kind === "retry") {
      this.restartFailedLevel(this.nowMillis);
      return this.record([gameEvent("ready", `Reintenta ${this.level.label}`, this.nowMillis)]);
    }
    if (!this.advanceSuccessLevel(this.nowMillis)) return [];
    return this.record([gameEvent("ready", `Siguiente: ${this.level.label}`, this.nowMillis)]);
  }

  playerReadyZones(): PlayerReadyZone[] {
    const first = this.level.frames[0];
    if (!first) return [];
    const safe = first.points.flatMap((point, key) =>
      point?.present === true && point.kind === 0 ? [key] : []
    );
    if (safe.length === 0) return [];
    return farthestSafeTiles(safe, Math.max(1, this.config.playerCount)).map((key) => {
      const x = key % FLOOR_COLS;
      const y = Math.floor(key / FLOOR_COLS);
      return { minX: x, maxX: x, minY: y, maxY: y };
    });
  }

  semanticTiles(atMillis = this.nowMillis): readonly PublishedLevelSemanticTile[] {
    const raw = this.frameAt(atMillis);
    if (!raw) return [];
    return raw.points.flatMap((point, index): PublishedLevelSemanticTile[] => {
      if (!point?.present) return [];
      const effective = this.pointAt(index, atMillis);
      return [{
        x: index % FLOOR_COLS,
        y: Math.floor(index / FLOOR_COLS),
        kind: effective.kind,
        originalKind: point.kind,
        uniq: point.uniq,
        present: effective.present,
        removed: point.uniq ? this.removed.has(point.uniq) : false,
        primed: point.uniq ? this.purplePrimed.has(point.uniq) : false
      }];
    });
  }

  dangerAt(x: number, y: number, atMillis = this.nowMillis): number {
    if (!inFloorBounds(x, y)) return 1;
    const key = cellIndex(x, y);
    const samples = [atMillis, atMillis + 200, atMillis + 400];
    return samples.reduce((danger, sample) => Math.max(danger, this.pointAt(key, sample).kind === 2 ? 1 : 0), 0);
  }

  private resolveContent(config: NormalizedGameConfig): PublishedLevelContent {
    return parsePublishedLevelContent(
      config.content ?? this.product.fallbackContent,
      this.product.contentIdentity === "platform" ? undefined : this.product.manifest.id
    );
  }

  private rebuild(nowMillis: number): void {
    this.levels = compileLevels(this.content, String(this.config.difficulty));
    this.animations = compileAnimations(this.content.resultAnimations);
    this.level = selectLevel(this.levels, this.content.selectedLevelId);
    this.players = publishedPlayers(Math.max(1, this.config.playerCount), this.config.players);
    this.createdAt = nowMillis;
    this.startedAt = nowMillis + countdownDuration;
    this.nowMillis = nowMillis;
    this.resetAttemptState();
  }

  private resetAttemptState(preservePressed = false): void {
    this.endedAt = 0;
    this.restartAt = 0;
    this.score = 0;
    this.lives = this.startingLives();
    this.success = false;
    this.ended = false;
    this.removed.clear();
    this.purpleHeld.clear();
    this.purplePrimed.clear();
    if (!preservePressed) this.pressed.clear();
    this.greenImpacts.clear();
    this.ripples = [];
    this.capturedAt.clear();
    this.lastDamageAt = Number.NEGATIVE_INFINITY;
    this.lastDamageBy.clear();
    this.hitFlash.clear();
    this.lastEvent = gameEvent("none", "Listo", this.nowMillis);
  }

  private tickState(nowMillis: number): GameEvent[] {
    this.pruneRipples(nowMillis);
    if (this.ended) {
      if (this.automaticAttemptTransitionsBlocked && this.pendingAutomaticAttemptTransition()) return [];
      if (this.success && nowMillis >= this.endedAt + resultDuration && this.advanceSuccessLevel(nowMillis)) {
        return [gameEvent("ready", `Siguiente: ${this.level.label}`, nowMillis)];
      }
      if (!this.success && this.restartAt > 0 && nowMillis >= this.restartAt) {
        this.restartFailedLevel(nowMillis);
        return [gameEvent("ready", `Reintenta ${this.level.label}`, nowMillis)];
      }
      return [];
    }
    if (nowMillis < this.startedAt) return [];
    // A failed level restarts without a countdown. GameEngine composes state by
    // calling snapshot/render after tick at the same timestamp, so keep that
    // transition idempotent; a still-held foot is evaluated on the next clock
    // advance exactly as it is by the venue authority.
    if (this.startedAt === this.createdAt && nowMillis === this.startedAt) return [];
    if (this.level.timeLimit > 0 && nowMillis - this.startedAt >= this.level.timeLimit) {
      this.finishFailure(nowMillis);
      return [gameEvent("fail", "Se acabó el tiempo", nowMillis)];
    }
    const events: GameEvent[] = [];
    for (const key of this.pressed) {
      if (this.pointAt(key, nowMillis).kind !== 2) continue;
      if (this.damage(key, nowMillis)) {
        events.push(gameEvent(this.ended ? "fail" : "damage", this.ended ? "Sin vidas" : `Impacto: quedan ${this.lives} vidas`, nowMillis));
      }
      if (this.ended) return events;
    }
    if (this.hasWon()) {
      if (this.level.winCondition === "collect_all" && this.level.passScore > 0) this.score += this.level.passScore;
      this.success = true;
      this.ended = true;
      this.endedAt = nowMillis;
      events.push(gameEvent("win", `${this.level.label} superado`, nowMillis));
    }
    return events;
  }

  private hasWon(): boolean {
    return this.level.winCondition === "score_at_least"
      ? this.level.passScore > 0 && this.score >= this.level.passScore
      : this.level.scoreUniqs.size > 0 && this.removed.size >= this.level.scoreUniqs.size;
  }

  private applyPoint(point: TilePoint, key: number, atMillis: number): GameEvent[] {
    if (point.kind === 1) {
      const captured = this.captureBlue(point, key, atMillis);
      return captured > 0 ? [gameEvent("coin", `${this.score} puntos`, atMillis)] : [];
    }
    if (point.kind === 3 && point.uniq && !this.removed.has(point.uniq) && !this.purplePrimed.has(point.uniq)) {
      this.purpleHeld.add(point.uniq);
      return [gameEvent("doubleCoin", "Suelta y vuelve a pisar", atMillis)];
    }
    if (point.kind === 2 && this.damage(key, atMillis)) {
      return [gameEvent(this.ended ? "fail" : "damage", this.ended ? "Sin vidas" : `Impacto: quedan ${this.lives} vidas`, atMillis)];
    }
    return [];
  }

  private releasePurple(key: number, atMillis: number): void {
    if (this.ended || atMillis < this.startedAt) return;
    const point = this.rawPointAt(key, atMillis);
    if (!point.uniq || !this.purpleHeld.has(point.uniq)) return;
    this.purpleHeld.delete(point.uniq);
    if (!this.removed.has(point.uniq)) this.purplePrimed.add(point.uniq);
  }

  private damage(key: number, atMillis: number): boolean {
    if (this.level.damageGrace) {
      if (atMillis - this.lastDamageAt < damageCooldown) return false;
      this.lastDamageAt = atMillis;
    } else {
      const last = this.lastDamageBy.get(key) ?? Number.NEGATIVE_INFINITY;
      if (atMillis - last < damageCooldown) return false;
      this.lastDamageBy.set(key, atMillis);
    }
    this.hitFlash.set(key, atMillis + 350);
    if (this.lives > 0) this.lives -= 1;
    if (this.lives <= 0) this.finishFailure(atMillis);
    return true;
  }

  private finishFailure(atMillis: number): void {
    this.ended = true;
    this.success = false;
    this.endedAt = atMillis;
    this.restartAt = atMillis + failureRestartDuration;
  }

  private restartFailedLevel(atMillis: number): void {
    this.createdAt = atMillis;
    this.startedAt = atMillis;
    this.nowMillis = atMillis;
    this.resetAttemptState(true);
  }

  private advanceSuccessLevel(atMillis: number): boolean {
    const index = this.levels.findIndex((candidate) => candidate.id === this.level.id);
    const next = index >= 0 ? this.levels[index + 1] : undefined;
    if (!next) return false;
    this.level = next;
    this.createdAt = atMillis;
    this.startedAt = atMillis + countdownDuration;
    this.nowMillis = atMillis;
    this.resetAttemptState(true);
    return true;
  }

  private colorAt(key: number, atMillis: number): RgbColor {
    if (this.ended) return this.resultColorAt(key, atMillis);
    if ((this.hitFlash.get(key) ?? 0) > atMillis) return hitYellow;
    if (atMillis < this.startedAt) return this.countdownColorAt(key, atMillis);
    const point = this.pointAt(key, atMillis);
    return this.greenImpactColor(key, point, this.colorForPoint(key, point, atMillis), atMillis);
  }

  private resultColorAt(key: number, atMillis: number): RgbColor {
    const names = this.success ? this.level.victoryAnimations : this.level.defeatAnimations;
    const name = chosenResultAnimation(names, this.endedAt);
    const animation = name ? this.animations.get(name) : undefined;
    if (!animation) return black;
    const elapsed = Math.max(0, atMillis - this.endedAt) % Math.max(1, animation.totalDuration);
    let remaining = elapsed;
    let selected = animation.frames[animation.frames.length - 1];
    for (const frame of animation.frames) {
      if (remaining < frame.duration) { selected = frame; break; }
      remaining -= frame.duration;
    }
    const point = selected?.points[key];
    return point?.present ? animation.colors.get(point.kind) ?? black : black;
  }

  private colorForPoint(key: number, point: TilePoint, atMillis: number): RgbColor {
    if (!point.present) return black;
    if (point.kind === 2 && this.level.redAnimation === "parkour_lava") return lavaColor(key, atMillis);
    if (point.kind === 0 && point.uniq && this.removed.has(point.uniq) && this.level.blueTurnGreen) {
      return this.capturedBlueColor(point.uniq, atMillis);
    }
    if (point.kind === 0 && this.level.greenFade) return this.greenPlatformColor(key, atMillis);
    return basePointColor(point);
  }

  private pointAt(key: number, atMillis: number): TilePoint {
    const raw = this.rawPointAt(key, atMillis);
    if (raw.uniq && this.removed.has(raw.uniq)) {
      return this.level.blueTurnGreen && raw.kind === 1 ? { ...raw, kind: 0 } : emptyPoint;
    }
    if (raw.uniq && this.purplePrimed.has(raw.uniq)) return { ...raw, kind: 1 };
    if (raw.uniq && this.purpleHeld.has(raw.uniq)) return { ...raw, kind: 4 };
    return raw;
  }

  private rawPointAt(key: number, atMillis: number): TilePoint {
    return this.frameAt(atMillis)?.points[key] ?? emptyPoint;
  }

  private frameAt(atMillis: number): CompiledFrame | undefined {
    return framePosition(this.level, atMillis - this.startedAt).frame;
  }

  private greenPlatformColor(key: number, atMillis: number): RgbColor {
    const position = framePosition(this.level, atMillis - this.startedAt);
    const frame = position.frame;
    if (!frame) return black;
    const point = frame.points[key];
    if (!point?.present || point.kind !== 0) return black;
    let color = basePointColor(point);
    if (this.level.frames.length <= 1) return color;
    const index = position.index;
    const previous = this.level.frames[(index - 1 + this.level.frames.length) % this.level.frames.length]?.points[key] ?? emptyPoint;
    const next = this.level.frames[(index + 1) % this.level.frames.length]?.points[key] ?? emptyPoint;
    const appearWindow = Math.min(greenAppearWindow, frame.duration / 2);
    const disappearWindow = Math.min(greenDisappearWindow, frame.duration / 2);
    if ((!previous.present || previous.kind !== 0) && appearWindow > 0 && position.elapsed < appearWindow) {
      color = mixRgb(this.transitionPointColor(key, previous, atMillis - position.elapsed), color, ease(position.elapsed / appearWindow));
    }
    const remaining = frame.duration - position.elapsed;
    if ((!next.present || next.kind !== 0) && disappearWindow > 0 && remaining < disappearWindow) {
      color = mixRgb(color, this.transitionPointColor(key, next, atMillis + remaining), 1 - ease(remaining / disappearWindow));
    }
    return color;
  }

  private transitionPointColor(key: number, point: TilePoint, atMillis: number): RgbColor {
    if (!point.present) return black;
    return point.kind === 2 && this.level.redAnimation === "parkour_lava" ? lavaColor(key, atMillis) : basePointColor(point);
  }

  private capturedBlueColor(uniq: string, atMillis: number): RgbColor {
    const started = this.capturedAt.get(uniq);
    if (started === undefined || atMillis - started >= blueCaptureWindow) return safeGreen;
    return mixRgb(blue, safeGreen, ease(Math.max(0, atMillis - started) / blueCaptureWindow));
  }

  private captureBlue(point: TilePoint, key: number, atMillis: number): number {
    if (!point.uniq || this.removed.has(point.uniq)) return 0;
    // A primed purple objective presents as blue, but remains purple in the
    // authored frame. Area capture applies only to an originally blue
    // platform; otherwise the second purple press could never complete.
    const originalKind = this.frameAt(atMillis)?.points[key]?.kind;
    const uniqs = this.level.blueCapture && originalKind === 1
      ? this.connectedBlueUniqs(key, atMillis)
      : [point.uniq];
    let captured = 0;
    for (const uniq of uniqs) {
      if (!uniq || this.removed.has(uniq)) continue;
      this.removed.add(uniq);
      this.capturedAt.set(uniq, atMillis);
      this.purpleHeld.delete(uniq);
      this.purplePrimed.delete(uniq);
      this.score += 1;
      captured += 1;
    }
    return captured;
  }

  private connectedBlueUniqs(start: number, atMillis: number): string[] {
    const frame = this.frameAt(atMillis);
    if (!frame || frame.points[start]?.kind !== 1) return [];
    const component = floodFill(start, (key) => frame.points[key]?.present === true && frame.points[key]?.kind === 1);
    return [...new Set(component.map((key) => frame.points[key]?.uniq ?? "").filter(Boolean))];
  }

  private triggerGreenImpact(key: number, atMillis: number): void {
    if (!this.level.greenImpact || this.pointAt(key, atMillis).kind !== 0) return;
    const frame = this.frameAt(atMillis);
    if (!frame) return;
    const component = floodFill(key, (candidate) => frame.points[candidate]?.present === true && frame.points[candidate]?.kind === 0);
    if (component.length === 0) return;
    const componentKey = [...component].sort((a, b) => a - b).join(";");
    if (this.greenImpacts.has(componentKey)) return;
    this.greenImpacts.add(componentKey);
    this.ripples.push({
      centerX: component.reduce((sum, value) => sum + value % FLOOR_COLS + 0.5, 0) / component.length,
      centerY: component.reduce((sum, value) => sum + Math.floor(value / FLOOR_COLS) + 0.5, 0) / component.length,
      startedAt: atMillis
    });
  }

  private greenImpactColor(key: number, point: TilePoint, base: RgbColor, atMillis: number): RgbColor {
    if (!this.level.greenImpact || !point.present || point.kind !== 2) return base;
    const x = key % FLOOR_COLS + 0.5;
    const y = Math.floor(key / FLOOR_COLS) + 0.5;
    return this.ripples.reduce((color, ripple) => {
      const age = atMillis - ripple.startedAt;
      if (age < 0 || age > greenImpactDuration) return color;
      const progress = age / greenImpactDuration;
      const radius = 0.35 + progress * 7;
      const distance = Math.hypot(x - ripple.centerX, y - ripple.centerY);
      const strength = clamp01(1 - Math.abs(distance - radius) / 0.85) * (1 - progress);
      return strength > 0 ? mixRgb(color, { r: 255, g: 185, b: 72 }, strength * 0.7) : color;
    }, base);
  }

  private pruneRipples(atMillis: number): void {
    this.ripples = this.ripples.filter((ripple) => atMillis - ripple.startedAt <= greenImpactDuration);
  }

  private countdownColorAt(key: number, atMillis: number): RgbColor {
    const first = this.level.frames[0];
    if (!first) return black;
    const point = first.points[key];
    if (!this.level.greenLoad) {
      return point?.present === true && point.kind === 0 ? basePointColor(point) : black;
    }
    const safeTiles = first ? countdownSafeTiles(first, this.level.greenLoadSide) : [];
    const x = key % FLOOR_COLS;
    const y = Math.floor(key / FLOOR_COLS);
    const countdownProgress = (atMillis - this.createdAt) / Math.max(1, this.startedAt - this.createdAt);
    for (let order = 0; order < safeTiles.length; order += 1) {
      const target = safeTiles[order]!;
      const progress = countdownTileProgress(countdownProgress, order, safeTiles.length);
      if (progress < 0) continue;
      const targetX = target % FLOOR_COLS;
      const targetY = Math.floor(target / FLOOR_COLS);
      if (targetX !== x || countdownFallingY(targetY, progress, this.level.greenLoadSide) !== y) continue;
      if (progress >= 1) return safeGreen;
      const phase = (atMillis - this.createdAt) / 1_000 * Math.PI * 4 + (targetX + targetY) * 0.22;
      return scaleRgb(safeGreen, 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(phase)));
    }
    return black;
  }

  private startingLives(): number {
    return this.level.lives > 0 ? this.level.lives : 5;
  }

  private record(events: GameEvent[]): GameEvent[] {
    if (events.length > 0) this.lastEvent = events[events.length - 1]!;
    return events;
  }
}

const emptyPoint: TilePoint = Object.freeze({ present: false, kind: -1, uniq: "" });

function compileLevels(content: PublishedLevelContent, difficulty: string): readonly CompiledLevel[] {
  const selectedDifficulty = difficulty.trim().toLowerCase();
  const deduped = dedupeLevels(content.levels, selectedDifficulty);
  if (deduped.length === 0) throw new Error("Published level content has no levels for this difficulty");
  return deduped.map((raw) => compileLevel(raw, selectedDifficulty, content.mode));
}

function compileLevel(raw: PublishedLevelRecord, difficulty: string, mode: "challenge" | "free"): CompiledLevel {
  const settings = raw.rules?.difficulty_settings?.[difficulty];
  const hasSettings = Object.keys(raw.rules?.difficulty_settings ?? {}).length > 0;
  let lives = hasSettings ? settings?.life ?? 0 : raw.life ?? 0;
  let timeLimit = mode === "challenge" && !hasSettings ? (raw.time_limit_seconds ?? 0) * 1_000 : 0;
  let frameTick = raw.frame_tick_ms && raw.frame_tick_ms > 0 ? raw.frame_tick_ms : 25;
  if (hasSettings) {
    if ((settings?.life ?? 0) > 0) lives = settings!.life!;
    if (mode === "challenge" && (settings?.gameplay_time_limit_seconds ?? 0) > 0) {
      timeLimit = settings!.gameplay_time_limit_seconds! * 1_000;
    }
    if ((settings?.speed_multiplier ?? 0) > 0) frameTick = Math.max(1, frameTick / settings!.speed_multiplier!);
  }
  const scoreUniqs = new Set<string>();
  let totalDuration = 0;
  const frames = raw.frames.map((frame): CompiledFrame => {
    const points: Array<TilePoint | undefined> = Array.from({ length: frameSize });
    for (const [x, y, kind, uniq = ""] of frame.c) {
      points[cellIndex(x, y)] = Object.freeze({ present: true, kind, uniq });
      if (uniq && (kind === 1 || kind === 3)) scoreUniqs.add(uniq);
    }
    const duration = Math.max(1, frame.r) * frameTick;
    totalDuration += duration;
    return Object.freeze({ duration, points: Object.freeze(points) });
  });
  const audio = Object.freeze({
    musicRef: raw.music_ref || defaultAudio.musicRef,
    musicVolume: raw.music_volume === undefined ? defaultAudio.musicVolume : clamp(raw.music_volume, 0, 1),
    narrationCueRef: raw.narration_cue_ref || "",
    startCueRef: raw.start_cue_ref || "",
    coinCueRef: raw.coin_cue_ref || defaultAudio.coinCueRef,
    doubleCoinCueRef: raw.double_coin_cue_ref || raw.coin_cue_ref || defaultAudio.doubleCoinCueRef,
    damageCueRef: raw.damage_cue_ref || defaultAudio.damageCueRef,
    winCueRef: raw.win_cue_ref || defaultAudio.winCueRef,
    defeatCueRef: raw.defeat_cue_ref || raw.damage_cue_ref || defaultAudio.defeatCueRef
  });
  return Object.freeze({
    id: raw.id,
    slug: normalizeLevelId(raw.slug),
    aliases: uniqueStrings([raw.slug]),
    label: raw.label,
    description: raw.description ?? "",
    difficulty,
    lives,
    passScore: raw.pass_score ?? 0,
    timeLimit,
    frameTick,
    winCondition: raw.rules?.victory_condition === "score_at_least" ? "score_at_least" : "collect_all",
    redAnimation: raw.rules?.red_floor_animation === "parkour_lava" ? "parkour_lava" : "none",
    victoryAnimations: uniqueStrings(raw.result_animations?.victory_animations),
    defeatAnimations: uniqueStrings(raw.result_animations?.defeat_animations),
    greenFade: raw.rules?.green_platform_disappear === true,
    greenImpact: raw.rules?.green_platform_impact_ripple === true,
    greenLoad: raw.rules?.green_platform_load_animation !== false,
    greenLoadSide: raw.rules?.green_platform_load_side === "right" ? "right" : "left",
    blueTurnGreen: raw.rules?.blue_platform_turn_green === true,
    blueCapture: raw.rules?.blue_platform_capture_area === true,
    damageGrace: raw.rules?.red_damage_grace_period === true,
    totalDuration,
    frames: Object.freeze(frames),
    scoreUniqs,
    audio
  });
}

function dedupeLevels(levels: readonly PublishedLevelRecord[], difficulty: string): PublishedLevelRecord[] {
  const order: string[] = [];
  const byId = new Map<string, { level: PublishedLevelRecord; rank: number }>();
  for (const level of levels) {
    const id = normalizeLevelId(level.slug);
    const rank = level.difficulty?.toLowerCase() === difficulty
      ? 3
      : level.rules?.difficulty_settings?.[difficulty]
        ? 2
        : 1;
    const previous = byId.get(id);
    if (!previous) {
      order.push(id);
      byId.set(id, { level, rank });
    } else if (rank > previous.rank) byId.set(id, { level, rank });
  }
  return order.map((id) => byId.get(id)!.level);
}

function compileAnimations(records: readonly PublishedAnimationRecord[]): Map<string, CompiledAnimation> {
  const result = new Map<string, CompiledAnimation>();
  for (const record of records) {
    const frameTick = record.frame_tick_ms && record.frame_tick_ms > 0 ? record.frame_tick_ms : 50;
    let totalDuration = 0;
    const frames = (record.frames ?? []).map((frame): CompiledFrame => {
      const points: Array<TilePoint | undefined> = Array.from({ length: frameSize });
      for (const [x, y, kind] of frame.c) points[cellIndex(x, y)] = { present: true, kind, uniq: "" };
      const duration = Math.max(1, frame.r) * frameTick;
      totalDuration += duration;
      return { duration, points };
    });
    if (frames.length === 0) continue;
    const colors = new Map<number, RgbColor>();
    for (const [kind, effect] of Object.entries(record.tile_effects ?? {})) {
      const parsed = parseHex(effect.color ?? "");
      if (parsed) colors.set(Number(kind), parsed);
    }
    const ids = uniqueStrings([record.slug, record.id ?? ""]);
    const compiled = Object.freeze({ ids, frameTick, totalDuration, frames, colors });
    for (const id of ids) result.set(id, compiled);
  }
  return result;
}

function selectLevel(levels: readonly CompiledLevel[], selected: string): CompiledLevel {
  const exact = levels.find((level) => level.id === selected.toLowerCase());
  if (exact) return exact;
  const normalized = normalizeLevelId(selected);
  const aliases = levels.filter((level) => level.aliases.includes(normalized));
  if (aliases.length === 1) return aliases[0]!;
  if (aliases.length > 1) throw new Error(`Selected level alias ${selected} is ambiguous`);
  throw new Error(`Selected level ${selected} is not present in compiled content`);
}

function framePosition(level: CompiledLevel, rawElapsed: number): { frame?: CompiledFrame; index: number; elapsed: number } {
  if (level.frames.length === 0 || rawElapsed < 0) return { index: -1, elapsed: 0 };
  let elapsed = level.totalDuration > 0 ? rawElapsed % level.totalDuration : rawElapsed;
  for (let index = 0; index < level.frames.length; index += 1) {
    const frame = level.frames[index]!;
    if (elapsed < frame.duration) return { frame, index, elapsed };
    elapsed -= frame.duration;
  }
  const index = level.frames.length - 1;
  const frame = level.frames[index];
  return { frame, index, elapsed: frame?.duration ?? 0 };
}

function basePointColor(point: TilePoint): RgbColor {
  if (!point.present) return black;
  if (point.kind === 0) return safeGreen;
  if (point.kind === 1) return blue;
  if (point.kind === 2) return red;
  if (point.kind === 3) return purple;
  if (point.kind === 4) return heldPurple;
  return black;
}

function lavaColor(key: number, atMillis: number): RgbColor {
  const x = key % FLOOR_COLS;
  const y = Math.floor(key / FLOOR_COLS);
  const seconds = atMillis / 1_000 * 0.22;
  const nx = x / FLOOR_COLS;
  const ny = y / FLOOR_ROWS;
  const field = 0.5 + 0.5 * Math.sin((nx * 3 + ny * 1.6 + seconds * 0.7) * Math.PI)
    * Math.cos((nx * 2.2 - ny * 3.2 - seconds * 0.5) * Math.PI);
  const heat = clamp01(0.18 + field * 0.82);
  const flicker = 0.92 + 0.08 * Math.sin((x * 1.3 + y * 0.7 + seconds * 4.2) * Math.PI);
  return {
    r: byte((150 + 105 * heat) * flicker),
    g: byte((14 + 70 * heat) * flicker),
    b: byte((2 + 10 * heat) * flicker)
  };
}

function chosenResultAnimation(values: readonly string[], endedAt: number): string {
  const normalized = uniqueStrings(values);
  if (normalized.length <= 1) return normalized[0] ?? "";
  return normalized[hashInt(Math.trunc(endedAt)) % normalized.length] ?? normalized[0]!;
}

function hashInt(value: number): number {
  let x = (value + 0x9e3779b9) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x & 0x7fffffff;
}

function countdownSafeTiles(frame: CompiledFrame, side: "left" | "right"): number[] {
  const result: number[] = [];
  const rows = Array.from({ length: FLOOR_ROWS }, (_, index) => side === "right" ? FLOOR_ROWS - 1 - index : index);
  for (const y of rows) for (let x = 0; x < FLOOR_COLS; x += 1) {
    const key = cellIndex(x, y);
    const point = frame.points[key];
    if (point?.present && point.kind === 0) result.push(key);
  }
  return result;
}

function countdownTileProgress(progressValue: number, order: number, total: number): number {
  const progress = clamp01(progressValue);
  if (total <= 1) return Math.min(progress / 0.92, 1);
  const delay = order / (total - 1) * 0.68;
  return clamp((progress - delay) / 0.24, -1, 1);
}

function countdownFallingY(targetY: number, tileProgress: number, side: "left" | "right"): number {
  const progress = clamp01(tileProgress);
  const eased = 1 - (1 - progress) ** 3;
  const startY = side === "right" ? targetY - FLOOR_ROWS : targetY + FLOOR_ROWS;
  return Math.round(startY + (targetY - startY) * eased);
}

function farthestSafeTiles(safe: readonly number[], count: number): number[] {
  const selected = [safe[Math.floor((safe.length - 1) / 2)]!];
  while (selected.length < count) {
    const next = safe
      .filter((key) => !selected.includes(key))
      .map((key) => ({
        key,
        distance: Math.min(...selected.map((other) => tileDistanceSquared(key, other)))
      }))
      .sort((left, right) => right.distance - left.distance || left.key - right.key)[0]?.key;
    selected.push(next ?? safe[selected.length % safe.length]!);
  }
  return selected;
}

function tileDistanceSquared(left: number, right: number): number {
  const deltaX = left % FLOOR_COLS - right % FLOOR_COLS;
  const deltaY = Math.floor(left / FLOOR_COLS) - Math.floor(right / FLOOR_COLS);
  return deltaX * deltaX + deltaY * deltaY;
}

function floodFill(start: number, predicate: (key: number) => boolean): number[] {
  if (!predicate(start)) return [];
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const key = queue.shift()!;
    for (const next of neighbors(key)) {
      if (!visited.has(next) && predicate(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return [...visited];
}

function neighbors(key: number): number[] {
  const x = key % FLOOR_COLS;
  const y = Math.floor(key / FLOOR_COLS);
  return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
    .filter(([nextX, nextY]) => inFloorBounds(nextX!, nextY!))
    .map(([nextX, nextY]) => cellIndex(nextX!, nextY!));
}

function uniqueStrings(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function publishedPlayers(count: number, supplied: readonly GameConfigPlayer[] = []): GamePlayer[] {
  const colors = [
    "#ff0000",
    "#00ffff",
    "#00ff00",
    "#ff00ff",
    "#0000ff",
    "#ffff00"
  ] as const satisfies readonly HexColor[];
  return Array.from({ length: count }, (_, index) => ({
    index,
    label: supplied[index]?.label || supplied[index]?.name || `Jugador ${index + 1}`,
    color: supplied[index]?.color || colors[index % colors.length]!,
    score: 0,
    lives: -1
  }));
}

function cellIndex(x: number, y: number): number {
  return y * FLOOR_COLS + x;
}

function levelNumber(id: string): number {
  return Number(/^level-(\d+)$/u.exec(id)?.[1] ?? 0);
}

function mixRgb(from: RgbColor, to: RgbColor, amount: number): RgbColor {
  const t = clamp01(amount);
  return {
    r: byte(from.r + (to.r - from.r) * t),
    g: byte(from.g + (to.g - from.g) * t),
    b: byte(from.b + (to.b - from.b) * t)
  };
}

function scaleRgb(color: RgbColor, scale: number): RgbColor {
  return { r: byte(color.r * scale), g: byte(color.g * scale), b: byte(color.b * scale) };
}

function ease(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function parseHex(value: string): RgbColor | undefined {
  if (!/^#[0-9a-f]{6}$/iu.test(value)) return undefined;
  const number = Number.parseInt(value.slice(1), 16);
  return { r: number >> 16, g: number >> 8 & 0xff, b: number & 0xff };
}

function byte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
