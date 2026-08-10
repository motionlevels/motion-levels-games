import type {
  SessionController,
  SessionControllerFactoryOptions,
  SessionControllerObservation
} from "../contracts.ts";
import { setAvatarTarget, type Avatar } from "./avatar.ts";
import { centroid, matchesColor, nearestTile, resolveReadyZones } from "./readyZones.ts";
import { litTiles, sameTile, tileDistance } from "./tileMath.ts";
import type { GameSession } from "./session.ts";

const THINK_INTERVAL_MILLIS = 380;
const WANDER_INTERVAL_MILLIS = 1_400;

/**
 * Ready-zone choreography is host behavior, not gameplay AI. It only gets
 * automated players through the same pre-game floor handshake as people;
 * every running decision is supplied through a SessionController.
 */
export class ReadyZoneDirector {
  private lastThinkAt = Number.NEGATIVE_INFINITY;

  reset(): void {
    this.lastThinkAt = Number.NEGATIVE_INFINITY;
  }

  update(session: GameSession): void {
    const now = session.clockMillis;
    if (now - this.lastThinkAt < THINK_INTERVAL_MILLIS) return;
    this.lastThinkAt = now;

    const phase = String(session.state.snapshot.phase);
    if (phase === "waiting" || phase === "starting") {
      // Product controllers intentionally do not duplicate each game's ready
      // choreography. Jugar moves every automated avatar into its authoritative
      // zone, then hands running decisions back to the product adapter.
      const bots = session.avatars.filter((avatar) => avatar.isBot);
      claimReadyZones(session, bots);
    }
  }
}

/**
 * Compatibility controller for games that have not registered a semantic
 * product controller yet. It preserves the deployed seeded roaming behavior,
 * but runs through the same observation/action seam as every product policy.
 * The Agents 3D lab remains capability-gated to explicit product factories.
 */
export function createSeededFallbackController(
  options: SessionControllerFactoryOptions
): SessionController {
  const random = new SeededRandom(mixSeed(options.seed, options.playerIndex + 1));
  let nextDecisionAt = Number.NEGATIVE_INFINITY;
  return {
    id: options.id,
    step(observation: SessionControllerObservation) {
      if (String(observation.snapshot.phase) !== "running"
        || observation.self.target
        || observation.atMillis < nextDecisionAt) {
        return undefined;
      }
      const lit = litTiles(observation.frame);
      const ownColored = lit.filter((tile) => matchesColor(tile.color, observation.self.color));
      const relevant = ownColored.length > 0 ? ownColored : lit;
      const occupied = observation.avatars
        .filter((avatar) => avatar.id !== observation.self.id)
        .map((avatar) => avatar.target ?? avatar.tile);
      const candidates = relevant.filter(
        (tile) => tileDistance(tile, observation.self.tile) <= 8
          && !occupied.some((spot) => tileDistance(tile, spot) <= 1)
      );
      const pool = candidates.length > 0 ? candidates : relevant;
      const target = pool.length > 0 ? pool[random.int(pool.length)] : undefined;
      nextDecisionAt = observation.atMillis
        + WANDER_INTERVAL_MILLIS * (0.7 + random.next() * 0.8);
      if (!target) return { explanation: "Generic fallback found no lit target" };
      const explanation = "Generic seeded fallback selected a lit tile; no product controller is registered";
      return {
        action: { kind: "move", target, explanation },
        explanation
      };
    }
  };
}

/**
 * Each robot takes the zone belonging to its own player — the same way a real
 * group lines up, one person per colored zone — leaving the human's player
 * (the one nearest the camera) for the human. Standing in the wrong zone
 * leaves one empty and the game correctly refuses to start, exactly as it does
 * in the venue.
 */
function claimReadyZones(session: GameSession, bots: Avatar[]): void {
  const zones = resolveReadyZones(session.instance, session.state.frame, session.state.snapshot);
  if (zones.length === 0) {
    return;
  }

  for (const bot of bots) {
    const zone = zones[bot.playerIndex] ?? zones[bot.playerIndex % zones.length];
    if (!zone || zone.length === 0) {
      continue;
    }
    bot.zoneIndex = bot.playerIndex;

    const spot = nearestTile(zone, bot.tile) ?? centroid(zone);
    if (spot && !sameTile(spot, bot.tile) && !sameTile(spot, bot.target)) {
      setAvatarTarget(bot, spot);
    }
  }
}

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e37_79b9;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("Seeded bot random bound must be a positive integer");
    }
    return Math.floor(this.next() * maxExclusive);
  }
}

function mixSeed(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt, 0x9e37_79b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85eb_ca6b) >>> 0;
  value ^= value >>> 13;
  return value >>> 0;
}
