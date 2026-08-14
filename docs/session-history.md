# Local session history

The venue runtime owns a durable, local history of player visits. Its public
contract is `motion-levels-session-history-v1`, defined and JSON-schema backed
by `@motion-levels-games/session-history`.

## Persistence

Set `MOTION_LEVELS_SESSION_HISTORY_DIR` to the venue-owned data directory. The
packaged runtime defaults to `/var/lib/motion-levels/session-history`; the
development runner uses `.runtime/session-history` (ignored by Git).

Each visit has its own directory:

```text
<history-root>/<visit-id>/manifest.json
<history-root>/<visit-id>/events.ndjson
<history-root>/<visit-id>/replays/<run-id>.mlrun.jsonl.gz
```

`manifest.json` is replaced atomically after an fsync. `events.ndjson` is the
canonical, append-only, fdatasync'd timeline with stable sequence numbers and
event IDs. Each logical append is one newline-terminated v1 journal envelope;
all events in a lifecycle transition are therefore committed as one NDJSON
record. A torn or non-terminated final record is discarded and durably
truncated as a whole, while legacy one-event-per-line journals remain readable.
Lifecycle transitions are committed journal-first and carry a granular
after-state for the affected visit/selection/run. The manifest's `lastSequence`
is a checkpoint: startup idempotently reduces every later complete batch and
rewrites a repaired checkpoint, so a crash between journal sync and manifest
replacement cannot split the timeline from its state.
The lifecycle journal deliberately excludes high-frequency frames, pressure
samples, and elapsed-only ticks. Every run instead owns the separate automatic
gameplay artifact described below. The runtime keeps elapsed clocks in memory,
checkpoints them to the manifest at most once every five seconds, and writes
the exact final values when a run ends.

On process startup, an active visit is restored. Any run or game selection
that was open when the previous process disappeared is closed as interrupted,
and recovery is recorded on the timeline. The visit itself remains active so
the kiosk can continue it.

## Automatic gameplay replay

Every run records `motion-levels-run-replay-v1`, independently of camera
policy. Frames come from the controller's authoritative `PresentedFrame`
callback—not a rendering reconstructed from game state—so the exact RGB,
pressure bitset, fade/watchdog result, presentation sequence, desired source
sequence, and presentation time are retained. Effective physical/remote
inputs, game events, and periodic or material snapshots form a causal timeline
alongside those visual frames. Frame pressure is authoritative for playback;
input records are diagnostic markers and must not be reapplied as an overlay.

The active journal is `replays/<run-id>.mlrun.jsonl.partial`. RGB and pressure
use periodic keyframes plus binary replacement-run deltas. The runtime appends
a durable footer at the run boundary, streams the journal through gzip without
loading the complete replay into memory, and atomically renames the result to
`<run-id>.mlrun.jsonl.gz`. Startup truncates a torn final record and publishes
the surviving journal with a `partial` footer. If a valid final gzip and its
pre-rename journal both survive a crash, the gzip wins and the duplicate is
removed durably.

The visit's `recordings` collection links the replay through stable asset ID
`run-replay-<run-id>`, backend `venue-runtime-replay`, explicit selection/run
IDs, relative path, bytes, SHA-256, record counts and sequence bounds. Normal
local completion is `pending_upload`; the venue-owned uploader can
idempotently update the same asset to `complete` with remote object metadata.
This repository has no cloud-storage or deployment coupling.

Local replay cache is bounded by `MOTION_LEVELS_REPLAY_MAX_LOCAL_BYTES`
(512 MiB by default; zero or invalid values fail closed to that default). The
runtime counts every local replay and prunes oldest files only after the same
asset is `complete`, retains valid bytes/SHA-256, and has an HTTPS download on
the configured Platform origin. Partial artifacts are never eligible, even if
an uploader later marks their asset complete. Pruning rejects symlinks and path
escapes, fsyncs the replay directory, clears `localPath`, and preserves the
remote asset plus `localPruned` audit metadata. Offline, pending, failed and
unverified files can temporarily exceed the bound rather than lose the only
copy.

This contract supersedes automatic production `.mlreplay.zst` capture. That
legacy file remains historical input only and must not be regenerated. The
older `GameReplay` API in `@motion-levels-games/replay-runtime` remains useful
for deterministic playground/agent diagnostics; it is not the venue session
visual replay contract.

## Hierarchy and recording policy

History is organized as visit → game selections → runs. Selecting a game adds
a selection. An explicit restart, an automatic retry after a failed published
level, or an automatic advance to the next published level closes the current
run and opens another run under that same selection. Automatic attempt changes
keep the game engine's continuous clock, while each persisted run and its
events use an attempt-relative clock starting at zero.

Recording policy is an object with one of these scopes:

- `off`: do not request camera recording.
- `visit`: one capture for the complete visit.
- `selection`: one capture per selected game, including all of its restarts.
- `run`: one capture per individual run, explicit restart, automatic failed
  attempt retry, or automatic next-level attempt.

