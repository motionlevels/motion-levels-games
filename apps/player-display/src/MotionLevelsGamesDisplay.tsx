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
  const connectionEpochRef = useRef(0);
  const renderEpochRef = useRef(0);
  const readyIdentityRef = useRef("");
  const [renderState, setRenderState] = useState<GamesDisplayRenderState>(() => renderLoadingState(status.sourceRevision || ""));
  const revision = status.sourceRevision || "";
  const gameId = gameID(status);
  const hasSnapshot = status.gameSnapshot !== undefined;
  const connectionIdentity = displayConnectionIdentity(revision, gameId, hasSnapshot);
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
    const connectionEpoch = ++connectionEpochRef.current;
    let cancelled = false;
    let retryHandle: number | null = null;
    let mountedRuntime: GamesDisplayRuntime | null = null;

    const isCurrentConnection = () => (
      !cancelled && connectionEpochRef.current === connectionEpoch
    );
    const publish = (next: GamesDisplayRenderState) => {
      if (!isCurrentConnection()) return;
      readyIdentityRef.current = next.status === "ready" ? connectionIdentity : "";
      setRenderState(next);
      onStateChange(next);
    };
    const failRuntime = (
      runtime: GamesDisplayRuntime,
      renderEpoch: number,
      attempt: number,
      reason: unknown,
    ) => {
      if (
        !isCurrentConnection()
        || renderEpochRef.current !== renderEpoch
        || runtimeRef.current !== runtime
      ) return;
      renderEpochRef.current += 1;
      safelyUnmount(runtime, host);
      runtimeRef.current = null;
      if (mountedRuntime === runtime) mountedRuntime = null;
      publish({
        status: "error",
        expectedRevision: revision,
        loadedRevision: revision,
        attempt,
        error: displayErrorMessage(reason),
      });
    };
    const runtimeInput = (
      runtime: GamesDisplayRuntime,
      renderEpoch: number,
      attempt: number,
    ): GamesDisplayInput => ({
      ...latestInput.current,
      onError: (reason) => failRuntime(runtime, renderEpoch, attempt, reason),
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
            if (!isCurrentConnection()) return;
            mountedRuntime = runtime;
            runtimeRef.current = runtime;
            const renderEpoch = ++renderEpochRef.current;
            runtime.mount(host, runtimeInput(runtime, renderEpoch, attempt));
            if (
              !isCurrentConnection()
              || mountedRuntime !== runtime
              || renderEpochRef.current !== renderEpoch
            ) return;
            publish({ status: "ready", expectedRevision: revision, loadedRevision: runtime.revision, attempt, error: "" });
          })
          .catch((reason) => {
            if (!isCurrentConnection()) return;
            renderEpochRef.current += 1;
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
      if (connectionEpochRef.current === connectionEpoch) {
        connectionEpochRef.current += 1;
        renderEpochRef.current += 1;
        readyIdentityRef.current = "";
        safelyUnmount(mountedRuntime, host);
        if (runtimeRef.current === mountedRuntime) runtimeRef.current = null;
      }
    };
  }, [connectionIdentity, gameId, hasSnapshot, revision, onStateChange]);

  useEffect(() => {
    const host = hostRef.current;
    const runtime = runtimeRef.current;
    if (
      !host
      || renderState.status !== "ready"
      || readyIdentityRef.current !== connectionIdentity
      || runtime?.revision !== revision
      || !status.gameSnapshot
    ) return;
    const renderEpoch = ++renderEpochRef.current;
    const failRuntime = (reason: unknown) => {
      if (
        renderEpochRef.current !== renderEpoch
        || runtimeRef.current !== runtime
        || readyIdentityRef.current !== connectionIdentity
      ) return;
      renderEpochRef.current += 1;
      readyIdentityRef.current = "";
      safelyUnmount(runtime, host);
      runtimeRef.current = null;
      const next = {
        status: "error",
        expectedRevision: revision,
        loadedRevision: revision,
        attempt: renderState.attempt,
        error: displayErrorMessage(reason),
      } satisfies GamesDisplayRenderState;
      setRenderState(next);
      onStateChange(next);
    };
    try {
      runtime.update(host, {
        gameId,
        snapshot: status.gameSnapshot,
        frame: status.frame,
        paused: status.phase === "paused",
        floorRotationDegrees,
        onError: failRuntime,
      });
    } catch (reason) {
      failRuntime(reason);
    }
  }, [connectionIdentity, floorRotationDegrees, gameId, onStateChange, renderState.attempt, renderState.status, revision, status.frame, status.gameSnapshot, status.phase]);

  const isReady = renderState.status === "ready" && readyIdentityRef.current === connectionIdentity;

  return (
    <main className="motion-levels-games-display-host">
      <div ref={hostRef} className={`motion-levels-games-display-root ${isReady ? "is-ready" : "is-hidden"}`} />
      {isReady ? null : <div className="motion-levels-games-display-fallback">{fallback}</div>}
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

function displayConnectionIdentity(revision: string, gameId: string, hasSnapshot: boolean): string {
  return JSON.stringify([revision, gameId, hasSnapshot]);
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
  legacyStyle: HTMLStyleElement;
  legacyStyleText: string;
  legacyStyleRevision: string | null;
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
        discardStaleRuntimeRevision(revision, generation);
        reject(new Error("La carga de estilos fue reemplazada"));
        return;
      }
      resolve();
    };
    stylesheet.onerror = () => {
      if (!isCurrentRuntimeLoad(generation)) {
        stylesheet.remove();
        discardStaleRuntimeRevision(revision, generation);
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
        discardStaleRuntimeRevision(revision, generation);
        reject(new Error("La carga de la pantalla fue reemplazada"));
        return;
      }
      rememberPendingLegacyStyle(generation, revision);
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
        discardStaleRuntimeRevision(revision, generation);
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
      delete legacyStyle.dataset.motionLevelsGamesPendingRevision;
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
  pendingRuntime = {
    generation,
    revision,
    promise,
    script,
    stylesheet,
    legacyStyle,
    legacyStyleText: "",
    legacyStyleRevision: null,
    cancel,
  };
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

function rememberPendingLegacyStyle(generation: number, revision: string): void {
  const pending = pendingRuntime;
  if (
    pending?.generation !== generation
    || pending.legacyStyle.dataset.revision !== revision
    || !pending.legacyStyle.textContent?.trim()
  ) return;
  pending.legacyStyleText = pending.legacyStyle.textContent;
  pending.legacyStyleRevision = revision;
}

function restoreAcceptedRuntime(rejectedRevision: string): void {
  if (window.MotionLevelsGamesDisplay?.revision !== rejectedRevision) return;
  if (acceptedRuntime) {
    window.MotionLevelsGamesDisplays ??= {};
    window.MotionLevelsGamesDisplays[acceptedRuntime.revision] = acceptedRuntime;
    window.MotionLevelsGamesDisplay = acceptedRuntime;
  } else {
    delete window.MotionLevelsGamesDisplay;
  }
}

function restorePendingLegacyStyle(): boolean {
  const pending = pendingRuntime;
  if (!pending) return false;
  const occupyingStyle = document.getElementById(gamesDisplayLegacyStylesID);
  if (occupyingStyle && occupyingStyle !== pending.legacyStyle) occupyingStyle.remove();
  if (!pending.legacyStyle.isConnected) {
    const anchor = pending.stylesheet.isConnected
      ? pending.stylesheet
      : pending.script.isConnected ? pending.script : null;
    if (anchor) {
      document.head.insertBefore(pending.legacyStyle, anchor);
    } else {
      document.head.append(pending.legacyStyle);
    }
  }
  pending.legacyStyle.id = gamesDisplayLegacyStylesID;
  pending.legacyStyle.media = "not all";
  pending.legacyStyle.dataset.motionLevelsGamesPendingRevision = pending.revision;
  pending.legacyStyle.textContent = pending.legacyStyleText;
  if (pending.legacyStyleRevision) {
    pending.legacyStyle.dataset.revision = pending.legacyStyleRevision;
  } else {
    delete pending.legacyStyle.dataset.revision;
  }
  return true;
}

function discardStaleRuntimeRevision(revision: string, generation: number): void {
  if (pendingRuntime?.generation === generation) return;
  restoreAcceptedRuntime(revision);
  if (restorePendingLegacyStyle()) return;
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
