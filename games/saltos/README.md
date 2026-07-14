# Saltos

TypeScript-engine successor to the Motion Go `authored-saltos` game.

Stand on the blue start platform through the shared countdown, then jump from
the blue platform to each green platform without touching the animated lava.
Each safe landing scores one jump. Touching any other tile ends the run; lasting
the full minute wins and preserves the final score through a five-second result
animation.

The board and rules do not depend on booking size, so the game supports
`0 / Any` while still requiring one real player on the start platform.

```sh
npm run test --workspace @motion-levels-games/saltos
npm run typecheck --workspace @motion-levels-games/saltos
```
