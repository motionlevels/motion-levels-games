# Playground AI API

The playground exposes a browser-only development API for local playtesting.
Open the production-shaped environment with `npm run dev` and use the `Venue |
Sandbox` selector at `http://127.0.0.1:4104/`, then use either global:

```js
window.motionLevelsPlayground
window.ml
```

The root `<html>` element gets `data-motion-levels-playground-api="ready"`
when the API has been installed.

The API is intentionally local tooling, not part of the game contract. In
Sandbox mode the playground runs games through the shared TypeScript SDK engine
at a 50fps baseline. `ml.step()` with no argument advances exactly one engine
frame. In Venue mode the same API is a façade over the canonical VenueRuntime
display/control/floor endpoints; the runtime owns the live clock, snapshot,
frame, pause state, and input handling, so `ml.step()` only refreshes the latest
runtime display rather than simulating a second game. Switching modes releases
held inputs, keeps venue and sandbox event streams separate, and resynchronizes
the latest venue snapshot when returning. Sandbox never sends controls, floor
input, or audio to Venue, so another Sandbox or recording tab cannot interrupt
an active Venue tab. `npm run dev:standalone` remains an isolated automation
path that exposes Sandbox only.

## Deterministic Playthrough

```js
ml.reset();
ml.resume();
ml.press(4, 20);
ml.pause();
ml.step(2000);
ml.resume();
ml.release(4, 20);
ml.pause();
ml.step(1000);

const feedback = await ml.capture(["display", "boardPhysical", "combined"]);
console.log(ml.getState(), feedback.combined.dataUrl);
```

## Prepared Playtest Scenarios

Games may expose deterministic, game-owned setup scenarios for animation and
edge-case iteration. Preparation drives the ordinary engine inputs quickly and
stops immediately before the interesting transition; it does not restore the
display-only `GameSnapshot` as mutable authority.

Duelo exposes a victory scenario that leaves player 1 one real tile from
winning:

```js
ml.scenario.list();
// [{ id: "victory", label: "One tile before victory" }]

ml.scenario.prepare("victory");
// The board is now running with exactly one player-1 target remaining.

ml.scenario.trigger();
// Claims the final tile through normal input and starts the victory animation.

const review = await ml.scenario.record("victory");
// Deterministically prepares, triggers, and records the TV plus physical floor.
console.log(review.clip.dataUrl, review.contactSheet.dataUrl);
```

Prepared scenarios are available only in Sandbox mode because Venue mode keeps
the integrated runtime as the sole owner of its live game state.
Recording defaults belong to the game-owned scenario. Duelo records 400 ms of
pre-roll and its complete five-second victory transition at 10 fps. The
playground stops only its automatic clock while recording, advances the real
engine explicitly, and scrubs TV CSS animations to the matching timestamp. It
returns a 1230x540 animated WebP plus a timestamped six-frame PNG contact sheet.
For browser tools that cannot call page globals directly, launch the same flow
with `?recordScenario=victory`; the query selects Sandbox automatically and
renders the generated clip, contact sheet, and download links in a dedicated
responsive review page on the same `4104` origin.
The ordinary workbench remains mounted offscreen only because native player
display capture requires its renderer; it never overlaps the visible review.

## Methods

