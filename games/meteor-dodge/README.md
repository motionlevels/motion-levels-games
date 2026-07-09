# Lluvia de meteoritos

Game id: `meteor-dodge`

Lluvia de meteoritos is a cooperative survival game for the Motion Levels
floor. The group shares three lives and wins by staying out of every warned
impact zone until the storm timer reaches zero.

## Gameplay

- Step into the central blue zone and remain there through the shared start
  countdown.
- Move away from each pulsing red square before its yellow center turns into
  an impact.
- Every safely avoided meteor adds one to the shared score.
- A direct impact removes one shared life. A one-second recovery window keeps
  overlapping impacts from removing several lives at once.
- Survive the full 45-second storm to trigger the three-second victory
  celebration. Losing all three lives ends the run immediately.

The board and rules do not depend on booking size, so the manifest offers Any
or one player while still requiring real presence in the central start zone.
Groups can freely cooperate and take turns without changing the configuration.

## Difficulty

Easy, Medium, Hard, and Expert adjust meteor warning time, spawn frequency,
and blast radius. All meteor positions use the SDK seeded RNG, making a given
seed and input sequence deterministic.

## Development

```sh
npm run test --workspace @motion-levels-games/meteor-dodge
npm run typecheck --workspace @motion-levels-games/meteor-dodge
```

Keep `manifest.id` exactly equal to the directory name: `meteor-dodge`.
