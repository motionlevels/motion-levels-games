# Memoria v2

TypeScript-engine successor to Motion Go `authored-memoria-v2`.

The group receives five seconds to memorize a blue figure, then reconstructs it
after it disappears. Each level has three lives. Completing a figure triggers a
short yellow round celebration before the next, denser pattern; level 20 ends
with a distinct five-second green game celebration.

The shared board is independent of booking size, so `0 / Any` is supported for
groups while one real player must occupy the central readiness zone.

```sh
npm run test --workspace @motion-levels-games/memoria-v2
npm run typecheck --workspace @motion-levels-games/memoria-v2
```
