import posthog from "posthog-js";
import type { Properties } from "posthog-js";
import { randomUUID } from "./utils.ts";

const defaultPostHogKey = "phc_pmpLzyqQbK6WU3fHtxMUuaSfWF3PA3aYREKpeCLE5Uow";
// Ingestion goes through the reverse proxy at p.obis.dev to dodge ad blockers.
const defaultPostHogHost = "https://p.obis.dev";
// ui_host keeps the toolbar and "view in PostHog" links pointing at the real app.
const defaultPostHogUiHost = "https://us.posthog.com";
const deviceStorageKey = "ml-player-menu-device-id";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateAnalyticsKeys = new Set(["player_name", "players", "team_name"]);
let volatileDeviceID = "";

function readEnv(name: string): string {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function analyticsEnabled(): boolean {
  const configured = readEnv("VITE_POSTHOG_ENABLED").toLowerCase();
  if (["1", "true", "yes", "on"].includes(configured)) return true;
  if (["0", "false", "no", "off"].includes(configured)) return false;
  return import.meta.env.PROD;
}

function getDeviceID(): string {
  const configured = readEnv("VITE_KIOSK_ID") || readEnv("VITE_DEVICE_ID");
  if (configured && uuidPattern.test(configured)) return configured.toLowerCase();
  if (configured) console.warn("Ignoring configured kiosk id because it is not a UUID.");

  try {
    const existing = localStorage.getItem(deviceStorageKey);
    if (existing && uuidPattern.test(existing)) return existing.toLowerCase();
  } catch {
    // Privacy/storage settings must not prevent the kiosk from starting.
  }

  if (volatileDeviceID) return volatileDeviceID;

  const generated = randomUUID();
  volatileDeviceID = generated;
  try {
    localStorage.setItem(deviceStorageKey, generated);
  } catch {
    // Use the in-memory ID for this renderer lifetime.
  }
  return generated;
}

export function analyticsSafeProperties(properties: Properties): Properties {
  return Object.fromEntries(Object.entries(properties).filter(([key]) => !privateAnalyticsKeys.has(key)));
}

function baseProperties(): Properties {
  return {
    app: "player-menu",
    venue_id: readEnv("VITE_VENUE_ID") || "motion-levels",
    kiosk_id: getDeviceID(),
    kiosk_mode: window.matchMedia("(display-mode: fullscreen)").matches ? "fullscreen" : "browser",
  };
}

export function initMenuAnalytics() {
  const key = readEnv("VITE_POSTHOG_KEY") || defaultPostHogKey;
  if (!analyticsEnabled() || !key) return;

  posthog.init(key, {
    api_host: readEnv("VITE_POSTHOG_HOST") || defaultPostHogHost,
    ui_host: readEnv("VITE_POSTHOG_UI_HOST") || defaultPostHogUiHost,
    defaults: "2026-05-30",
    // The kiosk already emits intentional operational events. Automatic DOM
    // capture can include player-derived text and accessible labels, so keep
    // it disabled to uphold the no-player-identity analytics contract.
    autocapture: false,
    capture_heatmaps: false,
    capture_pageview: false,
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: ".ph-mask",
      blockSelector: ".ph-no-capture",
    },
    loaded: (client) => {
      const props = baseProperties();
      client.identify(`kiosk:${props.kiosk_id}`, props);
      client.group("venue", String(props.venue_id), { app: "player-menu" });
      client.capture("player_menu_opened", props);
    },
  });
}

export function menuKioskID(): string {
  return getDeviceID();
}

type MenuEventForwarder = (event: string, properties: Properties) => void;

let menuEventForwarder: MenuEventForwarder | null = null;

// The forwarder mirrors every menu event to the game-engine for visit
// recording. It runs regardless of analyticsEnabled(): PostHog is prod-only,
// but session recording must also work in dev.
export function setMenuEventForwarder(forwarder: MenuEventForwarder | null) {
  menuEventForwarder = forwarder;
}

/** Records an operational event in the local engine session without exporting
 * it to the optional product-analytics destination. */
export function recordMenuEvent(event: string, properties: Properties = {}) {
  try {
    menuEventForwarder?.(event, properties);
  } catch {
    // visit recording must never break the kiosk
  }
}

export function captureMenuEvent(event: string, properties: Properties = {}) {
  recordMenuEvent(event, properties);
  if (!analyticsEnabled()) return;
  posthog.capture(`player_menu_${event}`, {
    ...baseProperties(),
    ...analyticsSafeProperties(properties),
  });
}
