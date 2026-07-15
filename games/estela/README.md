# Estela

Competitive light-trail survival for exactly 2–8 players. Roster size matters: every configured player receives an individual perimeter readiness zone, color, live position, trail, and score card, so `0 / Any` is intentionally unavailable.

Every new floor tile extends the nearest active player’s permanent trail. Touching any trail or the contracting red boundary eliminates that player for the round. The last survivor wins; the first player to win two rounds wins the match. Round-win and match-win states have separate timed floor and TV celebrations and reject gameplay input.

```sh
npm run test --workspace @motion-levels-games/estela
npm run typecheck --workspace @motion-levels-games/estela
```
