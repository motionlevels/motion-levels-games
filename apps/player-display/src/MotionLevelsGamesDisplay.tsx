import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DisplayStatus } from "./api";
import { displayErrorMessage, runtimeRetryDelayMillis, type GamesDisplayRenderState } from "./displayRuntime";
import { useVenueFloorRotation } from "./venueFloorRotation";

type GamesDisplayRuntime = {
  revision: string;
  mount(element: Element, input: GamesDisplayInput): void;
  update(element: Element, input: GamesDisplayInput): void;
  unmount(element: Element): void;
};

type GamesDisplayInput = {
  gameId: string;
  snapshot: Record<string, unknown>;
  frame?: DisplayStatus["frame"];
  paused: boolean;
  floorRotationDegrees: 0 | 90 | 180 | 270;
  onError?: (reason: unknown) => void;
};

declare global {
  interface Window {
    MotionLevelsGamesDisplay?: GamesDisplayRuntime;
  }
}

type MotionLevelsGamesDisplayProps = {
  status: DisplayStatus;
  fallback: ReactNode;
  onStateChange: (state: GamesDisplayRenderState) => void;
};

export function MotionLevelsGamesDisplay({ status, fallback, onStateChange }: MotionLevelsGamesDisplayProps) {
  const floorRotationDegrees = useVenueFloorRotation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderState, setRenderState] = useState<GamesDisplayRenderState>(() => renderLoadingState(status.sourceRevision || ""));
  const revision = status.sourceRevision || "";
  const gameId = gameID(status);
  const hasSnapshot = status.gameSnapshot !== undefined;
  const latestInput = useRef<GamesDisplayInput>({
    gameId,
    snapshot: status.gameSnapshot ?? {},
    frame: status.frame,
    paused: status.phase === "paused",
    floorRotationDegrees,
  });
  latestInput.current = {
    gameId,
    snapshot: status.gameSnapshot ?? {},
    frame: status.frame,
    paused: status.phase === "paused",
    floorRotationDegrees,
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !revision || !hasSnapshot) return;
    let cancelled = false;
    let retryHandle: number | null = null;
    let mountedRuntime: GamesDisplayRuntime | null = null;

    const publish = (next: GamesDisplayRenderState) => {
      if (cancelled) return;
      setRenderState(next);
      onStateChange(next);
    };
    const runtimeInput = (): GamesDisplayInput => ({
      ...latestInput.current,
      onError: (reason) => {
        if (cancelled) return;
        safelyUnmount(mountedRuntime, host);
        mountedRuntime = null;
        publish({
          status: "error",
          expectedRevision: revision,
          loadedRevision: revision,
          attempt: 0,
          error: displayErrorMessage(reason),
        });
      },
    });
    const connect = (attempt: number, error = "") => {
      publish({
        status: attempt === 0 ? "loading" : "fallback",
        expectedRevision: revision,
        loadedRevision: "",
        attempt,
        error,
      });
      const delay = runtimeRetryDelayMillis(attempt);
      retryHandle = window.setTimeout(() => {
        retryHandle = null;
        loadRuntime(revision)
          .then((runtime) => {
            if (cancelled) return;
            mountedRuntime = runtime;
            runtime.mount(host, runtimeInput());
            if (mountedRuntime !== runtime) return;
            publish({ status: "ready", expectedRevision: revision, loadedRevision: runtime.revision, attempt, error: "" });
          })
          .catch((reason) => {
            if (cancelled) return;
            mountedRuntime = null;
            connect(attempt + 1, displayErrorMessage(reason));
          });
      }, delay);
    };
    connect(0);

    return () => {
      cancelled = true;
      if (retryHandle !== null) window.clearTimeout(retryHandle);
      safelyUnmount(mountedRuntime, host);
    };
  }, [gameId, hasSnapshot, revision, onStateChange]);

  useEffect(() => {
    const host = hostRef.current;
    const runtime = window.MotionLevelsGamesDisplay;
    if (!host || renderState.status !== "ready" || runtime?.revision !== revision || !status.gameSnapshot) return;
    try {
      runtime.update(host, {
        gameId,
        snapshot: status.gameSnapshot,
        frame: status.frame,
        paused: status.phase === "paused",
        floorRotationDegrees,
        onError: (reason) => {
          safelyUnmount(runtime, host);
          const next = {
            status: "error",
            expectedRevision: revision,
            loadedRevision: revision,
            attempt: renderState.attempt,
            error: displayErrorMessage(reason),
          } satisfies GamesDisplayRenderState;
          setRenderState(next);
          onStateChange(next);
        },
      });
    } catch (reason) {
      safelyUnmount(runtime, host);
      const next = {
        status: "error",
        expectedRevision: revision,
        loadedRevision: revision,
        attempt: renderState.attempt,
        error: displayErrorMessage(reason),
      } satisfies GamesDisplayRenderState;
      setRenderState(next);
      onStateChange(next);
    }
  }, [floorRotationDegrees, gameId, onStateChange, renderState.attempt, renderState.status, revision, status.frame, status.gameSnapshot, status.phase]);

  return (
    <main className="motion-levels-games-display-host">
      <div ref={hostRef} className={`motion-levels-games-display-root ${renderState.status === "ready" ? "is-ready" : "is-hidden"}`} />
      {renderState.status === "ready" ? null : <div className="motion-levels-games-display-fallback">{fallback}</div>}
    </main>
  );
}

