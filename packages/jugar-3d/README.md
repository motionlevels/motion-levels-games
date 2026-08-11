# `@motion-levels-games/jugar-3d`

The shared browser implementation of Motion Levels Jugar 3D. It owns one SDK
`GameSession` and mounts the canonical React Three Fiber stage. Host apps inject
their literal game registry, analytics callbacks, and public model URL.

The package never creates a raw `WebGLRenderer`, a second game engine, or a
game-specific controller. Optional product controllers receive the existing
game instance and fixed-step observations through `createSessionController`.

Avatar acceleration, braking, facing, distance travelled and animation-graph
state are part of the fixed-tick session. The canonical procedural Motion
Athlete cast (Explorer, Runner, Trickster and Guardian) reads that state without
render-history accumulators, so replay seeks reproduce the same pose. New users
default to Explorer; automated players rotate through all four silhouettes.

Use `@motion-levels-games/jugar-3d/react` for `Stage`, `Jugar3DApp` and
`useGameSession`, and import `@motion-levels-games/jugar-3d/styles.css` once in
the host. React, React DOM, Three, R3F, Drei and Lucide are peers on purpose:
platform and website must resolve their own compatible copies so a vendored
release never installs a second Three context. The accepted ranges cover the
currently deployed website (Three 0.182/R3F 9.6) and platform (Three 0.184/R3F
9.7) hosts.

Sahur is a CC-BY-4.0 third-party model. The picker renders its required author,
source, and licence credit; hosts must preserve that UI and the package's
`ATTRIBUTIONS.md` notice when supplying the model asset. Each streamed Sahur
instance has an independent Motion Athlete fallback, preventing one model load
from blanking every avatar in the Stage.

## Live editor-authored content

A host can attach a `GameContentSource` to a `GameEntry`. The picker requests
the published level choices for the selected difficulty/mode, stores the
immutable level UUID (never its renameable slug), and loads the versioned
`GameContent` document alongside the selected game chunk. Loading failures are
shown with retry/back controls and do not start analytics or silently substitute
fixture content. Jugar passes the document into the same `GameSession` and SDK
engine used by the physical floor; it owns no level database or alternate rules.

The platform implementation uses canonical game and level UUIDs, separate
`engineGame`/level-slug aliases, and a deterministic `contentRevision`. A host
rename therefore changes presentation and compatibility aliases without
changing progress, replay, or run identity.

The playground can retain exact `SessionTrajectoryFrame` objects for same-page
visual replay. Those objects are intentionally not a portable format;
`@motion-levels-games/replay-runtime` remains the only encoded replay/checksum
contract. The playground export is a diagnostic envelope and does not include
the authoritative floor press/release stream, so it cannot reconstruct
authority after reload. A host that needs a portable replay must use the
pinned game's input-recording tooling (for example Duelo's `/replay` subpath)
rather than expect the in-memory R3F presentation cache to travel with the
JSON.

## Stage diagnostics and quality budgets

`Stage` accepts an additive `onDiagnostics(report)` callback. When supplied,
it publishes the serialisable `JugarStageDiagnostics` schema v1 every 15
samples after a 15-frame warm-up. The monitor retains at most 120 samples and
reports rAF frame interval, renderer-total draw calls and triangles, live
Three geometry/texture/program counts, and a GPU-memory proxy. Omitting the
callback avoids the scene traversal and report work.

The exported `jugarStageQualityBudgets` are executable complete-scene limits
for the canonical floor, venue, TV, shadows, debug overlay, and up to eight
avatars:

| Tier | Samples | Hardware p95 | Software-CI p95 | Calls | Triangles | Geometries | Textures | Programs | GPU proxy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `mobile-low` | 45 | 34 ms | 175 ms | 170 | 33,000 | 168 | 4 | 9 | 20 MB |
| `desktop-medium` | 60 | 25 ms | 275 ms | 170 | 33,000 | 168 | 4 | 9 | 24 MB |
| `venue-high` | 60 | 18.5 ms | 175 ms | 170 | 33,000 | 168 | 4 | 9 | 36 MB |
| `capture` | 45 | 40 ms | 525 ms | 170 | 33,000 | 168 | 4 | 9 | 36 MB |

Frame time is the browser's `requestAnimationFrame` interval, not a GPU timer.
The software ceiling keeps SwiftShader/headless CI useful as a regression gate
without presenting it as venue-hardware certification. On 2026-08-10 the
self-hosted runner's complete 120-sample desktop window measured 238 ms p95;
the 275 ms ceiling preserves about 15% regression headroom. The local native
capture/desktop p95 ratio was 1.90, predicting about 452 ms on that runner, so
the 525 ms capture ceiling preserves comparable headroom. Mobile and venue
software ceilings remain at 175 ms. Hardware targets remain 25 ms for desktop
and 40 ms for capture, and a hardware miss stays visible as a `frame-time`
violation plus the non-certification caveat even when software CI passes.
Venue-high never fails solely because identified software WebGL missed a
hardware timing target; every structural limit is still enforced. The memory
proxy sums discoverable scene geometry and texture bytes, one color/depth
drawing buffer, and the configured directional shadow map. It is a lower bound
and excludes driver padding, shader binaries, multisample resolve buffers, and
compositor memory.
