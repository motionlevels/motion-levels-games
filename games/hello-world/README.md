# Hello World

Game id: `hello-world`

Hello World is a tiny deterministic example game for CI playtests and new game
authors. It guides a player through a fixed green target path and finishes when
all targets are hit.

The game first shows the shared waiting animation. It detects one player
anywhere on the floor, keeps that player present through the two-second start
animation, and only then reveals the first target and starts its timer. This is
the reference lifecycle generated for new games.

## Development

```sh
npm run test --workspace @motion-levels-games/hello-world
npm run typecheck --workspace @motion-levels-games/hello-world
```

Keep `manifest.id` exactly equal to the directory name: `hello-world`.
