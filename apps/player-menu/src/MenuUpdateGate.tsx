import { PlayerExperienceStateGate, type PlayerExperienceState } from "@motion-levels-games/player-experience";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchEngineStatus } from "./api";
import { bundledGamesSourceRevision } from "./bundleMedia";
import {
  cleanGamesSourceRevision,
  createMenuUpdateMarker,
  decideMenuUpdate,
  emptyMenuManifestObservation,
  loadedMenuIsSafe,
  manifestBuildIdentity,
  maxAutomaticMenuReloads,
  menuBuildManifestURL,
  menuUpdateMarkerFromURL,
  menuUpdateNavigationURL,
  menuUpdateStorageKey,
  menuUpdateTransitionMillis,
  menuUpdateVerificationTimeoutMillis,
  observeMenuManifest,
  parseMenuUpdateMarker,
  parsePlayerMenuBuildManifest,
  sameMenuBuildIdentity,
  serializeMenuUpdateMarker,
  stripMenuUpdateURLParams,
  type MenuBuildIdentity,
  type MenuUpdateMarker,
  type MenuUpdatePhase,
  type RuntimeRevisionObservation,
} from "./menuUpdate";
import { publicAssetURL } from "./utils";

const defaultManifestPollMillis = 15_000;
const defaultRuntimePollMillis = 2_500;
const fastPollMillis = 1_000;
const runtimeFailuresBeforeUnavailable = 3;

type RuntimePollState = {
  observation: RuntimeRevisionObservation;
  consecutiveFailures: number;
};

const initialRuntimePollState: RuntimePollState = {
  observation: { kind: "pending" },
  consecutiveFailures: 0,
};

