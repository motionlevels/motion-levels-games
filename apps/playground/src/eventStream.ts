import type { GameEvent } from "@motion-levels-games/game-sdk";

export function eventKey(event: GameEvent, occurrence: number): string {
  return `${event.atMillis}:${event.cue}:${event.message}:${occurrence}`;
}

export function isEventStreamAtLatest(scrollTop: number): boolean {
  return scrollTop <= 1;
}
