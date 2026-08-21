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
- `GET`/`PUT /api/menu-state` and `GET /api/menu-state/events` for the
  runtime-authoritative menu state and live menu-client presence;
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

Every player-menu renderer follows the runtime-owned `/api/menu-state` stream.
Interactive renderers, including `?remoteControl=1`, publish navigation and
selection changes with the canonical version they observed; stale writes are
rejected instead of replacing a newer screen. The physical kiosk alone keeps a
local recovery copy, but that copy is only used to seed a fresh runtime with no
snapshot. `?readOnly=1` subscribes without publishing and remains inert;
explicit read-only mode still wins when both query parameters are present.
Interactive clients keep their controls behind the loading surface until that
first seed has been accepted and broadcast, so a user cannot act during the
bootstrap race between two freshly opened renderers.

Each open `/api/menu-state/events` subscription counts as one live menu client.
The `activeClients` field is included in both the JSON snapshot and every SSE
event, and changes immediately on connect or disconnect. This makes the engine
the only source for presence, current screen, selected game, category,
difficulty, level, roster, and the rest of the shared menu projection.
Monitoring surfaces may subscribe with `?observer=1` to receive those changes
without inflating the menu-client count themselves.

The runtime owns both the venue-session lifecycle and the current detailed menu
snapshot. Renderers propose revision-checked patches for the `menu`, `screen`,
or `view` slices so a session update cannot accidentally roll back another
client's panel or selection. When a platform `end` clears the runtime session,
the shared snapshot clears session identity, team, and roster for every menu.
A normal game `exit` preserves the runtime venue session and therefore keeps
the visit open.

## Local full playthrough

`npm run dev:venue:no-controller` starts the complete local venue at
`http://127.0.0.1:4104`, with the same `VenueRuntime` API used by production
and a mock controller. The Vite service serves the playground at `/` and the
embedded player menu at `/player-menu/`; its `/api` and `/engine` routes proxy
to that runtime.

The menu launches with the normal `POST /api/select` command. The playground
does not create a second live game engine in this mode: it renders
`GET /api/display` and `/api/display/events`, sends controls through
`POST /api/control`, and sends floor interaction through
`POST /api/floor-input`. Switching to Menu acquires the same canonical pause
state as the venue, and remounting the menu derives its active-game screen from
the runtime snapshot.

Plain `npm run dev` remains the standalone deterministic authoring/media path
when no venue runtime is available. That fallback is intentionally separate
from the integrated venue smoke path and must not be used to validate
production lifecycle behavior.
