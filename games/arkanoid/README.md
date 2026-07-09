# Arkanoid

Game id: `arkanoid`

Single-player floor Arkanoid for Motion Levels.

## Gameplay

- Step anywhere in the lower eight rows to center the paddle under that column.
- The first step launches the ball; subsequent steps move the paddle.
- Break all 32 blocks to win.
- Missing the ball costs one of three lives. Step in the control zone again to relaunch.
- Easy, Medium, Hard, and Expert change only ball speed.

The game is deterministic for a given seed and uses the shared 30fps engine.

## Development

```sh
npm run test --workspace @motion-levels-games/arkanoid
npm run typecheck --workspace @motion-levels-games/arkanoid
```

Keep `manifest.id` exactly equal to the directory name: `arkanoid`.
