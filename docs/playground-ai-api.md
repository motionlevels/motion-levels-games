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

type PlaygroundApi = {
  getState(): {
    clockMillis: number;
    fps: number;
    frameMillis: number;
    gameId: string;
    status: string;
    paused: boolean;
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
};
```

## Coordinates

Input methods default to physical floor tile coordinates:

- `x = 0..15`
- `y = 0..31`

Pass `{ space: "preview" }` to address the currently visible board orientation.
That is useful when the board is rotated in the playground.

## Captures

- `display`: native 1920x1080 player display PNG.
- `boardPhysical`: physical 16x32 board PNG at 32 pixels per tile.
- `boardPreview`: visible board PNG, including rotation when enabled.
- `combined`: player display plus visible board preview in one flush side-by-side PNG.
  Both panes have the same height; there is no padding, gap, or background margin.

`copy(surface)` tries to write a PNG to the browser clipboard and always returns
the captured data URL when capture succeeds. If clipboard permission is denied,
use the returned `dataUrl` directly.
