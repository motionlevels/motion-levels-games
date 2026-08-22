# Temporada 1

- Canonical game ID: `4773837e-3565-49d7-8953-3b40f59fca7b`
- Engine alias: `temporada1-niveles`
- Editable source: the existing platform level editor and published level API

Temporada 1 is a thin product over
`@motion-levels-games/published-level-runtime`. It preserves the tested level
catalog's authored animation timing, blue objectives, purple double-press
objectives, red-tile damage, difficulty lives/speed/timers, audio references,
result animation, level progression, and automatic retry behavior.

Its result animations are referenced from the shared repository-level authored
animation sources rather than copied into this game package.

The host supplies the current editor revision through `GameConfig.content`.
`fixtures-content.ts` is a small deterministic offline/playground fallback,
not a frozen copy of the 24 production levels. The same engine and content run
on the floor, player display, and Jugar 3D; the semantic controller only plans
characters and never constructs a parallel game.

Temporada 1 supports one through six players and Easy, Medium, Hard, and Expert
difficulty.

```sh
npm test --workspace @motion-levels-games/temporada1-niveles
npm run typecheck --workspace @motion-levels-games/temporada1-niveles
```