```ts
type PlaygroundCaptureSurface =
  | "display"
  | "boardPreview"
  | "boardPhysical"
  | "combined";

type PlaygroundPointSpace = "physical" | "preview";

type PlaygroundCapture = {
  surface: PlaygroundCaptureSurface;
  width: number;
  height: number;
  dataUrl: string;
};

type PlaygroundMediaAssetKind =
  | "thumbnailSmall"
  | "thumbnail"
  | "animation"
  | "playerDisplay"
  | "playerDisplayAnimation";

type PlaygroundMediaAsset = {
  kind: PlaygroundMediaAssetKind;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
  dataUrl: string;
};

type PlaygroundMediaBundle = {
  gameId: string;
  label: string;
  difficulty: string;
  options: Record<string, unknown>;
  seed: number;
  playerCount: number;
  generatedAt: string;
  assets: Record<PlaygroundMediaAssetKind, PlaygroundMediaAsset>;
};

type PlaygroundApi = {
  getState(): {
    clockMillis: number;
    difficulty: string;
    fps: number;
    frameMillis: number;
    gameId: string;
    options: Record<string, unknown>;
    status: string;
    seed: number;
    paused: boolean;
    playerCount: number;
    rotatedBoard: boolean;
    snapshot: unknown;
    frame: unknown;
    previewFrame: unknown;
    events: unknown[];
  };

  pause(): void;
  resume(): void;
  reset(): void;
  step(ms?: number): void;

  press(x: number, y: number, options?: { space?: PlaygroundPointSpace }): void;
  release(x: number, y: number, options?: { space?: PlaygroundPointSpace }): void;
  tap(x: number, y: number, options?: { space?: PlaygroundPointSpace; durationMs?: number }): void;

  capture(surfaces?: PlaygroundCaptureSurface[]): Promise<Record<PlaygroundCaptureSurface, PlaygroundCapture>>;
  copy(surface: PlaygroundCaptureSurface): Promise<PlaygroundCapture>;
  media(
    gameId?: string,
    options?: {
      difficulty?: string;
      options?: Record<string, unknown>;
      players?: Array<{ label?: string; name?: string; color?: string }>;
      seed?: number;
      playerCount?: number;
    }
  ): Promise<PlaygroundMediaBundle>;

  scenario: {
    list(): Array<{ id: string; label: string }>;
    prepare(id: string): {
      description?: string;
      gameId: string;
      id: string;
      label: string;
      triggerActions: number;
    };
    record(id: string, options?: {
      durationMillis?: number;
      frameIntervalMillis?: number;
      leadInMillis?: number;
    }): Promise<{
      clip: { dataUrl: string; fileName: string; width: number; height: number; mimeType: "image/webp" };
      contactSheet: { dataUrl: string; fileName: string; width: number; height: number; mimeType: "image/png" };
      durationMillis: number;
      frameCount: number;
      frameIntervalMillis: number;
      gameId: string;
      id: string;
      label: string;
      leadInMillis: number;
      playerCount: number;
      seed: number;
    }>;
    trigger(): ReturnType<PlaygroundApi["getState"]>;
  };

  agentLab?: AgentLabApi;
};
```

## Deterministic Jugar 3D Agent Surface

The `Floor / Agents 3D` switch is always present in the standard top bar.
`Agents 3D` is enabled only when the selected game exports a product
`createSessionController`; Duelo is the first supported game. The surface uses
the shared `@motion-levels-games/jugar-3d` `JugarPresentationSession` and `Stage` extracted
from the deployed Jugar experience. It does not create a second game engine or
a parallel raw Three.js renderer.

```js
const lab = ml.agentLab;
lab.setActive(true);
lab.setAgentCount(8);
lab.setProfile("mixed");
lab.setQualityTier("capture");
lab.pause();
lab.reset();
lab.step(125);

console.log(lab.getState()); // seed, tick, checksum, metrics and debug state
const capture = await lab.capture(); // the real WebGL drawing-buffer size

lab.stopRecording();
const replayJson = lab.exportReplay();
lab.replay.enter();
lab.replay.seek(100);
lab.replay.setSpeed(0.5);
lab.replay.play();
```

For unsupported games the same top-bar control is visible but disabled, and
the optional API reports `available: false`. Its browser contract remains:

```ts
type AgentLabApi = {
  getState(): {
    available: boolean;
    active: boolean;
    paused: boolean;
    replayMode: boolean;
    replayPaused: boolean;
    recording: boolean;
    agentCount: number;
    profile: "mixed" | "cautious" | "balanced" | "bold" | "helper" | "explorer" | "expert";
    qualityTier: "venue-high" | "desktop-medium" | "mobile-low" | "capture";
    speed: number;
    replaySpeed: number;
    replayEndTick: number;
    selectedAgentId?: string;
    seed: number;
    tick: number;
    checksum: string;
    debug: { paths: boolean; reservations: boolean; targets: boolean };
    metrics?: Record<string, number | boolean>;
    performance?: JugarStageDiagnostics;
  };
  setActive(active: boolean): void;
  play(): void;
  pause(): void;
  step(ticks?: number): void;
  reset(options?: { newSeed?: boolean }): void;
  setAgentCount(count: number): void; // normalized by the selected manifest
  setProfile(profile: string): void;
  setQualityTier(tier: string): void;
  setSpeed(speed: number): void; // 0.25..4
  selectAgent(agentId?: string): void;
  setDebug(options: { paths?: boolean; reservations?: boolean; targets?: boolean }): void;
  startRecording(): void;
  stopRecording(): void;
  exportReplay(): string;
  replay: {
    enter(): void;
    exit(): void;
    play(): void;
    pause(): void;
    seek(tick: number): void;
    setSpeed(speed: number): void;
  };
  capture(options?: { width?: number; height?: number }): Promise<{
    surface: "agents3d";
    width: number;
    height: number;
    dataUrl: string;
  }>;
};
```

