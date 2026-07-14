# El suelo es lava

TypeScript-engine successor to Motion Go `authored-lava`.

The group readies in the central blue zone, then claims moving green platforms
while avoiding the animated red lava. Lava costs one of three shared lives with
a one-second recovery window. Surviving the full minute wins; zero lives loses.
Difficulty changes platform size, speed, and spawn pressure. The shared board
supports `0 / Any` for groups while preserving physical readiness.

```sh
npm run test --workspace @motion-levels-games/lava
npm run typecheck --workspace @motion-levels-games/lava
```
