# Hello World

Game id: `hello-world`

Hello World is a tiny deterministic example game for CI playtests and new game
authors. It guides a player through a fixed green target path and finishes when
all targets are hit.

## Development

```sh
npm run test --workspace @motion-levels-games/hello-world
npm run typecheck --workspace @motion-levels-games/hello-world
```

Keep `manifest.id` exactly equal to the directory name: `hello-world`.