`performance` is the shared `@motion-levels-games/jugar-3d` diagnostic schema,
not a playground-only summary. It includes bounded sample count, latest and
rolling frame milliseconds, renderer-total calls/triangles, live
geometry/texture/program counts, texture and total GPU-memory proxies, the
selected tier's executable thresholds, renderer identity, readiness,
structural/timing results, and violations. Wait for `budgetReady` before
asserting `withinBudget`.

The hardware p95 frame target remains visible when the browser uses
SwiftShader. A separate, explicit `maxSoftwareP95FrameMillis` keeps the
heterogeneous self-hosted software-renderer pool useful as a timing regression
gate without labelling it venue certification. The
`caveats` array documents that rAF interval is not a GPU timer and that memory
is a lower-bound proxy. Structural calls, triangles and resource thresholds
are never waived; venue-high alone may waive a software-renderer hardware-time
miss while continuing to report the `frame-time` observation.

`agentLab.step()` counts fixed 20 ms Jugar ticks, unlike root `ml.step()`, which
accepts milliseconds. Product controller actions are applied by that same
session as authoritative avatar movement and timestamped floor press/release
input. The controller never creates or advances an engine. Path and target
overlays come from the controller action, and the Agent selector makes its
explanation reachable without reading intent from floor colours.

While recording, the surface retains every exact `SessionTrajectoryFrame` in
memory. `step(n)` advances authority as `n` consecutive one-tick steps and
records each result while React presents only the final one. Replay enter,
seek, play, and single-step present those retained frames without regenerating
AI. Replay exit restores the parked live `JugarPresentationSession` exactly where it
stopped. Character animation is sampled from the recorded presentation clock,
so repeatedly seeking one tick does not accumulate rAF-dependent pose state.

`exportReplay()` uses the canonical `@motion-levels-games/replay-runtime`
envelope for diagnostic metadata, controller actions, state samples and
checksums. It does not include the authoritative floor press/release stream,
so the JSON cannot reproduce game authority or exact camera/character
presentation after reload; there is currently no trajectory import API.
Duelo's separate tooling subpath records real inputs when a portable,
headlessly verifiable replay is required.

`capture()` reads the existing WebGL drawing buffer. Omitted dimensions retain
its native size; explicit dimensions may downscale it. Requests larger than the
real buffer throw instead of labelling an upscaled image as native.

## Coordinates

Input methods default to physical floor tile coordinates:

- `x = 0..15`
- `y = 0..31`

Pass `{ space: "preview" }` to address the currently visible board orientation.
That is useful when the board is rotated in the playground.

## Game Settings

The playground reads `manifest.config` from each game and renders matching local
controls for player count, difficulty, and player-facing config variables. A
player count of `0` means "any/unspecified" only for games with
`manifest.players.allowAny: true`; strict games clamp player count into their
declared min/max range. `allowAny` adds `0 / Any` to that declared range; it
does not make every positive count valid. Player and difficulty selectors show
only the options declared by the manifest.

Game authors should default `allowAny` to `true` whenever configured group size
does not alter the board or rules. `allowAny: false` is reserved for games with
a real count-dependent layout, team, target, turn, or scoring model. Any mode
still follows the normal physical player-readiness lifecycle.

`getState()` includes the active `seed`, `playerCount`, `difficulty`, and
`options` values so agents can record the exact run configuration.

The browser remembers the last selected game and restores it on reload when the
game is still available. Changing the player count, difficulty, seed, or any
manifest-defined option restarts the engine with the new normalized
configuration. The new run begins at clock zero and follows the game's normal
start lifecycle.

