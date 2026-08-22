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
    MotionLevelsGamesDisplays?: Record<string, GamesDisplayRuntime>;
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
  const runtimeRef = useRef<GamesDisplayRuntime | null>(null);
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
        if (runtimeRef.current === mountedRuntime) runtimeRef.current = null;
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
            runtimeRef.current = runtime;
            runtime.mount(host, runtimeInput());
            if (mountedRuntime !== runtime) return;
            publish({ status: "ready", expectedRevision: revision, loadedRevision: runtime.revision, attempt, error: "" });
          })
          .catch((reason) => {
            if (cancelled) return;
            safelyUnmount(mountedRuntime, host);
            if (runtimeRef.current === mountedRuntime) runtimeRef.current = null;
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
      if (runtimeRef.current === mountedRuntime) runtimeRef.current = null;
    };
  }, [gameId, hasSnapshot, revision, onStateChange]);

  useEffect(() => {
    const host = hostRef.current;
    const runtime = runtimeRef.current;
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
          if (runtimeRef.current === runtime) runtimeRef.current = null;
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
      if (runtimeRef.current === runtime) runtimeRef.current = null;
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

const gamesDisplayLegacyStylesID = "motion-levels-games-display-styles";
const gamesDisplayExternalStylesID = "motion-levels-games-display-stylesheet";

let runtimeLoadGeneration = 0;
let acceptedRuntime: GamesDisplayRuntime | null = null;
let acceptedStylesheet: HTMLStyleElement | HTMLLinkElement | null = null;
let acceptedLegacyStyleText: string | null = null;

let pendingRuntime: {
  generation: number;
  revision: string;
  promise: Promise<GamesDisplayRuntime>;
  script: HTMLScriptElement;
  stylesheet: HTMLLinkElement;
  cancel(reason: Error): void;
} | null = null;

function loadRuntime(revision: string): Promise<GamesDisplayRuntime> {
  const existing = runtimeForRevision(revision);
  const activeStylesheet = activeStylesheetForRevision(revision);
  if (existing && activeStylesheet) {
    acceptedRuntime = existing;
    rememberAcceptedStylesheet(activeStylesheet);
    window.MotionLevelsGamesDisplay = existing;
    return Promise.resolve(existing);
  }
  if (pendingRuntime?.revision === revision) return pendingRuntime.promise;
  pendingRuntime?.cancel(new Error("La carga anterior de la pantalla fue reemplazada"));

  const generation = ++runtimeLoadGeneration;
  const previousStylesheet = currentAcceptedStylesheet();
  if (isLegacyStyle(previousStylesheet)) {
    rememberAcceptedStylesheet(previousStylesheet);
    previousStylesheet.removeAttribute("id");
  }

  const displayAssetURL = `${gamesAssetBaseURL()}/${encodeURIComponent(revision)}/display`;
  const legacyStyle = document.createElement("style");
  legacyStyle.id = gamesDisplayLegacyStylesID;
  legacyStyle.media = "not all";
  legacyStyle.dataset.motionLevelsGamesPendingRevision = revision;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.media = "not all";
  stylesheet.href = `${displayAssetURL}/display.css`;
  stylesheet.dataset.motionLevelsGamesRevision = revision;
  const script = document.createElement("script");
  script.src = `${displayAssetURL}/display.js`;
  script.async = true;
  script.dataset.motionLevelsGamesRevision = revision;
  let rejectStylesheet: (reason: Error) => void = () => undefined;
  const stylesheetReady = new Promise<void>((resolve, reject) => {
    rejectStylesheet = reject;
    stylesheet.onload = () => {
      if (!isCurrentRuntimeLoad(generation)) {
        stylesheet.remove();
        discardStaleRuntimeRevision(revision);
        reject(new Error("La carga de estilos fue reemplazada"));
        return;
      }
      resolve();
    };
    stylesheet.onerror = () => {
      if (!isCurrentRuntimeLoad(generation)) {
        stylesheet.remove();
        discardStaleRuntimeRevision(revision);
        reject(new Error("La carga de estilos fue reemplazada"));
        return;
      }
      reject(new Error("No se pudieron cargar los estilos de la pantalla del juego"));
    };
  });
  let rejectRuntime: (reason: Error) => void = () => undefined;
  const runtimeReady = new Promise<GamesDisplayRuntime>((resolve, reject) => {
    rejectRuntime = reject;
    script.onload = () => {
      if (!isCurrentRuntimeLoad(generation)) {
        script.remove();
        discardStaleRuntimeRevision(revision);
        reject(new Error("La carga de la pantalla fue reemplazada"));
        return;
      }
      const runtime = runtimeForRevision(revision);
      if (!runtime) {
        reject(new Error("La revisión de la pantalla no coincide con el juego"));
        return;
      }
      resolve(runtime);
    };
    script.onerror = () => {
      if (!isCurrentRuntimeLoad(generation)) {
        script.remove();
        discardStaleRuntimeRevision(revision);
        reject(new Error("La carga de la pantalla fue reemplazada"));
        return;
      }
      reject(new Error("No se pudo cargar la pantalla del juego"));
    };
  });
  let rejectCancellation: (reason: Error) => void = () => undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const transaction = Promise.allSettled([stylesheetReady, runtimeReady]).then(([stylesheetResult, runtimeResult]) => {
    if (!isCurrentRuntimeLoad(generation)) throw new Error("La carga de la pantalla fue reemplazada");
    if (runtimeResult.status === "rejected") throw runtimeResult.reason;

    if (stylesheetResult.status === "fulfilled") {
      stylesheet.media = "all";
      legacyStyle.remove();
      if (previousStylesheet !== stylesheet) previousStylesheet?.remove();
      stylesheet.id = gamesDisplayExternalStylesID;
      rememberAcceptedStylesheet(stylesheet);
    } else if (legacyStyle.dataset.revision === revision && legacyStyle.textContent?.trim()) {
      stylesheet.remove();
      legacyStyle.media = "all";
      if (previousStylesheet !== legacyStyle) previousStylesheet?.remove();
      rememberAcceptedStylesheet(legacyStyle);
    } else {
      throw stylesheetResult.reason;
    }

    acceptedRuntime = runtimeResult.value;
    window.MotionLevelsGamesDisplay = runtimeResult.value;
    script.remove();
    return runtimeResult.value;
  });
  const promise = Promise.race([transaction, cancellation]);
  let cleanedUp = false;
  const cleanupFailedLoad = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    script.remove();
    stylesheet.remove();
    legacyStyle.remove();
    if (isLegacyStyle(previousStylesheet) && previousStylesheet.isConnected) {
      previousStylesheet.id = gamesDisplayLegacyStylesID;
    }
    restoreAcceptedRuntime(revision);
  };
  const cancel = (reason: Error) => {
    rejectStylesheet(reason);
    rejectRuntime(reason);
    rejectCancellation(reason);
    cleanupFailedLoad();
  };
  pendingRuntime = { generation, revision, promise, script, stylesheet, cancel };
  document.head.append(legacyStyle, stylesheet, script);
  void promise.then(() => {
    if (pendingRuntime?.generation === generation) pendingRuntime = null;
  }, () => {
    cleanupFailedLoad();
    if (pendingRuntime?.generation === generation) pendingRuntime = null;
  });
  return promise;
}

function runtimeForRevision(revision: string): GamesDisplayRuntime | null {
  return window.MotionLevelsGamesDisplays?.[revision]
    ?? (window.MotionLevelsGamesDisplay?.revision === revision ? window.MotionLevelsGamesDisplay : null);
}

function activeStylesheetForRevision(revision: string): HTMLStyleElement | HTMLLinkElement | null {
  const external = document.getElementById(gamesDisplayExternalStylesID);
  if (external instanceof HTMLLinkElement && external.dataset.motionLevelsGamesRevision === revision) return external;
  const legacy = document.getElementById(gamesDisplayLegacyStylesID);
  if (legacy instanceof HTMLStyleElement && legacy.dataset.revision === revision && legacy.media !== "not all") return legacy;
  return null;
}

function currentAcceptedStylesheet(): HTMLStyleElement | HTMLLinkElement | null {
  if (acceptedStylesheet?.isConnected) return acceptedStylesheet;
  const external = document.getElementById(gamesDisplayExternalStylesID);
  if (external instanceof HTMLLinkElement) return external;
  const legacy = document.getElementById(gamesDisplayLegacyStylesID);
  return legacy instanceof HTMLStyleElement && legacy.media !== "not all" ? legacy : null;
}

function isLegacyStyle(element: Element | null): element is HTMLStyleElement {
  return element instanceof HTMLStyleElement;
}

function rememberAcceptedStylesheet(stylesheet: HTMLStyleElement | HTMLLinkElement): void {
  acceptedStylesheet = stylesheet;
  acceptedLegacyStyleText = stylesheet instanceof HTMLStyleElement ? stylesheet.textContent ?? "" : null;
}

function isCurrentRuntimeLoad(generation: number): boolean {
  return pendingRuntime?.generation === generation;
}

function restoreAcceptedRuntime(rejectedRevision: string): void {
  if (window.MotionLevelsGamesDisplay?.revision !== rejectedRevision) return;
  if (acceptedRuntime) {
    window.MotionLevelsGamesDisplay = acceptedRuntime;
  } else {
    delete window.MotionLevelsGamesDisplay;
  }
}

function discardStaleRuntimeRevision(revision: string): void {
  if (pendingRuntime?.revision === revision) return;
  restoreAcceptedRuntime(revision);
  if (acceptedRuntime?.revision === revision) return;
  const legacyStyle = document.getElementById(gamesDisplayLegacyStylesID);
  if (
    acceptedStylesheet instanceof HTMLStyleElement
    && acceptedRuntime
    && acceptedLegacyStyleText !== null
  ) {
    if (legacyStyle && legacyStyle !== acceptedStylesheet) legacyStyle.remove();
    if (!acceptedStylesheet.isConnected) document.head.append(acceptedStylesheet);
    acceptedStylesheet.id = gamesDisplayLegacyStylesID;
    acceptedStylesheet.media = "all";
    acceptedStylesheet.textContent = acceptedLegacyStyleText;
    acceptedStylesheet.dataset.revision = acceptedRuntime.revision;
  } else if (legacyStyle instanceof HTMLStyleElement && legacyStyle.dataset.revision === revision) {
    legacyStyle.remove();
  }
}

function gamesAssetBaseURL() {
  const override = import.meta.env.VITE_MOTION_LEVELS_GAMES_ASSET_URL?.trim();
  if (override) return override.replace(/\/$/u, "");
  const gateway = window.location.pathname.match(/^(\/gateways\/[^/]+)\/display(?:\/|$)/u);
  if (gateway) return `${window.location.origin}${gateway[1]}/games`;
  return `${window.location.origin}/games`;
}
