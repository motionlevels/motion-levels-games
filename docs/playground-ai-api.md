# Playground AI API

The playground exposes a browser-only development API for local playtesting.
Open the app with `npm run dev`, then use either global:

```js
window.motionLevelsPlayground
window.ml
```

The root `<html>` element gets `data-motion-levels-playground-api="ready"`
when the API has been installed.

The API is intentionally local tooling, not part of the game contract.
The playground runs games through the shared TypeScript SDK engine at a 50fps
baseline. `ml.step()` with no argument advances exactly one engine frame.

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

  agentLab?: AgentLabApi;
};
```

## Deterministic 3D Agent Lab

Cruce Galáctico exports the first optional deterministic agent harness. Select
that game, activate the 3D surface, and drive it through the same global API:

```js
const lab = ml.agentLab;
lab.setActive(true);
lab.setAgentCount(10);
lab.setProfile("expert");
lab.setQualityTier("capture");
lab.pause();
lab.reset();
lab.step(125);

console.log(lab.getState()); // seed, tick, checksum, metrics, debug, performance
const capture = await lab.capture(); // deterministic 1920x1080 PNG by default

lab.stopRecording();
const replayJson = lab.exportReplay();
lab.replay.enter();
lab.replay.seek(75);
lab.replay.setSpeed(0.5);
lab.replay.play();
```

The optional surface reports `available: false` for games without a harness.
Its full browser contract is:

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
    performance?: {
      samples: number;
      averageFrameMillis: number;
      p95FrameMillis: number;
      worstFrameMillis: number;
      maxDrawCalls: number;
      maxTriangles: number;
      maxTextureMegabytes: number;
      withinBudget: boolean;
      violations: readonly string[];
    };
  };
  setActive(active: boolean): void;
  play(): void;
  pause(): void;
  step(ticks?: number): void;
  reset(options?: { newSeed?: boolean }): void;
  setAgentCount(count: number): void; // clamped to 1..10
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

Agent Lab `step()` counts fixed 20 ms ticks, unlike the root `ml.step()` which
accepts milliseconds. The lab's autonomous actions still enter the real game
as timestamped floor press/release operations. Three.js consumes only the
authoritative frame and agent presentation snapshots; disabling, seeking, or
disposing the renderer cannot change the recorded checksum or outcome.

While recording, Agent Lab retains every exact `PlaygroundAgentHarnessFrame` in
memory. A batched `step(n)` advances authority as `n` consecutive one-tick
steps, records every resulting frame, and renders only the final frame. Replay
enter, seek, play, and single-step select those retained frames; they never
construct a new harness or ask the current AI implementation to regenerate the
run. Exiting replay restores the parked live harness at the point where live
execution stopped.

The exact presentation trajectory is intentionally page-local. `exportReplay()`
remains the portable input/action/checksum artifact, but it does not contain the
full Agent Lab presentation and debug frames and therefore cannot reproduce
that exact 3D trajectory after a reload or in another browser by itself. There
is currently no Agent Lab replay-import API.

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

The interactive floor keeps latched mouse/touch occupancy after pointer-up so
one gesture can represent multiple simultaneous players. Occupancy is exposed
through `aria-pressed` for semantics and automation, but it has no persistent
CSS treatment. Once the pointer leaves, all hover visuals must disappear; the
game frame is the only persistent visual floor state.

For multiplayer readiness, click one tile in each illuminated start zone in
sequence. Each click remains logically occupied until that tile is clicked
again, allowing one person with one mouse to initialize the maximum supported
player count. Multiplayer `player-ready` manifests also provide a 1–2 second
release grace for brief input transitions.

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

```js
const media = await ml.media("ping-pong");
console.log(media.assets.thumbnail.dataUrl);
console.log(media.assets.playerDisplay.dataUrl);
```

To render media for a specific configuration:

```js
const media = await ml.media("ping-pong", {
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