export default function MenuUpdateGate({ children }: { children: ReactNode }) {
  const currentBuild = useMemo<MenuBuildIdentity>(() => ({
    menuBuildRevision: __MENU_BUILD_REVISION__,
    gamesSourceRevision: bundledGamesSourceRevision(),
  }), []);
  const enabled = useMemo(
    () => import.meta.env.DEV !== true
      && currentBuild.menuBuildRevision !== "dev"
      && currentBuild.gamesSourceRevision !== "dev",
    [currentBuild],
  );
  const [marker, setMarker] = useState<MenuUpdateMarker | null>(() => loadInitialMarker());
  const [manifestObservation, setManifestObservation] = useState(emptyMenuManifestObservation);
  const [runtimePoll, setRuntimePoll] = useState(initialRuntimePollState);
  const [navigationTarget, setNavigationTarget] = useState<MenuBuildIdentity | null>(null);
  const [failed, setFailed] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const navigationStartedRef = useRef(false);
  const runtimeGateRef = useRef(new PlayerExperienceStateGate());
  const acceptedRuntimeRef = useRef<PlayerExperienceState | null>(null);

  const decision = useMemo(() => decideMenuUpdate({
    current: currentBuild,
    manifestObservation,
    runtime: runtimePoll.observation,
  }), [currentBuild, manifestObservation, runtimePoll.observation]);
  const manifestCandidate = manifestObservation.manifest
    ? manifestBuildIdentity(manifestObservation.manifest)
    : null;
  const fastPolling = marker !== null
    || updated
    || decision.phase !== "idle"
    || Boolean(
      manifestCandidate
      && !sameMenuBuildIdentity(currentBuild, manifestCandidate)
      && manifestObservation.stablePolls < 2,
    );
  const configuredPollMillis = configuredMenuUpdatePollMillis();
  const manifestPollMillis = configuredPollMillis
    ?? (fastPolling ? fastPollMillis : defaultManifestPollMillis);
  const runtimePollMillis = configuredPollMillis
    ?? (fastPolling ? fastPollMillis : defaultRuntimePollMillis);

  const pollManifest = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch(
        menuBuildManifestURL(window.location.href, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`),
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal,
        },
      );
      if (!response.ok) throw new Error(`player menu manifest returned ${response.status}`);
      const manifest = parsePlayerMenuBuildManifest(await response.json());
      if (!manifest) throw new Error("player menu manifest is invalid");
      if (!signal.aborted) setManifestObservation((current) => observeMenuManifest(current, manifest));
    } catch (error) {
      if (signal.aborted) return;
      console.warn("Player menu update manifest could not be checked", error);
      setManifestObservation((current) => observeMenuManifest(current, null));
    }
  }, []);

  const registerRuntimeFailure = useCallback(() => {
    setRuntimePoll((current) => {
      const consecutiveFailures = current.consecutiveFailures + 1;
      if (consecutiveFailures < runtimeFailuresBeforeUnavailable) {
        return { ...current, consecutiveFailures };
      }
      return { observation: { kind: "unavailable" }, consecutiveFailures };
    });
  }, []);

  const pollRuntime = useCallback(async (signal: AbortSignal) => {
    try {
      const next = await fetchEngineStatus();
      if (signal.aborted) return;
      const current = acceptedRuntimeRef.current;
      const accepted = runtimeGateRef.current.accepts(current, next);
      const repeatsCurrent = Boolean(
        current
        && current.runId === next.runId
        && current.revision === next.revision,
      );
      if (!accepted && !repeatsCurrent) return;
      if (accepted) acceptedRuntimeRef.current = next;
      const revision = cleanGamesSourceRevision(next.sourceRevision);
      if (!revision) {
        registerRuntimeFailure();
        return;
      }
      setRuntimePoll({ observation: { kind: "available", revision }, consecutiveFailures: 0 });
    } catch {
      if (!signal.aborted) registerRuntimeFailure();
    }
  }, [registerRuntimeFailure]);

  useSerialPoll(enabled, manifestPollMillis, retryGeneration, pollManifest);
  useSerialPoll(enabled, runtimePollMillis, retryGeneration, pollRuntime);

  const resetUpdateCycle = useCallback(() => {
    navigationStartedRef.current = false;
    setNavigationTarget(null);
    setMarker(null);
    setFailed(false);
    setUpdated(false);
    removeStoredMarker();
    replaceCurrentURL(stripMenuUpdateURLParams(window.location.href));
  }, []);

  const confirmUpdate = useCallback(() => {
    navigationStartedRef.current = false;
    setNavigationTarget(null);
    setMarker(null);
    setFailed(false);
    setUpdated(true);
    removeStoredMarker();
    replaceCurrentURL(stripMenuUpdateURLParams(window.location.href));
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (marker || failed || updated || navigationTarget) resetUpdateCycle();
      else replaceCurrentURL(stripMenuUpdateURLParams(window.location.href));
      return;
    }
    if (failed || updated || navigationStartedRef.current) return;

    if (marker && loadedMenuIsSafe({
      current: currentBuild,
      manifestObservation,
      runtime: runtimePoll.observation,
    })) {
      confirmUpdate();
      return;
    }

    if (marker && Date.now() - marker.startedAt >= menuUpdateVerificationTimeoutMillis) {
      setNavigationTarget(null);
      setFailed(true);
      return;
    }

    if (decision.phase === "idle") {
      setNavigationTarget(null);
      return;
    }

    if (!marker) {
      const target = markerTarget(currentBuild, manifestCandidate, runtimePoll.observation, decision.target);
      const nextMarker = createMenuUpdateMarker(target, 0, Date.now());
      setMarker(nextMarker);
      storeMarker(nextMarker);
      replaceCurrentURL(menuUpdateNavigationURL(window.location.href, target, 0));
      return;
    }

    if (decision.phase !== "reloading" || !decision.target) {
      setNavigationTarget(null);
      return;
    }

    if (marker.attempts >= maxAutomaticMenuReloads) {
      setNavigationTarget(null);
      setFailed(true);
      return;
    }

    setNavigationTarget((current) => current && sameMenuBuildIdentity(current, decision.target!)
      ? current
      : decision.target);
  }, [
    confirmUpdate,
    currentBuild,
    decision,
    enabled,
    failed,
    manifestCandidate,
    manifestObservation,
    marker,
    navigationTarget,
    resetUpdateCycle,
    runtimePoll.observation,
    updated,
  ]);

  useEffect(() => {
    if (!navigationTarget || !marker || failed || navigationStartedRef.current) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const delay = menuUpdateTransitionMillis("reload", reducedMotion, configuredPollMillis);
    const timer = window.setTimeout(() => {
      const attempts = marker.attempts + 1;
      if (attempts > maxAutomaticMenuReloads) {
        setNavigationTarget(null);
        setFailed(true);
        return;
      }
      navigationStartedRef.current = true;
      const nextMarker = createMenuUpdateMarker(navigationTarget, attempts, marker.startedAt);
      storeMarker(nextMarker);
      setMarker(nextMarker);
      window.location.replace(menuUpdateNavigationURL(window.location.href, navigationTarget, attempts));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [configuredPollMillis, failed, marker, navigationTarget]);

  useEffect(() => {
    if (!updated) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const delay = menuUpdateTransitionMillis("success", reducedMotion, configuredPollMillis);
    const timer = window.setTimeout(() => setUpdated(false), delay);
    return () => window.clearTimeout(timer);
  }, [configuredPollMillis, updated]);

  const retry = useCallback(() => {
    const target = markerTarget(currentBuild, manifestCandidate, runtimePoll.observation, decision.target);
    const nextMarker = createMenuUpdateMarker(target, 0, Date.now());
    navigationStartedRef.current = false;
    setFailed(false);
    setUpdated(false);
    setNavigationTarget(null);
    setMarker(nextMarker);
    storeMarker(nextMarker);
    replaceCurrentURL(menuUpdateNavigationURL(window.location.href, target, 0));
    setRetryGeneration((generation) => generation + 1);
  }, [currentBuild, decision.target, manifestCandidate, runtimePoll.observation]);

  const phase = visibleUpdatePhase(enabled, updated, failed, marker, navigationTarget, decision.phase);
  const blocking = phase !== "idle";

  return (
    <div className="menu-update-gate" data-menu-update-gate data-update-phase={phase}>
      <div className="menu-update-content" data-menu-update-content inert={blocking ? true : undefined}>
        {children}
      </div>
      {blocking ? <MenuUpdateOverlay phase={phase} onRetry={retry} /> : null}
    </div>
  );
}

function MenuUpdateOverlay({ phase, onRetry }: { phase: Exclude<MenuUpdatePhase, "idle">; onRetry: () => void }) {
  const overlayRef = useRef<HTMLElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const copy = updateCopy(phase);

  useLayoutEffect(() => {
    if (!previousFocusRef.current && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    return () => {
      const previous = previousFocusRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useLayoutEffect(() => {
    if (phase === "failed") retryRef.current?.focus();
    else overlayRef.current?.focus();
  }, [phase]);

  return (
    <section
      ref={overlayRef}
      className={`menu-update-overlay phase-${phase}`}
      data-menu-update-overlay
      data-update-phase={phase}
      role="alertdialog"
      aria-modal="true"
      aria-busy={phase !== "failed" && phase !== "updated"}
      aria-labelledby="menu-update-title"
      aria-describedby="menu-update-description"
      tabIndex={-1}
    >
      <div className="menu-update-card">
        <div className="menu-update-orbit" aria-hidden="true">
          <span />
          {phase === "updated"
            ? <b className="menu-update-success-mark">✓</b>
            : <img src={publicAssetURL("motion-levels-icon.webp")} alt="" />}
        </div>
        <span className="micro">Actualización del sistema</span>
        <h1 id="menu-update-title">{copy.title}</h1>
        <p id="menu-update-description">{copy.description}</p>
        <div className="menu-update-steps" aria-hidden="true">
          {(["Preparando", "Recargando", "Comprobando"] as const).map((label, index) => (
            <span key={label} className={updateStepClass(phase, index)}>
              <i />
              {label}
            </span>
          ))}
        </div>
        {phase === "failed" ? (
          <button ref={retryRef} className="btn primary menu-update-retry" data-menu-update-retry type="button" onClick={onRetry}>
            Reintentar
          </button>
        ) : null}
      </div>
    </section>
  );
}

function useSerialPoll(
  enabled: boolean,
  delayMillis: number,
  refreshGeneration: number,
  poll: (signal: AbortSignal) => Promise<void>,
) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let inFlight = false;
    let queued = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const schedule = () => {
      if (!stopped) timer = window.setTimeout(requestPoll, delayMillis);
    };
    const run = async () => {
      inFlight = true;
      controller = new AbortController();
      try {
        await poll(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) console.warn("Player menu update poll failed", error);
      }
      inFlight = false;
      controller = null;
      if (!stopped) {
        if (queued) {
          queued = false;
          void run();
        } else {
          schedule();
        }
      }
    };
    function requestPoll() {
      if (stopped) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (inFlight) {
        queued = true;
        return;
      }
      void run();
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") requestPoll();
    };

    requestPoll();
    window.addEventListener("focus", requestPoll);
    window.addEventListener("online", requestPoll);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      stopped = true;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", requestPoll);
      window.removeEventListener("online", requestPoll);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [delayMillis, enabled, poll, refreshGeneration]);
}

function loadInitialMarker(): MenuUpdateMarker | null {
  const now = Date.now();
  const fromURL = menuUpdateMarkerFromURL(window.location.href, now);
  let stored: MenuUpdateMarker | null = null;
  try {
    stored = parseMenuUpdateMarker(window.sessionStorage.getItem(menuUpdateStorageKey), now);
  } catch {
    // URL parameters retain the bounded attempt count when storage is denied.
  }
  if (
    fromURL
    && stored
    && fromURL.expectedMenuRevision === stored.expectedMenuRevision
    && fromURL.expectedGamesRevision === stored.expectedGamesRevision
    && fromURL.attempts >= stored.attempts
  ) {
    return { ...fromURL, startedAt: stored.startedAt };
  }
  return fromURL ?? stored;
}

function storeMarker(marker: MenuUpdateMarker) {
  try {
    window.sessionStorage.setItem(menuUpdateStorageKey, serializeMenuUpdateMarker(marker));
  } catch {
    // The URL carries the same target and attempt count as a storage fallback.
  }
}

function removeStoredMarker() {
  try {
    window.sessionStorage.removeItem(menuUpdateStorageKey);
  } catch {
    // A denied storage area has nothing useful to clear.
  }
}

function replaceCurrentURL(href: string) {
  if (href === window.location.href) return;
  try {
    window.history.replaceState(window.history.state, "", href);
  } catch {
    // Updating internal recovery parameters must never break the kiosk.
  }
}

function markerTarget(
  current: MenuBuildIdentity,
  manifest: MenuBuildIdentity | null,
  runtime: RuntimeRevisionObservation,
  decisionTarget: MenuBuildIdentity | null,
): MenuBuildIdentity {
  if (decisionTarget) return decisionTarget;
  if (manifest) return manifest;
  if (runtime.kind === "available") return { ...current, gamesSourceRevision: runtime.revision };
  return current;
}

function visibleUpdatePhase(
  enabled: boolean,
  updated: boolean,
  failed: boolean,
  marker: MenuUpdateMarker | null,
  navigationTarget: MenuBuildIdentity | null,
  decisionPhase: "idle" | "waiting-for-files" | "reloading",
): MenuUpdatePhase {
  if (!enabled) return "idle";
  if (failed) return "failed";
  if (updated) return "updated";
  if (navigationTarget) return "reloading";
  if (decisionPhase !== "idle") return decisionPhase;
  if (marker) return "verifying";
  return "idle";
}

function updateCopy(phase: Exclude<MenuUpdatePhase, "idle">) {
  if (phase === "waiting-for-files") {
    return {
      title: "Hay una nueva versión",
      description: "Estamos preparando el menú actualizado. No apagues la sala.",
    };
  }
  if (phase === "reloading") {
    return { title: "Actualizando el menú", description: "Volveremos en unos segundos." };
  }
  if (phase === "failed") {
    return {
      title: "No se pudo completar la actualización",
      description: "El menú sigue bloqueado para evitar acciones incompatibles.",
    };
  }
  if (phase === "updated") {
    return {
      title: "Menú actualizado",
      description: "Ya estás usando la última versión.",
    };
  }
  return {
    title: "Comprobando la actualización",
    description: "Estamos verificando que todo esté listo.",
  };
}

function updateStepClass(phase: Exclude<MenuUpdatePhase, "idle">, index: number): string {
  if (phase === "updated") return "done";
  const activeIndex = phase === "waiting-for-files" ? 0 : phase === "reloading" ? 1 : 2;
  if (phase === "failed" && index === activeIndex) return "error";
  if (index < activeIndex) return "done";
  return index === activeIndex ? "active" : "";
}

function configuredMenuUpdatePollMillis(): number | null {
  const value = Number(import.meta.env.VITE_MENU_UPDATE_POLL_MILLIS);
  return Number.isFinite(value) && value >= 50 ? Math.round(value) : null;
}
