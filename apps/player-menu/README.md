# Player Menu

Production player-experience UI for choosing games, configuring a team, and
launching a venue runtime. This source now lives beside the game manifests,
media, player displays, and development playground so one revision can cover
the complete browse-to-results journey.

Venue-specific ownership remains outside this workspace: Electron/Caddy
packaging, the Go supervisor, controller connectivity, hardware output, and
deployment are supplied by `motion-levels-venue`. The static build talks only
through the versioned HTTP/WebSocket adapter documented in
`../../docs/player-menu-adapter.md`.

The first source migration intentionally preserves the proven kiosk DOM and
state machine. Its focused lint override records the existing monolithic
component and accessibility debt without weakening lint rules for new games or
shared packages. Decompose `App.tsx` and remove those exceptions incrementally;
behavioral parity with the deployed menu takes priority during the handover.

During development it talks to the game-engine API at `http://127.0.0.1:4102`.

```sh
npm install
npm run dev
```

Open:

```txt
http://127.0.0.1:4103
```

Other devices on the same network can use the Vite network URL printed by
`npm run dev`, for example `http://192.168.1.137:4103`.

For the complete local player journey—kiosk selection followed by the real
in-browser floor and player display—run this at the repository root:

```sh
npm run dev:experience
```

Open `http://127.0.0.1:4103`. Development mode serves the local manifest
catalog and hands a configured selection to the playground on port 4104. The
handoff is deliberately loopback-only and is absent from production builds.

Set `VITE_GAME_ENGINE_URL` if the menu is not running on the same machine as
the game-engine:

```sh
VITE_GAME_ENGINE_URL=http://192.168.1.137:4102 npm run dev
```

Analytics are sent to the dedicated PostHog menu project in production builds.
Development mode keeps analytics off unless explicitly enabled:

```sh
VITE_POSTHOG_ENABLED=true npm run dev
```

Optional kiosk identity values:

```sh
VITE_VENUE_ID=motion-levels-main
VITE_KIOSK_ID=kiosk-1
```

The player menu records game/category/level/difficulty actions, team size, and
kiosk controls. It intentionally does not send team or player names.

Electron packaging is intentionally not available here. Use the kiosk shell in
`motion-levels-venue/apps/player-menu/electron`; venue images install this
workspace's static release artifact automatically.
