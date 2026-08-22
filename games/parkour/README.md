# Parkour

- Canonical game ID: `c1daea4f-e586-4116-8cbe-871cde887a81`
- Engine alias: `parkour`
- Editable source: the existing platform level editor and published level API

Parkour is a thin product over
`@motion-levels-games/published-level-runtime`. It keeps the classic
selection-time three-second platform load, animated lava, per-tile damage,
difficulty lives/speed, connected blue-platform capture, green platform
transitions, audio references, and shared repository-authored result
animations.

The host supplies the current editor revision through `GameConfig.content`.
`fixtures-content.ts` is a small deterministic offline/playground fallback,
not a copy of the production levels. Jugar 3D uses the product's semantic
controller against that same authoritative engine instance.

Parkour is a cooperative `Any` product for one to eight configured players,
with Easy, Medium, and Hard difficulty. The course, objectives, shared score,
and shared lives do not depend on the booking roster, so `playerCount: 0`
selects Any while the runtime still normalizes a live session to at least one
agent.

```sh
npm test --workspace @motion-levels-games/parkour
npm run typecheck --workspace @motion-levels-games/parkour
```
