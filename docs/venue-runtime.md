# TypeScript venue runtime

`apps/venue-runtime` is the production Node.js host for TypeScript games. It
constructs `GameSession` in-process: there is no child-process transport,
request envelope, legacy Go-game lookup, or fallback source.

## HTTP adapter v1

The API listens on `MOTION_LEVELS_ENGINE_HTTP` (`127.0.0.1:4102` by default).
The venue owns network isolation and may bind it to an internal container
interface for its gateway; the service itself is never published directly.
Non-loopback peers must send `X-Motion-Levels-Engine-Token`, matched in constant
time against `MOTION_LEVELS_ENGINE_TOKEN`; the venue gateway injects this
header. A non-loopback bind fails at startup when the token is missing.

- `GET /api/health`, `/api/status`, and `/api/display`;
- `GET /api/display/events` (SSE event `display`);
- `GET /api/live-floor/events` (SSE event `live-floor`, latest authoritative
  controller observation at 20 fps by default, capped at 25 fps);
- `POST /api/select` and `/api/control`;
- `POST /api/floor-input` for leased, authenticated operator input;
- `GET`/`PUT` `/api/menu-state` and `GET /api/menu-state/events`;
- `POST /api/venue-session` and `/api/menu-event`;
- `GET`/`POST /api/display-client`.

Selection accepts only production entries in the bundled gameplay registry.
`sourceRevision` must exactly match the compiled release revision. `sourceKind`
must be `motion_levels_games`, except `platform_levels` is accepted only when
`engineGame` resolves to a bundled TypeScript product tagged
`published-levels`. Those products fetch immutable
`motion-levels-published-level-content-v1` content from the platform and pass
that document directly to the tagged TypeScript product; there is no Go
fallback. Production content always uses `MOTION_LEVELS_PLATFORM_URL`; a
request-provided origin is accepted only when no origin is configured and the
request points to loopback development.

The engine and controller remain at 50 fps. Display SSE is capped at 4 fps and
the observed live-floor SSE is a latest-value feed at 20 fps by default, capped
at 25 fps. `MOTION_LEVELS_LOCAL_LIVE_FLOOR_FPS` can select a value in that
range. The cloud live-floor publisher remains independent and defaults to 5
fps. Both live-floor paths retain only the latest pending frame under
backpressure.
Idle output is an all-black 16x32 frame. Audio reports `audioEnabled: false`:
command-backed audio can be added as a narrow adapter later, without putting
audio state back into gameplay.

## Remote floor input

`POST /api/floor-input` uses the same engine-token boundary as the other
non-health endpoints and accepts one atomic JSON batch:

```json
{
  "commandId": "40000000-0000-4000-8000-000000000002",
  "clientId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "clientSequence": 42,
  "changes": [{ "x": 7, "y": 3, "pressed": true }],
  "releaseAll": false
}
```

`commandId` and `clientId` are UUIDs. `clientSequence` is a positive safe
integer that must increase for every new batch from one client. `changes` is
optional and may contain at most 512 entries; every entry requires integer `x`
(0–15), integer `y` (0–31), and boolean `pressed`. The complete batch is
rejected before mutation when any entry is invalid. `releaseAll` is optional
and, when combined with changes, releases that client's existing latches
before applying the batch. A request with an empty change list is a lease
heartbeat. Command retries with the same `commandId` return the first committed
result without applying the changes again.

The runtime keeps the highest `clientSequence` as a tombstone for five minutes,
far beyond the input lease and a reasonable keepalive request lifetime. It
tracks at most 1,024 unexpired client IDs rather than allowing UUID-per-mount
state to grow without bound. A batch at or below the saved value is ignored and
does not renew the lease, which prevents an in-flight press arriving after
`releaseAll` from relatching the floor. Endpoint responses retain the canonical
venue status and add top-level `applied` and `lastSequence` fields so a client
can observe this decision.

Each `clientId` owns an independent latch set with a five-second server lease.
An active client must send a heartbeat or input before the lease expires;
expiry automatically releases only that client's latches. `releaseAll: true`
provides immediate cleanup for pointer cancellation and page teardown. Remote
client sets and physical controller pressure are combined before entering the
single `GameSession`, so releasing or expiring a browser cannot release a tile
still held physically or by another browser. Responses are the canonical
venue status and include `remoteFloorInput.activeClients`, `heldTiles`, and
`leaseMillis`; `trackedClients` reports retained sequence tombstones. The lease may be tuned with
`MOTION_LEVELS_REMOTE_FLOOR_INPUT_LEASE` (duration such as `5s` or `5000ms`;
100 ms–30 s).

## Controller protocol v2

`MOTION_LEVELS_CONTROLLER_ADDR` defaults to `127.0.0.1:4201`. One full-duplex
TCP connection carries unsigned-varint-length-delimited protobuf messages:

```proto
message RuntimeMessage { oneof payload { RuntimeHello hello = 1; RuntimeFrame frame = 2; } }
message RuntimeHello { uint32 protocol_version = 1; string source_revision = 2; }
message RuntimeFrame {
  uint64 sequence = 1; int64 unix_nanos = 2; bytes rgb = 3;
  string game_session_id = 4; string venue_session_id = 5;
}
message ControllerMessage { oneof payload { ControllerHello hello = 1; PressureChange pressure = 2; } }
message ControllerHello {
  uint32 protocol_version = 1; string controller_id = 2;
  uint32 width = 3; uint32 height = 4; uint32 refresh_fps = 5;
  uint64 pressure_sequence = 6; bytes pressed = 7;
}
message PressureChange {
  uint64 sequence = 1; int64 unix_nanos = 2;
  uint32 x = 3; uint32 y = 4; bool pressed = 5;
}
```

RGB is exactly 1,536 row-major bytes (`y * 16 + x`, R/G/B). `pressed` is a
64-byte row-major bitset using least-significant bit first. The hello snapshot
is authoritative after reconnect. Messages are limited to 64 KiB; the client
reconnects with bounded backoff, detects pressure-sequence gaps, and retains
only the latest unsent frame during backpressure.

Other environment inputs are `MOTION_LEVELS_PLATFORM_URL`,
`MOTION_LEVELS_PLATFORM_TOKEN`, and `MOTION_LEVELS_ENGINE_BRIGHTNESS` (0–100,
also accepting 0–1). Local observation and remote-input tuning use
`MOTION_LEVELS_LOCAL_LIVE_FLOOR_FPS` and
`MOTION_LEVELS_REMOTE_FLOOR_INPUT_LEASE`. Optional camera start/stop hooks use
`MOTION_LEVELS_CAMERA_RECORDER_URL` and `_TOKEN`.

For local integration, `npm run dev:venue` runs the source directly. It reads
the current Git revision automatically; `MOTION_LEVELS_GAMES_SOURCE_REVISION`
can override it when the platform catalog is pinned to another development
revision. The controller still uses `MOTION_LEVELS_CONTROLLER_ADDR`, while the
HTTP bind/token use `MOTION_LEVELS_ENGINE_HTTP` and
`MOTION_LEVELS_ENGINE_TOKEN` as described above.

Semantic `.mlreplay`, animation-preview, performance diagnostics, legacy game
sources, platform ingest queues, and Go-game compatibility are deliberately
not part of this breaking runtime.
