# Motion Levels Games

TypeScript-first Motion Levels game packages, production venue runtime, player
menu, player displays, and local playground. Game logic runs directly
in-process in Node; the venue keeps its controller and supervisor in Go.

## Quickstart

```sh
npm install
npm run check:fast
npm run check
npm run dev
```

`npm run dev` starts the complete menu-to-game playground at
`http://127.0.0.1:4104` using one Vite service.
`npm run check:fast` runs the native linter and strict workspace typechecks for
the normal edit loop. `npm run check` adds all tests, validation, builds, the
scaffold smoke test, and deterministic game playtests before a commit or push.
See [`docs/testing.md`](docs/testing.md) for the contract, coverage, and CI
layers.

## Workspace

- `packages/game-sdk`: framework-agnostic TypeScript game contract.
- `packages/display-kit`: reusable React display primitives.
- `packages/runtime`: direct `GameSession`, gameplay registry, and separate
  browser display registry.
- `games/*`: independently tested game packages discovered through their
  manifests and index exports.
- `apps/venue-runtime`: Node production host and controller protocol v2 client.
- `apps/player-menu`: release-matched kiosk menu.
- `apps/player-display`: release-matched player-facing TV shell that loads the
  bundle's exact game display renderer.
- `apps/playground`: local app that runs the player menu, game, floor, display,
  event log, and snapshot inspector together.
