import {
  FLOOR_COLS, FLOOR_ROWS, clamp, createFrame, createPlayerReadyGate, createSeededRng,
  defaultPlayers, fillFrameRect, gameEvent, normalizeGameConfig, paintFrameCell,
  type Frame, type GameConfig, type GameEvent, type GameInstance, type GameSnapshot,
  type HexColor, type NormalizedGameConfig, type PlayerReadyGate, type PlayerReadyTransition,
  type PlayerReadyZone, type PressEvent, type SeededRng, type TickEvent
} from "@motion-levels-games/game-sdk";
import {
  paintProgressiveTileReveal,
  paintSparseBlockPulses,
  paintSparseTilePulses,
  paintStaggeredTileReveal,
  sampleBeatPulse,
  sampleSmoothPulse
} from "@motion-levels-games/game-sdk/effects";
import { manifest } from "./manifest.ts";

const targetSize = 2;
export const finishMillis = 4_000;
const hitFlashMillis = 420;
const recentHitMillis = 900;
const targetRevealMillis = 280;
const targetUrgencyMillis = 850;
const baseLifeMillis = 3_400;
const minLifeMillis = 2_300;
const idleColor: HexColor = "#03060b";
const waitingSeedSalt = 0x32ca_91e7;
const victorySeedSalt = 0x71a4_c53d;

export const moleReadyZoneAnimation = {
  occupied: { minIntensity: 22, maxIntensity: 42, periodMillis: 640 },
  unoccupied: { minIntensity: 60, maxIntensity: 100, periodMillis: 1_600 }
} as const;

export const moleWaitingIdleAnimation = {
  cycleMillis: 4_000,
  density: 0.25,
  exclusionPadding: 2,
  gap: 1,
  maxIntensity: 14,
  pulseMillis: 1_300,
  size: 2
} as const;

export const moleStartingAnimation = {
  beatAttackMillis: 80,
  beatReleaseMillis: 300,
  confirmationMillis: 220,
  launchFlashIntensity: 96,
  launchFlashMillis: 220,
  previewMaxIntensity: 40,
  revealFadeSpan: 0.16,
  zoneBaseIntensity: 48,
  zoneBeatIntensity: 72
} as const;

export const moleVictoryAnimation = {
  impactMillis: 240,
  revealMillis: 1_300,
  revealFadeSpan: 0.09,
  revealBaseIntensity: 60,
  revealVariationIntensity: 18,
  pulseMinIntensity: 48,
  pulseMaxIntensity: 62,
  pulsePeriodMillis: 1_500,
  sparkleCycleMillis: 950,
  sparkleDensity: 0.22,
  sparkleMillis: 620,
  sparkleIntensity: 100
} as const;

export type MoleTarget = { playerIndex: number; x: number; y: number; bornMillis: number; deadlineMillis: number };
export type MolePlayerProgress = {
  index: number;
  label: string;
  color: HexColor;
  score: number;
  hits: number;
  lastPoints: number;
  lastHitAtMillis: number;
};
export type WhackAMoleSnapshot = GameSnapshot & {
  phase: "waiting" | "starting" | "running" | "finished";
  difficulty: NormalizedGameConfig["difficulty"];
  targets: Array<MoleTarget & { remainingMillis: number }>;
  playerProgress: MolePlayerProgress[];
  readyPlayerIndices: number[];
  winnerIndex: number;
  winnerLabel: string;
  motionEventId: number;
  recentHitPlayerIndex: number;
};
export type WhackAMoleGameInstance = Omit<GameInstance, "snapshot"> & {
  snapshot(): WhackAMoleSnapshot;
  playerReadyZones(): PlayerReadyZone[];
};

export function createGame(config: GameConfig): WhackAMoleGameInstance { return new WhackAMoleGame(config); }