Opening a playground dialog or focusing a selector temporarily pauses the live
engine. Pause locks compose, so closing one control does not resume while
another is still open. Manual pause is independent: a game that was manually
paused before opening a control remains paused after every control closes.
`getState().paused` reports the effective combined pause state. While that
value is true, the TV display status reads `En pausa`; the snapshot's game phase
remains unchanged so its gameplay content does not shift.

Pause is a hard player-input boundary. `press`, `release`, and `tap` are ignored
while `getState().paused` is true, whether pause is manual or comes from an open
dialog/selector. Entering pause releases any tiles that were already held so
they cannot remain stuck after resume. Explicit `step()` still advances the
existing engine state for deterministic inspection; it does not apply blocked
input. For deterministic input, briefly `resume()`, send the input
synchronously, then `pause()` before stepping time.

The interactive floor mirrors the controller's momentary mouse/touch behavior.
The tile under a held pointer is exposed through `aria-pressed` for semantics
and automation, moving to another tile releases the previous one, and
pointer-up, pointer-cancel, blur, page hide, or leaving the floor releases the
active tile. It has no persistent CSS treatment; the game frame is the only
persistent visual floor state.

For multiplayer readiness, hold each illuminated start zone with
`ml.press(x, y)` and keep those inputs active through the countdown, then call
`ml.release(x, y)` after the game reaches `running`. Ordinary UI clicks are
intentionally not a multi-player latch mechanism. Multiplayer `player-ready`
manifests also provide a 1–2 second release grace for brief input transitions.

## Start Lifecycle

Games normally initialize in `waiting`, not `running`. Their snapshot reports
`readyPlayers`, `requiredPlayers`, and `countdownMillis`. Hold the required
floor zones with `ml.press(...)`, then advance time through `starting` with
`ml.step(...)`; use `ml.release(...)` to verify that leaving a required zone
after its grace window cancels the countdown. Only a manifest with the explicit
exception `start: { mode: "immediate" }` may run on selection.

All option values exposed by the API have passed through the SDK's
manifest-driven normalization. Undeclared options are removed, missing values
receive their manifest defaults, numeric values are clamped to their declared
bounds, and invalid difficulty values fall back to the manifest default.
The SDK-wide default seed is `137`; manifests do not declare their own seed
defaults.

## Captures

- `display`: native 1920x1080 player display PNG.
- `boardPhysical`: physical 16x32 board PNG at 32 pixels per tile.
- `boardPreview`: visible board PNG, including rotation when enabled.
- `combined`: player display plus visible board preview in one flush side-by-side PNG.
  Both panes have the same height; there is no padding, gap, or background margin.

`copy(surface)` tries to write a PNG to the browser clipboard and always returns
the captured data URL when capture succeeds. If clipboard permission is denied,
use the returned `dataUrl` directly.

## Media Assets

`media(gameId?, options?)` returns generated catalog-style assets for any game
discovered by the playground. Omit `gameId` to use the currently selected game.
The result also includes the canonical media `schema` and bundle-relative
`media` references from `@motion-levels-games/game-sdk`.

```js
const media = await ml.media("ping-pong-v2");
console.log(media.assets.thumbnail.dataUrl);
console.log(media.assets.playerDisplay.dataUrl);
```

To render media for a specific configuration:

```js
const media = await ml.media("ping-pong-v2", {
  difficulty: "hard",
  playerCount: 0,
  players: [{ name: "Chris" }, { name: "Jose" }],
  options: { points_to_win: 7 },
  seed: 202
});
```

Assets:

- `thumbnailSmall`: low-quality landscape WebP board thumbnail, 256x128.
- `thumbnail`: high-quality landscape WebP board thumbnail, 1024x512.
- `animation`: animated WebP board preview, 512x256.
- `playerDisplay`: high-quality player display WebP, downscaled to 1280x720.
- `playerDisplayAnimation`: animated player display WebP at 640x360, generated
  from the same deterministic preview timeline as the floor animation.

The board assets are rendered from deterministic TypeScript engine frames, not
DOM screenshots. The player-display asset is browser-rendered from the reusable
display component, then downscaled for lighter catalog/debug use. Use
`capture(["display"])` when you need the exact native 1920x1080 PNG.
