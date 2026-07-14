# Patrones

TypeScript-engine successor to Motion Go `authored-patrones`.

After one player readies in the central zone, the floor reveals a blue pattern.
The group reconstructs it by stepping on every blue tile once. A wrong tile or
the 45-second timeout ends the attempt; completing the full pattern triggers a
five-second floor and player-display celebration.

Easy, Medium, and Hard use increasingly dense patterns. The layout is independent
of booking size, so `0 / Any` is supported while physical readiness is retained.

```sh
npm run test --workspace @motion-levels-games/patrones
npm run typecheck --workspace @motion-levels-games/patrones
```
