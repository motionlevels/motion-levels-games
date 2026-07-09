# Ping Pong

Game id: `ping-pong`

Ping Pong is a two-player rally game for the Motion Levels floor. Players ready
up on opposite halves, then rally a visible ball until one side reaches the
configured target score.

## Speed tuning

The game exposes three shared speed controls in the playground settings:

- `initial_ball_speed`: Easy's starting speed in floor tiles per second.
- `return_speed_multiplier`: multiplicative acceleration after each return.
- `difficulty_multiplier`: one step of the difficulty curve.

These schemas live in `pingPongConfigVars` in `src/manifest.ts`. The SDK fills
defaults and enforces their declared types and bounds before game logic reads
the same descriptors, so values are not re-declared in `game.ts`.

Difficulty does not have separate hidden speed values. Easy uses `1x`, Medium
uses one difficulty step, Hard uses two, and Expert uses three. With the default
step of `1.2`, their factors are `1x`, `1.2x`, `1.44x`, and `1.728x`.
Acceleration scales by the same curve while preserving `1x` as its neutral
point, and every difficulty is capped at 2.5 times its initial speed.

## Development

```sh
npm run test --workspace @motion-levels-games/ping-pong
npm run typecheck --workspace @motion-levels-games/ping-pong
```

Keep `manifest.id` exactly equal to the directory name: `ping-pong`.
