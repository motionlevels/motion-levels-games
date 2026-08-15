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
- `POST /api/output-test` for an idempotent, operator-triggered `floor` or
  `audio` diagnostic. The canonical player state exposes the correlated
  `outputTest` UUID and its `pending`, `playing`, `passed`, or `failed`
  lifecycle;
- `GET /api/health`, `/api/display`, and `/api/display/events` for venue and
  player-display health/state;
- `GET /api/live-floor/events` for the runtime-owned SSE stream of the latest
  authoritative `MLF1` frame observed from the Go controller;
- `POST /api/floor-input` for authenticated operator clients with independent
  leased latches (the player menu does not call it);
- `GET`/`PUT /api/menu-state` and `GET /api/menu-state/events` for mirrored
  kiosk recovery state;
- `POST /api/venue-session` for authoritative visit start/end state and
  `POST /api/menu-event` for best-effort operational events;
- `GET`/`POST /api/display-client` for player-display health reports. Audio
  diagnostics acknowledge the same output-test UUID and sequence only after
  the recorded phrase is scheduled, completed, or fails.

The platform catalog remains a read-only input at `GET /api/game-catalog`.
The menu resolves it from `VITE_PLATFORM_URL`, the active platform/gateway
origin, or the public platform URL.

## Observed floor stream

The live floor view connects to `GET /api/live-floor/events` on the same venue
runtime used by the rest of the menu. Each `live-floor` SSE event contains a
base64 `MLF1` envelope with the physical 16x32 RGB floor and pressure bitset
reported by the Go controller after its watchdog. This surface is read-only:
the menu does not simulate or write floor pressure. The runtime sends the
current authoritative snapshot immediately when a client connects, then a
latest-value stream at 20 fps by default (capped at 25 fps) so a slow browser
cannot queue the controller's 50 fps presentation feed.

## Ownership and compatibility

The games release owns the complete browse-to-results UI, catalog projection,
roster/configuration flow, analytics policy, menu tests, and the TypeScript
implementation behind these endpoints. The venue owns the supervisor,
gateway, controller process, and physical kiosk shell.

Protocol v2 commands include an idempotent `commandId`, and every command
response is the resulting canonical player state. Consumers must reject equal
or older `revision` values within one `runId`; a new runtime `runId` starts a
fresh revision sequence, and retired run IDs remain rejected so a late poll or
SSE response cannot roll the UI backward.

Additive response fields do not require a protocol bump. Removing or changing
a field, endpoint, action, URL-resolution rule, or binary-frame meaning does.
Venue bundle import must validate the declared version before deployment.

## Embedded menu modes

`?readOnly=1` follows the kiosk-owned `/api/menu-state` mirror and makes the
embedded menu inert. `?remoteControl=1` follows and hydrates from that same
canonical mirror but keeps the normal menu handlers and engine commands
enabled. The remote controller never writes `/api/menu-state` or persists its
menu/Party state to local storage, so it cannot become a second kiosk that
overwrites recovery state. Explicit read-only mode still wins when both query
parameters are present. A successful first mirror read with no snapshot makes
remote control available with the default menu state instead of waiting
forever for a kiosk writer.

The runtime owns whether a venue session exists; the kiosk owns the detailed
menu recovery snapshot. When a platform `end` clears the runtime session, the
physical kiosk clears session identity, team, and roster and republishes that
clean snapshot for every embedded mirror. A normal game `exit` preserves the
runtime venue session and therefore keeps the visit open.

## Local full playthrough

`npm run dev` starts one Vite service at `http://127.0.0.1:4104`. It serves the
playground at `/` and the embedded player menu at `/player-menu/`. The menu
serves a catalog projection directly from the checked-out manifests. A launch
transfers only game id, player count, difficulty, and public game configuration
within that origin; names, team identity, session ids, and recording state
never leave the menu. The playground provides a return-to-menu action. This
path is development-only and cannot target a remote host.
