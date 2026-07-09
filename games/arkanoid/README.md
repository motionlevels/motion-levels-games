# Arkanoid

Game id: `arkanoid`

Single-player floor Arkanoid for Motion Levels.

## Gameplay

- Step into the illuminated lower eight rows to register the player and center
  the paddle under that column.
- Remain there through the two-second start animation; the ball launches when
  the countdown completes. Subsequent steps move the paddle.
- Break all 32 blocks to win.
- Missing the ball costs one of three lives. Step in the control zone again to relaunch.
- Easy, Medium, Hard, and Expert change only ball speed.

The game is deterministic for a given seed and uses the shared 30fps engine.
Leaving the control zone during the pre-start grace window cancels the
countdown and returns the game to its waiting animation.

## Development

```sh
npm run test --workspace @motion-levels-games/arkanoid
npm run typecheck --workspace @motion-levels-games/arkanoid
```

Keep `manifest.id` exactly equal to the directory name: `arkanoid`.
