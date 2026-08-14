/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEVICE_ID?: string;
  readonly VITE_KIOSK_ID?: string;
  readonly VITE_POSTHOG_ENABLED?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_UI_HOST?: string;
  readonly VITE_LOCAL_PLAYGROUND_PORT?: string;
  readonly VITE_VENUE_ID?: string;
  readonly VITE_UNLOCK_LEVELS?: string;
  readonly VITE_DEV_SETTINGS_PIN?: string;
  readonly VITE_HOSTED_PLAYER_EXPERIENCE?: string;
  readonly VITE_MENU_UPDATE_POLL_MILLIS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __MENU_BUILD_REVISION__: string;
declare const __MENU_BUILD_DATE__: string;

declare module "@fontsource-variable/inter";
