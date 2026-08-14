import type { EngineStatus } from "./api";
import { playerColors, type GameCard } from "./catalog.ts";
import { playerBoundsForGame } from "./catalogSync.ts";
import { hexToColor, initials } from "./utils.ts";

export type Player = {
  id: number;
  name: string;
  color: string;
  active: boolean;
};

export type RosterIssue = { message: string; playerIds: Set<number> };

export function playerLabel(players: Player[], player: Player): string {
  const name = player.name.trim();
  if (name) return name;
  return `Jugador ${players.indexOf(player) + 1}`;
}

export function rosterSnapshot(players: Player[]) {
  return players
    .filter((player) => player.active)
    .map((player, index) => ({
      index,
      label: playerLabel(players, player),
      color: hexToColor(player.color),
    }));
}

export function avatarLabel(players: Player[], player: Player): string {
  const name = player.name.trim();
  return name ? initials(name) : `${players.indexOf(player) + 1}`;
}

export function normalizeRosterName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-ES");
}

export function colorChannels(color: string): [number, number, number] {
  const normalized = color.trim().replace(/^#/, "");
  if (normalized.length !== 6) return [0, 0, 0];
  return [Number.parseInt(normalized.slice(0, 2), 16), Number.parseInt(normalized.slice(2, 4), 16), Number.parseInt(normalized.slice(4, 6), 16)];
}

export function channelToHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

export function rgbToHex(color: { r: number; g: number; b: number }): string {
  return `#${channelToHex(color.r)}${channelToHex(color.g)}${channelToHex(color.b)}`;
}

export function colorDistanceSquared(a: string, b: string): number {
  const [ar, ag, ab] = colorChannels(a);
  const [br, bg, bb] = colorChannels(b);
  return (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2;
}

export function statusPlayersForDisplay(status: EngineStatus | null): Player[] {
  if (!status?.players?.length) return [];
  return status.players.map((player) => ({
    id: player.index + 1,
    name: player.label,
    color: rgbToHex(player.color),
    active: true,
  }));
}

export function firstAvailableColor(players: Player[], ignoredID?: number): string {
  const used = new Set(players.filter((player) => player.active && player.id !== ignoredID).map((player) => player.color.toLowerCase()));
  const available = playerColors.filter((color) => !used.has(color.toLowerCase()));
  if (available.length === 0) return playerColors[0];

  const activeColors = players.filter((player) => player.active && player.id !== ignoredID).map((player) => player.color);
  if (activeColors.length === 0) return available[0];

  return available.reduce((best, color) => {
    const colorScore = Math.min(...activeColors.map((activeColor) => colorDistanceSquared(color, activeColor)));
    const bestScore = Math.min(...activeColors.map((activeColor) => colorDistanceSquared(best, activeColor)));
    return colorScore > bestScore ? color : best;
  }, available[0]);
}

export function activeRosterIssue(players: Player[]): RosterIssue | null {
  const active = players.filter((player) => player.active);
  const names = new Map<string, Player[]>();
  const colors = new Map<string, Player[]>();

  for (const player of active) {
    const nameKey = normalizeRosterName(playerLabel(players, player));
    if (nameKey) names.set(nameKey, [...(names.get(nameKey) || []), player]);

    const colorKey = player.color.toLowerCase();
    colors.set(colorKey, [...(colors.get(colorKey) || []), player]);
  }

  for (const duplicates of names.values()) {
    if (duplicates.length > 1) {
      const label = playerLabel(players, duplicates[0]);
      return {
        message: `El nombre "${label}" ya está en uso`,
        playerIds: new Set(duplicates.map((player) => player.id)),
      };
    }
  }

  for (const duplicates of colors.values()) {
    if (duplicates.length > 1) {
      return {
        message: "Cada jugador necesita un color distinto",
        playerIds: new Set(duplicates.map((player) => player.id)),
      };
    }
  }

  return null;
}

export function gameRosterIssue(game: GameCard, players: Player[]): RosterIssue | null {
  // Allow-any launches deliberately send playerCount 0 and omit the configured
  // roster, so neither an empty roster nor duplicate local drafts can block it.
  if (game.allowAnyPlayers) return null;
  const duplicateIssue = activeRosterIssue(players);
  if (duplicateIssue) return duplicateIssue;
  const active = players.filter((player) => player.active);
  const { maxPlayers: gameMaxPlayers, minPlayers: gameMinPlayers } = playerBoundsForGame(game);
  if (active.length < gameMinPlayers) {
    return {
      message: gameMinPlayers === 1 ? "Necesita al menos 1 jugador" : `Necesita al menos ${gameMinPlayers} jugadores`,
      playerIds: new Set(active.map((player) => player.id)),
    };
  }
  if (active.length > gameMaxPlayers) {
    return {
      message: gameMaxPlayers === 1 ? "Máximo 1 jugador" : `Máximo ${gameMaxPlayers} jugadores`,
      playerIds: new Set(active.map((player) => player.id)),
    };
  }
  return null;
}
