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

The normal development entry point is the complete player experience. From the
repository root run:

```sh
npm install
npm run dev
```

Open:

```txt
http://127.0.0.1:4104
```

One Vite process serves both the playground and its embedded menu document on
the same origin. Use the **Display / Menu** toggle to change the 16:9 player
screen while keeping the floor visible. Starting a game switches back to the
real player display; its Menu action returns to the kiosk. The kiosk is the
only source for game, player-count, and difficulty selection.

Development mode serves the local manifest catalog and hands a configured
selection to the current playground origin. The handoff is deliberately
loopback-only and is absent from production builds. `npm run dev:experience`
remains as a compatibility alias for `npm run dev`; it does not start another
service.

The player-menu workspace can still be built independently for the venue
artifact. When run on its own, it talks to the game-engine API at
`http://127.0.0.1:4102`.

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