class WhackAMoleGame implements WhackAMoleGameInstance {
  private config: NormalizedGameConfig;
  private rng: SeededRng;
  private readyZones: PlayerReadyZone[];
  private readyGate: PlayerReadyGate;
  private players: MolePlayerProgress[] = [];
  private targets: MoleTarget[] = [];
  private startingTargets: Array<Pick<MoleTarget, "playerIndex" | "x" | "y">> = [];
  private lastPositions: Array<{ x: number; y: number } | undefined> = [];
  private catchUp: boolean[] = [];
  private hitFlash: Array<{ x: number; y: number; startedMillis: number; untilMillis: number; color: HexColor }> = [];
  private phase: WhackAMoleSnapshot["phase"] = "waiting";
  private nowMillis = 0;
  private countdownStartedAtMillis = 0;
  private startedAtMillis = 0;
  private finishAtMillis = 0;
  private winnerIndex = -1;
  private motionEventId = 0;
  private lastEvent: GameEvent = gameEvent("none", "Listo", 0);

  constructor(config: GameConfig) {
    this.config = normalizeGameConfig(config, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.readyZones = readyZonesForPlayers(this.config.playerCount);
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones, this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  init(nowMillis: number): GameEvent[] { this.resetState(nowMillis); this.lastEvent = gameEvent("ready", "Busca tu plataforma de color", nowMillis); return [this.lastEvent]; }

  press(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.record(this.applyReady(this.readyGate.update(event), event.atMillis));
    if (this.phase !== "running" || !event.pressed) return [];
    const targetIndex = this.targets.findIndex((target) => event.atMillis < target.deadlineMillis && containsTarget(target, event.x, event.y));
    if (targetIndex < 0) return [];
    const target = this.targets[targetIndex]!;
    const player = this.players[target.playerIndex]!;
    const points = targetScore(target, event.atMillis);
    player.score += points;
    player.hits += 1;
    player.lastPoints = points;
    player.lastHitAtMillis = event.atMillis;
    for (let dy = 0; dy < targetSize; dy += 1) for (let dx = 0; dx < targetSize; dx += 1) this.hitFlash.push({
      x: target.x + dx,
      y: target.y + dy,
      startedMillis: event.atMillis,
      untilMillis: event.atMillis + hitFlashMillis,
      color: player.color
    });
    this.lastPositions[target.playerIndex] = { x: target.x, y: target.y };
    this.targets.splice(targetIndex, 1);
    this.spawnTarget(target.playerIndex, event.atMillis);
    this.motionEventId += 1;
    return this.record([gameEvent("mole-hit", `${player.label} +${points}`, event.atMillis)]);
  }

  release(event: PressEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.record(this.applyReady(this.readyGate.update({ ...event, pressed: false }), event.atMillis));
    return [];
  }

  tick(event: TickEvent): GameEvent[] {
    this.nowMillis = event.atMillis;
    if (this.phase === "waiting" || this.phase === "starting") return this.record(this.applyReady(this.readyGate.tick(event.atMillis), event.atMillis));
    if (this.phase === "finished") {
      if (event.atMillis - this.finishAtMillis >= finishMillis) { this.resetState(event.atMillis); return this.record([gameEvent("ready", "Nueva caza", event.atMillis)]); }
      return [];
    }
    this.hitFlash = this.hitFlash.filter((flash) => flash.untilMillis > event.atMillis);
    const expired = this.targets.filter((target) => event.atMillis >= target.deadlineMillis);
    for (const target of expired) { this.catchUp[target.playerIndex] = true; this.targets = this.targets.filter((candidate) => candidate !== target); this.spawnTarget(target.playerIndex, event.atMillis); }
    if (this.remainingMillis() <= 0) return this.finish(event.atMillis);
    if (expired.length === 0) return [];
    this.motionEventId += 1;
    const escapedPlayers = expired.map((target) => this.players[target.playerIndex]?.label).filter(Boolean);
    const message = expired.length === 1
      ? `Se escapó el topo de ${escapedPlayers[0] ?? "un jugador"}`
      : `Se escaparon ${expired.length} topos`;
    return this.record([gameEvent("target-expired", message, event.atMillis)]);
  }

  render(): Frame {
    const frame = createFrame(idleColor);
    if (this.phase === "waiting") { this.drawWaiting(frame); return frame; }
    if (this.phase === "starting") { this.drawStarting(frame); return frame; }
    if (this.phase === "finished") { this.drawFinish(frame); return frame; }
    this.drawTargets(frame);
    for (const flash of this.hitFlash) {
      const progress = clamp((this.nowMillis - flash.startedMillis) / hitFlashMillis, 0, 1);
      const whiteMix = Math.round((1 - progress) * 88 + 12);
      paintFrameCell(frame, flash.x, flash.y, mixWithWhite(flash.color, whiteMix));
    }
    return frame;
  }

  snapshot(): WhackAMoleSnapshot {
    const ready = this.readyGate.state(this.nowMillis);
    return {
      currentGame: manifest.id, label: manifest.label, phase: this.phase, playerCount: this.config.playerCount,
      difficulty: this.config.difficulty,
      players: this.players.map((player) => ({ index: player.index, label: player.label, color: player.color, score: player.score, lives: -1 })),
      score: this.players.reduce((sum, player) => sum + player.score, 0), lives: -1,
      elapsedMillis: this.elapsedMillis(), remainingMillis: this.phase === "finished" ? Math.max(0, this.finishAtMillis + finishMillis - this.nowMillis) : this.remainingMillis(),
      activeTargets: this.targets.length, success: this.phase === "finished", lastEventCue: this.lastEvent.cue, lastEventMessage: this.lastEvent.message,
      countdownMillis: this.phase === "starting" ? ready.countdownMillis : 0, readyPlayers: ready.readyPlayers, requiredPlayers: ready.requiredPlayers,
      targets: this.targets.map((target) => ({ ...target, remainingMillis: Math.max(0, target.deadlineMillis - this.nowMillis) })),
      playerProgress: this.players.map((player) => ({ ...player })),
      readyPlayerIndices: this.readyZones.flatMap((_, index) => this.readyGate.zoneReady(index, this.nowMillis) ? [index] : []),
      winnerIndex: this.winnerIndex,
      winnerLabel: this.players[this.winnerIndex]?.label ?? "",
      motionEventId: this.motionEventId,
      recentHitPlayerIndex: this.recentHitPlayerIndex()
    };
  }

  reset(config: Partial<GameConfig> = {}): void {
    this.config = normalizeGameConfig({ ...this.config, ...config }, manifest);
    this.rng = createSeededRng(this.config.seed);
    this.readyZones = readyZonesForPlayers(this.config.playerCount);
    this.readyGate = createPlayerReadyGate(manifest.start, this.readyZones, this.config.nowMillis);
    this.resetState(this.config.nowMillis);
  }

  playerReadyZones(): PlayerReadyZone[] { return this.readyZones.map((zone) => ({ ...zone })); }

  private resetState(nowMillis: number): void {
    this.rng = createSeededRng(this.config.seed);
    this.readyGate.reset(nowMillis);
    const roster = defaultPlayers(this.config.playerCount, this.config.players);
    this.players = roster.map((player, index) => ({
      index,
      label: player.label === `Player ${index + 1}` ? `Jugador ${index + 1}` : player.label,
      color: player.color,
      score: 0,
      hits: 0,
      lastPoints: 0,
      lastHitAtMillis: 0
    }));
    this.targets = []; this.startingTargets = []; this.lastPositions = []; this.catchUp = []; this.hitFlash = [];
    this.phase = "waiting"; this.nowMillis = nowMillis; this.countdownStartedAtMillis = 0; this.startedAtMillis = nowMillis; this.finishAtMillis = 0; this.winnerIndex = -1; this.motionEventId = 0;
    this.lastEvent = gameEvent("ready", "Busca tu plataforma de color", nowMillis);
  }

  private applyReady(transition: PlayerReadyTransition, nowMillis: number): GameEvent[] {
    if (transition === "players-ready") {
      this.phase = "starting";
      this.countdownStartedAtMillis = nowMillis;
      this.startingTargets = [];
      this.players.forEach((_, playerIndex) => {
        this.startingTargets.push({
          playerIndex,
          ...this.chooseTargetPosition(playerIndex, this.startingTargets)
        });
      });
      this.motionEventId += 1;
      return [gameEvent("ready", "Todos listos para cazar", nowMillis)];
    }
    if (transition === "players-left") { this.phase = "waiting"; this.countdownStartedAtMillis = 0; this.startingTargets = []; this.motionEventId += 1; return [gameEvent("ready", "Vuelve a tu plataforma", nowMillis)]; }
    if (transition === "started") {
      this.phase = "running"; this.countdownStartedAtMillis = 0; this.startedAtMillis = nowMillis;
      this.targets = this.startingTargets.map((target) => this.createTarget(target.playerIndex, target.x, target.y, nowMillis));
      this.startingTargets = [];
      this.motionEventId += 1; return [gameEvent("start", "¡Atrapa los topos de colores!", nowMillis)];
    }
    return [];
  }

  private spawnTarget(playerIndex: number, nowMillis: number): void {
    const chosen = this.chooseTargetPosition(playerIndex, this.targets);
    this.targets.push(this.createTarget(playerIndex, chosen.x, chosen.y, nowMillis));
  }

  private chooseTargetPosition(
    playerIndex: number,
    occupiedTargets: ReadonlyArray<Pick<MoleTarget, "x" | "y">>
  ): { x: number; y: number } {
    let chosen: { x: number; y: number } | undefined;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const candidate = { x: this.rng.int(FLOOR_COLS - targetSize + 1), y: this.rng.int(FLOOR_ROWS - targetSize + 1) };
      const last = this.lastPositions[playerIndex];
      const distance = last ? (candidate.x - last.x) ** 2 + (candidate.y - last.y) ** 2 : 64;
      const clear = occupiedTargets.every((target) => Math.abs(candidate.x - target.x) >= 4 || Math.abs(candidate.y - target.y) >= 4);
      if (clear && this.targetOutsideReadyZones(candidate.x, candidate.y) && distance >= 25 && distance <= 225) {
        chosen = candidate;
        break;
      }
    }
    if (chosen) return chosen;
    for (let y = 0; y <= FLOOR_ROWS - targetSize; y += 1) {
      for (let x = 0; x <= FLOOR_COLS - targetSize; x += 1) {
        if (!this.targetOutsideReadyZones(x, y)) continue;
        if (occupiedTargets.every((target) => Math.abs(x - target.x) >= 4 || Math.abs(y - target.y) >= 4)) {
          return { x, y };
        }
      }
    }
    return { x: Math.floor((FLOOR_COLS - targetSize) / 2), y: Math.floor((FLOOR_ROWS - targetSize) / 2) };
  }

  private targetOutsideReadyZones(x: number, y: number): boolean {
    const maxX = x + targetSize - 1;
    const maxY = y + targetSize - 1;
    return this.readyZones.every((zone) => (
      maxX < zone.minX - 1 || x > zone.maxX + 1 || maxY < zone.minY - 1 || y > zone.maxY + 1
    ));
  }

  private createTarget(playerIndex: number, x: number, y: number, nowMillis: number): MoleTarget {
    const interval = this.targetInterval();
    const extra = this.catchUp[playerIndex] ? 2_000 : 0;
    this.catchUp[playerIndex] = false;
    return { playerIndex, x, y, bornMillis: nowMillis, deadlineMillis: nowMillis + interval + 1_000 + extra };
  }

  private targetInterval(): number { const progress = clamp(this.elapsedMillis() / this.config.durationMillis, 0, 1); const base = baseLifeMillis - 1_000; const drop = baseLifeMillis - minLifeMillis; const difficulty = this.config.difficulty === "easy" ? 1.18 : 1; return (base - progress * drop) * difficulty; }
  private finish(atMillis: number): GameEvent[] { this.phase = "finished"; this.finishAtMillis = atMillis; this.targets = []; this.winnerIndex = this.players.reduce((best, player, index) => player.score > (this.players[best]?.score ?? -1) ? index : best, 0); this.motionEventId += 1; return this.record([gameEvent("win", `¡Gana ${this.players[this.winnerIndex]?.label}!`, atMillis)]); }
  private elapsedMillis(): number { return this.phase === "waiting" || this.phase === "starting" ? 0 : Math.max(0, this.nowMillis - this.startedAtMillis); }
  private remainingMillis(): number { return Math.max(0, this.config.durationMillis - this.elapsedMillis()); }
  private record(events: GameEvent[]): GameEvent[] { const latest = events.at(-1); if (latest) this.lastEvent = latest; return events; }

  private recentHitPlayerIndex(): number {
    let recentIndex = -1;
    let recentAt = Number.NEGATIVE_INFINITY;
    for (const player of this.players) {
      if (player.hits === 0 || this.nowMillis - player.lastHitAtMillis >= recentHitMillis
        || player.lastHitAtMillis <= recentAt) continue;
      recentAt = player.lastHitAtMillis;
      recentIndex = player.index;
    }
    return recentIndex;
  }

  private drawWaiting(frame: Frame): void {
    paintSparseBlockPulses(frame, {
      atMillis: this.nowMillis,
      blockHeight: moleWaitingIdleAnimation.size,
      blockWidth: moleWaitingIdleAnimation.size,
      color: ({ intensity, variant }) => {
        const index = Math.min(this.players.length - 1, Math.floor(variant * this.players.length));
        return scaleHex(this.players[index]?.color ?? "#36d9ff", intensity * moleWaitingIdleAnimation.maxIntensity / 100);
      },
      cycleMillis: moleWaitingIdleAnimation.cycleMillis,
      density: moleWaitingIdleAnimation.density,
      exclude: ({ x, y }) => this.readyZones.some((zone) => {
        const padding = moleWaitingIdleAnimation.exclusionPadding;
        return x >= zone.minX - padding && x <= zone.maxX + padding && y >= zone.minY - padding && y <= zone.maxY + padding;
      }),
      gapX: moleWaitingIdleAnimation.gap,
      gapY: moleWaitingIdleAnimation.gap,
      pulseMillis: moleWaitingIdleAnimation.pulseMillis,
      seed: (this.config.seed ^ waitingSeedSalt) >>> 0
    });
    this.drawReadyZones(frame);
  }

  private drawStarting(frame: Frame): void {
    const countdownDuration = manifest.start.mode === "player-ready" ? (manifest.start.countdownMillis ?? 2_000) : 0;
    const elapsed = clamp(this.nowMillis - this.countdownStartedAtMillis, 0, countdownDuration);
    const revealDuration = Math.max(1, countdownDuration - moleStartingAnimation.confirmationMillis);
    const progress = clamp((elapsed - moleStartingAnimation.confirmationMillis) / revealDuration, 0, 1);
    paintProgressiveTileReveal(frame, {
      color: ({ intensity, x, y }) => {
        const target = this.startingTargets.find((candidate) => containsTarget(candidate, x, y));
        if (!target) return undefined;
        const color = this.players[target.playerIndex]?.color ?? "#36d9ff";
        return scaleHex(color, intensity * moleStartingAnimation.previewMaxIntensity / 100);
      },
      fadeSpan: moleStartingAnimation.revealFadeSpan,
      progress,
      threshold: ({ x, y }) => this.startingRevealThreshold(x, y)
    });
    const beat = sampleBeatPulse({
      atMillis: elapsed,
      attackMillis: moleStartingAnimation.beatAttackMillis,
      periodMillis: 1_000,
      releaseMillis: moleStartingAnimation.beatReleaseMillis
    });
    const intensity = moleStartingAnimation.zoneBaseIntensity
      + beat * (moleStartingAnimation.zoneBeatIntensity - moleStartingAnimation.zoneBaseIntensity);
    this.drawReadyZones(frame, intensity);
  }

  private startingRevealThreshold(x: number, y: number): number | undefined {
    const target = this.startingTargets.find((candidate) => containsTarget(candidate, x, y));
    const zone = target ? this.readyZones[target.playerIndex] : undefined;
    if (!target || !zone) return undefined;
    const maxDistance = Math.max(
      this.distanceFromReadyZone(0, 0, zone),
      this.distanceFromReadyZone(FLOOR_COLS - 1, 0, zone),
      this.distanceFromReadyZone(0, FLOOR_ROWS - 1, zone),
      this.distanceFromReadyZone(FLOOR_COLS - 1, FLOOR_ROWS - 1, zone)
    );
    return maxDistance > 0 ? this.distanceFromReadyZone(x, y, zone) / maxDistance : 0;
  }

  private distanceFromReadyZone(x: number, y: number, zone: PlayerReadyZone): number {
    const distanceX = x < zone.minX ? zone.minX - x : x > zone.maxX ? x - zone.maxX : 0;
    const distanceY = y < zone.minY ? zone.minY - y : y > zone.maxY ? y - zone.maxY : 0;
    return distanceX + distanceY;
  }

  private drawReadyZones(frame: Frame, fixedIntensity?: number): void {
    this.players.forEach((player, index) => {
      const zone = this.readyZones[index]!;
      const ready = this.readyGate.zoneReady(index, this.nowMillis);
      const profile = ready ? moleReadyZoneAnimation.occupied : moleReadyZoneAnimation.unoccupied;
      const intensity = fixedIntensity ?? sampleSmoothPulse({
        atMillis: this.nowMillis,
        minValue: profile.minIntensity,
        maxValue: profile.maxIntensity,
        periodMillis: profile.periodMillis
      });
      fillFrameRect(
        frame,
        zone.minX,
        zone.minY,
        zone.maxX - zone.minX + 1,
        zone.maxY - zone.minY + 1,
        scaleHex(player.color, intensity / 100)
      );
    });
  }

  private drawTargets(frame: Frame): void {
    const launchProgress = clamp(
      (this.nowMillis - this.startedAtMillis) / moleStartingAnimation.launchFlashMillis,
      0,
      1
    );
    const launchBoost = 1 - launchProgress * launchProgress * (3 - 2 * launchProgress);
    for (const target of this.targets) {
      const player = this.players[target.playerIndex]!;
      const age = Math.max(0, this.nowMillis - target.bornMillis);
      const remaining = Math.max(0, target.deadlineMillis - this.nowMillis);
      const reveal = clamp(age / targetRevealMillis, 0, 1);
      const urgentPulse = sampleSmoothPulse({
        atMillis: this.nowMillis,
        minValue: 64,
        maxValue: 100,
        periodMillis: 360,
        phaseOffsetMillis: target.playerIndex * 47
      });
      const runningIntensity = remaining <= targetUrgencyMillis ? urgentPulse : 88;
      const steadyIntensity = runningIntensity
        + (moleStartingAnimation.launchFlashIntensity - runningIntensity) * launchBoost;
      for (let dy = 0; dy < targetSize; dy += 1) {
        for (let dx = 0; dx < targetSize; dx += 1) {
          const cellIndex = dy * targetSize + dx;
          const cellReveal = Math.max(launchBoost, clamp((reveal * 1.6) - cellIndex * 0.2, 0, 1));
          if (cellReveal <= 0) continue;
          paintFrameCell(frame, target.x + dx, target.y + dy, scaleHex(player.color, steadyIntensity * cellReveal / 100));
        }
      }
    }
  }

  private drawFinish(frame: Frame): void {
    const winnerColor = this.players[this.winnerIndex]?.color ?? "#36d9ff";
    const elapsed = Math.max(0, this.nowMillis - this.finishAtMillis);
    if (elapsed < moleVictoryAnimation.impactMillis) {
      fillFrameRect(frame, 7, 15, 2, 2, mixWithWhite(winnerColor, 72));
      return;
    }
    const revealProgress = clamp(
      (elapsed - moleVictoryAnimation.impactMillis) / moleVictoryAnimation.revealMillis,
      0,
      1
    );
    const seed = (this.config.seed ^ victorySeedSalt ^ (this.winnerIndex + 1) * 1_009) >>> 0;
    paintStaggeredTileReveal(frame, {
      color: ({ intensity, variant }) => scaleHex(
        winnerColor,
        Math.max(0.08, (moleVictoryAnimation.revealBaseIntensity
          + variant * moleVictoryAnimation.revealVariationIntensity) * intensity / 100)
      ),
      fadeSpan: moleVictoryAnimation.revealFadeSpan,
      progress: revealProgress,
      seed
    });
    if (revealProgress < 1) return;
    const celebrationMillis = elapsed - moleVictoryAnimation.impactMillis - moleVictoryAnimation.revealMillis;
    const pulseIntensity = sampleSmoothPulse({
      atMillis: celebrationMillis,
      minValue: moleVictoryAnimation.pulseMinIntensity,
      maxValue: moleVictoryAnimation.pulseMaxIntensity,
      periodMillis: moleVictoryAnimation.pulsePeriodMillis
    });
    fillFrameRect(frame, 0, 0, FLOOR_COLS, FLOOR_ROWS, scaleHex(winnerColor, pulseIntensity / 100));
    paintSparseTilePulses(frame, {
      atMillis: celebrationMillis,
      color: ({ intensity }) => mixWithWhite(winnerColor, intensity * moleVictoryAnimation.sparkleIntensity),
      cycleMillis: moleVictoryAnimation.sparkleCycleMillis,
      density: moleVictoryAnimation.sparkleDensity,
      pulseMillis: moleVictoryAnimation.sparkleMillis,
      seed
    });
  }
}

export function readyZonesForPlayers(count: number): PlayerReadyZone[] {
  const points = [[0,0],[12,28],[0,28],[12,0],[0,14],[12,14],[6,0],[6,28]];
  return points.slice(0, clamp(Math.trunc(count), 1, 8)).map(([x = 0, y = 0]) => ({ minX: x, maxX: x + 3, minY: y, maxY: y + 3 }));
}

function containsTarget(target: Pick<MoleTarget, "x" | "y">, x: number, y: number): boolean { return x >= target.x && x < target.x + targetSize && y >= target.y && y < target.y + targetSize; }
function targetScore(target: MoleTarget, nowMillis: number): number { const total = Math.max(1, target.deadlineMillis - target.bornMillis); return 4 + Math.ceil(clamp((target.deadlineMillis - nowMillis) / total, 0, 1) * 8); }
function scaleHex(color: HexColor, factor: number): HexColor { const value = color.replace("#", ""); const parts = [0,2,4].map((offset) => Math.round(Number.parseInt(value.slice(offset, offset + 2), 16) * factor).toString(16).padStart(2, "0")); return `#${parts.join("")}`; }
function mixWithWhite(color: HexColor, whitePercent: number): HexColor {
  const value = color.replace("#", "");
  const ratio = clamp(whitePercent / 100, 0, 1);
  const parts = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16);
    return Math.round(channel + (255 - channel) * ratio).toString(16).padStart(2, "0");
  });
  return `#${parts.join("")}`;
}
