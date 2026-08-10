# `@motion-levels-games/three-renderer`

Browser-only, framework-free Three.js presentation for the Motion Levels 16x32
floor and procedural Motion Athlete agents. Game rules, collisions, navigation,
scoring, and objective ownership deliberately stay outside this package.

## React-friendly ownership

Create and dispose the renderer in an effect; the renderer never owns a React
tree, `requestAnimationFrame`, `ResizeObserver`, or simulation clock.

```ts
const renderer = createAgentSceneRenderer(canvas, {
  qualityTier: "desktop-medium",
  onPerformanceSample(sample, report) {
    // Feed development diagnostics or telemetry.
  }
});

renderer.setFrame(frame);
for (const snapshot of agents) renderer.pushAgentSnapshot(snapshot);
renderer.render(presentationMillis);

renderer.resize(width, height, window.devicePixelRatio);
renderer.dispose();
```

`render(atMillis)` uses only the supplied absolute presentation time for graph,
locomotion, blink, and procedural pose advancement. Repeating the timestamp
freezes the scene. Slow motion and single-step work by supplying correspondingly
slower or stepped timestamps. A backwards timestamp automatically resets
temporal animation state; `resetTimeline(true)` also clears interpolation
buffers during an authoritative replay seek.

CPU performance samples charge `setFrame()`, every `pushAgentSnapshot()`, and
`setDebugData()` preparation to the next `render()` sample, in addition to pose
evaluation and the Three.js render call. The renderer's injected
`performanceNow` seam covers all of those measurements but never presentation
time.

## Data boundaries

- `Frame` is mapped to one 512-instance floor through
  `RENDERER_GRID_TO_WORLD`; missing cells receive a deterministic base colour.
- Each agent has a bounded, defensive snapshot buffer. Position, velocity, and
  facing interpolate; rule-bearing discrete fields switch at the midpoint and
  are never extrapolated.
- Four procedural variants use the exact `motion-athlete-v1` canonical bone
  hierarchy from `character-runtime`, with in-place locomotion and presentational
  head-look, lean, blink, action, and emotion layers.
- Debug paths, reservations, and targets are cloned and frozen. They visualize
  caller-provided data only and never make decisions.
- Quality changes cap DPR, character count, LOD, and contact/key/full shadow
  behavior without recreating the WebGL context.

The renderer owns its Three.js scene resources and the supplied renderer
context. `dispose()` is idempotent, disposes pooled and per-agent resources,
releases render lists, and loses the WebGL context; it never removes the caller's
canvas from the DOM.
