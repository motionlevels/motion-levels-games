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
The playground runs games through the shared TypeScript SDK engine at a 30fps
baseline. `ml.step()` with no argument advances exactly one engine frame.

## Deterministic Playthrough

```js
await ml.pause();
ml.reset();
ml.press(4, 20);
ml.step(250);
ml.release(4, 20);
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
  | "playerDisplay";

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
      seed?: number;
      playerCount?: number;
    }
  ): Promise<PlaygroundMediaBundle>;
};
```

## Coordinates

Input methods default to physical floor tile coordinates:

- `x = 0..15`
- `y = 0..31`

Pass `{ space: "preview" }` to address the currently visible board orientation.
That is useful when the board is rotated in the playground.

## Game Settings

The playground reads `manifest.config` from each game and renders matching local
controls for player count, difficulty, and player-facing config variables. A
player count of `0` means the game does not care about the real number of
players for that run; the SDK preserves `playerCount: 0` instead of clamping it.

`getState()` includes the active `seed`, `playerCount`, `difficulty`, and
`options` values so agents can record the exact run configuration.

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
  options: { points_to_win: 7 },
  seed: 202
});
```

Assets:

- `thumbnailSmall`: low-quality landscape WebP board thumbnail, 256x128.
- `thumbnail`: high-quality landscape WebP board thumbnail, 1024x512.
- `animation`: animated WebP board preview, 512x256.
- `playerDisplay`: high-quality player display WebP, downscaled to 1280x720.

The board assets are rendered from deterministic TypeScript engine frames, not
DOM screenshots. The player-display asset is browser-rendered from the reusable
display component, then downscaled for lighter catalog/debug use. Use
`capture(["display"])` when you need the exact native 1920x1080 PNG.
