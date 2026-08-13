// The engine streams display status at ~20Hz. Rendering once per event makes the
// constrained venue PC fall behind: the render queue backs up and the TV ends up
// several seconds late. The coalescer decouples receipt from rendering — it keeps
// only the latest value and renders it at most once per animation frame, so the
// display is always current and never accumulates lag, regardless of how fast the
// engine pushes or how slow the device renders.

export type FrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

export type Coalescer<T> = {
  push: (value: T) => void;
  cancel: () => void;
  pending: () => boolean;
};

export function createCoalescer<T>(scheduler: FrameScheduler, render: (value: T) => void): Coalescer<T> {
  let latest: T | undefined;
  let dirty = false;
  let handle: number | null = null;

  const flush = () => {
    handle = null;
    if (!dirty) return;
    dirty = false;
    render(latest as T);
  };

  return {
    push(value: T) {
      latest = value;
      dirty = true;
      // Only one frame in flight: extra pushes update `latest` without queueing
      // more renders, which is what prevents the backlog.
      if (handle === null) {
        handle = scheduler.request(flush);
      }
    },
    cancel() {
      if (handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
      dirty = false;
    },
    pending() {
      return dirty;
    },
  };
}

// Watchdog helper: when no event has arrived within stallMs the client should
// poll and rebuild the stream, so the display keeps updating even if the event
// stream silently dies (proxy reset, sleeping NIC, etc.).
export function isFeedStalled(lastEventAt: number, now: number, stallMs: number): boolean {
  return now - lastEventAt >= stallMs;
}

export function acceptedPlayerStateRevision(
  currentRevision: number,
  incoming: { contractVersion: number; revision: number },
): number | null {
  if (incoming.contractVersion !== 1) return null;
  if (!Number.isSafeInteger(incoming.revision) || incoming.revision <= currentRevision) return null;
  return incoming.revision;
}
