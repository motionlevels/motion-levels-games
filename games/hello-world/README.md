# Hola Mundo

Game id: `hello-world`

Hola Mundo is a compact deterministic example game for CI playtests and new
game authors. It guides a player through a fixed green target path while one
red hazard is visible at a time. Green targets add progress; stepping on the
red tile removes it, costs one of three lives, and reveals the next
deterministic hazard.

Player selection supports `0 / Any` or `1`; the board is identical for groups
taking turns.

The game first shows the shared waiting animation. It detects one player
anywhere on the floor, keeps that player present through the two-second start
animation, and only then reveals the first target and starts its timer. This is
the reference lifecycle generated for new games.

Completing all five green targets wins the game. Losing all three lives or
running out of time loses it. Win and loss each run a distinct five-second
animation on the floor and player display, ignore further scoring input, and
then restart at the normal player-ready waiting phase.

## Development

```sh
npm run test --workspace @motion-levels-games/hello-world
npm run typecheck --workspace @motion-levels-games/hello-world
```

Keep `manifest.id` exactly equal to the directory name: `hello-world`.
