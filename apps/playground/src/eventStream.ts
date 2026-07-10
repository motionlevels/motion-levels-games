import type { GameEvent } from "@motion-levels-games/game-sdk";

export function eventKey(event: GameEvent): string {
  return `${event.atMillis}:${event.cue}:${event.message}`;
}

export function isEventStreamAtLatest(scrollTop: number): boolean {
  return scrollTop <= 1;
}
