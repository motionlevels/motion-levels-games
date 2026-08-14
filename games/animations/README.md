# Animaciones

Canonical game id: `a861f0dc-3e2e-4fe9-b487-33194af75b68` (slug
`animations`, legacy alias `salvapantallas`).

The ambient floor and screensaver product. It uses the native composable
TypeScript API from `@motion-levels-games/animation-runtime` and can run one
selected animation or rotate through an immutable content snapshot.

This game is intentionally `immediate`: it is ambient venue content rather
than a scored player session. Pressure creates a short deterministic ripple
without restarting the animation. The built-in `apagado` entry is the deliberate
exception: it keeps the runtime and floor controller active while rendering all
512 tiles as `#000000`, and ignores pressure so no floor interaction can light a
tile. It is selectable directly (or through an explicit authored rotation) but
is excluded from the built-in automatic rotation so an idle venue never starts
with an unexpectedly dark floor.

## Authored content

Hosts may provide `motion-levels-animation-content-v1` in `GameConfig.content`:

```json
{
  "schema": "motion-levels-animation-content-v1",
  "contentRevision": "sha256:...",
  "selectedAnimationId": "aurora",
  "rotationIds": ["aurora", "neon-ribbons", "bioluminescence"],
  "rotationSeconds": 20
}
```

The runtime never performs network I/O. Platform owns authored records and
venue owns fetching/caching and hardware output.
