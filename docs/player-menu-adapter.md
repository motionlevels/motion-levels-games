# Player menu adapter protocol

The player-menu source and static artifact are owned by this repository. A
venue host supplies the runtime behind a deliberately narrow browser adapter.
The current `playerMenu.adapterProtocolVersion` is **2**.

## HTTP surface

The menu resolves the engine from `VITE_GAME_ENGINE_URL`, a gateway `/engine`
route, or port `4102` on the current host. Protocol v2 uses:

- `GET /api/player-state` for the canonical game/session/display snapshot;
- `GET /api/player-state/events` for the revisioned live SSE feed;
- `POST /api/select` to launch a catalog selection;
- `POST /api/control` for pause, resume, restart, exit, narration, and mute;
- `GET /api/animation-preview` for native preview frames;
- `GET`/`PUT /api/menu-state` for mirrored kiosk recovery state;
- `POST /api/venue-session` and `POST /api/menu-event` as best-effort
  operational recording.

The platform catalog remains a read-only input at `GET /api/game-catalog`.
The menu resolves it from `VITE_PLATFORM_URL`, the active platform/gateway
origin, or the public platform URL.

## Floor WebSocket

The live floor view connects through `VITE_FLOOR_CONTROLLER_URL` or the
controller endpoint derived from the current host. Binary frames contain the
physical 16x32 RGB floor; status/configuration text messages are ignored by
the player menu.

## Ownership and compatibility

The games release owns the complete browse-to-results UI, catalog projection,
roster/configuration flow, analytics policy, and menu tests. The venue owns the
implementations behind these endpoints and the physical kiosk shell.

Protocol v2 commands include an idempotent `commandId`, and every command
response is the resulting canonical player state. Consumers must reject equal
or older `revision` values so polling and stream reconnects cannot roll the UI
backward.

Additive response fields do not require a protocol bump. Removing or changing
a field, endpoint, action, URL-resolution rule, or binary-frame meaning does.
Venue bundle import must validate the declared version before deployment.

## Local full playthrough

`npm run dev` starts one Vite service at `http://127.0.0.1:4104`. It serves the
playground at `/` and the embedded player menu at `/player-menu/`. The menu
serves a catalog projection directly from the checked-out manifests. A launch
transfers only game id, player count, difficulty, and public game configuration
within that origin; names, team identity, session ids, and recording state
never leave the menu. The playground provides a return-to-menu action. This
path is development-only and cannot target a remote host.
