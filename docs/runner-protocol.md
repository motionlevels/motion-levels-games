# Runner protocol v1

The production runner reads one JSON request per line from stdin and writes one
JSON response per line to stdout. Stderr is reserved for diagnostics. Every
message includes `version: 1` and a caller-generated `id`; responses echo the
same id and include the bundle `sourceRevision`.

Methods:

- `init`: selects a `gameId` and accepts seed, player count/roster, difficulty,
  duration, and manifest-defined options.
- `input`: applies one physical 16x32 press or release.
- `control`: pauses, resumes, resets, or returns status. Pause releases held
  inputs and blocks new input without changing the snapshot phase.
- `tick`: advances to an absolute monotonic `atMillis` timestamp.
- `status`: returns the current state without advancing it.

Successful responses contain the complete snapshot, new events, and the
current frame as 512 row-major hex colors. The runner uses the shared 50fps SDK
cadence. The venue supervisor is responsible for physical floor output, audio
cue playback, session/replay recording, health, restart policy, and exposing
the display feed.