function renderLoadingState(revision: string): GamesDisplayRenderState {
  return { status: "loading", expectedRevision: revision, loadedRevision: "", attempt: 0, error: "" };
}

function safelyUnmount(runtime: GamesDisplayRuntime | null, host: Element): void {
  try {
    runtime?.unmount(host);
  } catch {
    host.replaceChildren();
  }
}

function gameID(status: DisplayStatus) {
  return status.currentGame.startsWith("motion-levels-games:")
    ? status.currentGame.slice("motion-levels-games:".length)
    : String(status.gameSnapshot?.currentGame || status.currentGame);
}

let pendingRuntime: { revision: string; promise: Promise<GamesDisplayRuntime>; script: HTMLScriptElement } | null = null;

function loadRuntime(revision: string): Promise<GamesDisplayRuntime> {
  const existing = window.MotionLevelsGamesDisplay;
  if (existing?.revision === revision) return Promise.resolve(existing);
  if (pendingRuntime?.revision === revision) return pendingRuntime.promise;
  pendingRuntime?.script.remove();
  const script = document.createElement("script");
  const promise = new Promise<GamesDisplayRuntime>((resolve, reject) => {
    script.src = `${gamesAssetBaseURL()}/${encodeURIComponent(revision)}/display/display.js`;
    script.async = true;
    script.dataset.motionLevelsGamesRevision = revision;
    script.onload = () => {
      const runtime = window.MotionLevelsGamesDisplay;
      if (runtime?.revision !== revision) {
        reject(new Error("La revisión de la pantalla no coincide con el juego"));
        return;
      }
      resolve(runtime);
    };
    script.onerror = () => reject(new Error("No se pudo cargar la pantalla del juego"));
    document.head.append(script);
  });
  pendingRuntime = { revision, promise, script };
  const clearPending = () => {
    if (pendingRuntime?.promise === promise) pendingRuntime = null;
  };
  void promise.then(clearPending, () => {
    script.remove();
    clearPending();
  });
  return promise;
}

function gamesAssetBaseURL() {
  const override = import.meta.env.VITE_MOTION_LEVELS_GAMES_ASSET_URL?.trim();
  if (override) return override.replace(/\/$/u, "");
  const gateway = window.location.pathname.match(/^(\/gateways\/[^/]+)\/display(?:\/|$)/u);
  if (gateway) return `${window.location.origin}${gateway[1]}/games`;
  return `${window.location.origin}/games`;
}