Legacy `recordingEnabled: true|false` remains accepted and maps to `visit` or
`off`. Changing scope while a visit is active closes the prior capture and
starts the appropriate boundary for the current visit, selection, or run.

The camera adapter is configured with `MOTION_LEVELS_CAMERA_RECORDER_URL` and,
optionally, `MOTION_LEVELS_CAMERA_RECORDER_TOKEN` or
`MOTION_LEVELS_CAMERA_RECORDER_TOKEN_FILE`. Boundaries are globally serialized
because the legacy camera service accepts only one active capture. After a
stop request, the adapter polls `/status` until that capture disappears before
starting another. Visit captures are watched against the camera's real
`maxEndsAt`: before the limit the runtime persists a stop intent, confirms the
old capture is absent, and opens a new `RecordingAsset`/`captureId`. A run that
crosses that boundary is linked to both assets. Uncertain stops block every
new start and are retried independently per capture.

A successful `POST /sessions/start` schedules a capture but is not proof that
the GoPro shutter opened. The adapter polls `/status` for the same `captureId`
and marks the asset `recording` only after `recordingState` is
`recording-segment` (or the forward-compatible `recording`). The physical
`currentSegmentStartedAt` and measured startup latency are persisted in the
asset metadata. `MOTION_LEVELS_CAMERA_RECORDER_START_CONFIRM_TIMEOUT` controls
that confirmation wait independently of the ordinary HTTP request timeout and
defaults to eight seconds.

`run` policy is strict. Every initial run, explicit restart, automatic retry,
and automatic next-level advance first creates a durable `recording_arming`
run and a camera-start handle. Gameplay clocks, ticks, floor input, and the
published frame remain frozen until physical recording is confirmed. If the
venue-owned eight-second gate expires, it never auto-continues: the operator
must retry the same durable asset/capture ID, continue without video, or
cancel. A late confirmation is still persisted but cannot release a timed-out
gate. Continue/cancel first confirm that the capture is physically stopped;
an uncertain stop leaves the gate in place. Continuing affects only that run
and does not change the visit policy. Automatic published-level transitions
are explicitly held by the game until this barrier releases, so the terminal
attempt cannot advance behind the camera gate.

Shutdown stops accepting new HTTP requests, explicitly ends long-lived SSE
streams, waits for ordinary in-flight commands, and only then drains the
runtime/camera queue, including stop retries scheduled after the initial drain
began. Uncertain stops retry on a short shutdown cadence; a permanently
unreachable camera leaves the durable `finalizing` intent and the supervisor's
30-second safety timeout terminates the process non-zero.

Start and stop intents are durable. A lost start response stays `requested`
and is retried idempotently with the same `captureId`; an uncertain stop stays
`finalizing` and is retried on startup. A graceful runtime restart closes its
current visit capture, keeps the visit recoverable, and opens a new capture for
that same active visit in the next process.

Video bytes are not stored in session history. Camera/upload services attach
or update a `RecordingAsset` containing capture identity, status, local or
remote URLs, file metadata, and the associated selection/run IDs.

## Authenticated HTTP API

Every history route requires an exact `x-motion-levels-engine-token`, including
requests arriving over loopback or through the venue Caddy proxy. Health and
the other local adapter routes keep their existing loopback trust. Configure
the history credential with `MOTION_LEVELS_ENGINE_TOKEN` or
`MOTION_LEVELS_ENGINE_TOKEN_FILE`; while venues migrate, the runtime falls back
to the already provisioned `MOTION_LEVELS_CAMERA_RECORDER_TOKEN` or
`MOTION_LEVELS_CAMERA_RECORDER_TOKEN_FILE`. Empty values, `#` placeholders,
oversized values, and header control characters are rejected fail-closed.

Routes:

- `GET /api/history/v1/sessions?status=&from=&to=&limit=&cursor=`
- `GET /api/history/v1/sessions/:sessionId`
- `GET /api/history/v1/sessions/:sessionId/events?limit=&cursor=`
- `GET|HEAD /api/history/v1/sessions/:sessionId/runs/:runId/replay`
- `POST /api/history/v1/sessions/:sessionId/recordings`

List and event responses use opaque cursors. `from` and `to` are inclusive
epoch-millisecond visit-overlap filters. Recording POST bodies must conform to
the v1 `RecordingAsset` shape; unknown fields are not persisted.
Replay downloads return the stored gzip bytes with the run-replay vendor media
type and no HTTP `Content-Encoding`, so an uploader verifies the persisted
SHA-256 without transparent client decompression.

`/api/health` distinguishes persistence, camera configuration, and camera
health. Player state likewise separates `venueSessionRecordingConfigured`
(the adapter and durable association are configured) from
`venueSessionRecordingAvailable` (the latest start/observation is healthy) and
`venueSessionRecordingEnabled` (the requested policy is non-off and currently
available). This lets the menu offer an explicit retry while degraded without
claiming that recording is active before the camera confirms it. Filesystem
paths and raw errors are never exposed.
