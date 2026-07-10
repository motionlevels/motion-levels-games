# Motion Levels Games

TypeScript-first Motion Levels game packages and a local playground. This repo
proves that a game can own its gameplay logic, player display, fixtures, and
local test surface without depending on the platform, Postgres, venue hardware,
Motion Go, TinyGo, or deploy steps.

## Quickstart

```sh
npm install
npm run check:fast
npm run check
npm run dev
```

`npm run dev` starts the playground at the Vite URL printed in the terminal.
`npm run check:fast` runs the native linter and strict workspace typechecks for
the normal edit loop. `npm run check` adds all tests, validation, builds, the
scaffold smoke test, and deterministic game playtests before a commit or push.
See [`docs/testing.md`](docs/testing.md) for the contract, coverage, and CI
layers.

## Workspace

- `packages/game-sdk`: framework-agnostic TypeScript game contract.
- `packages/display-kit`: reusable React display primitives.
- `games/*`: independently tested game packages discovered through their
  manifests and index exports.
- `apps/playground`: local app that runs the game, floor, display, event log,
  and snapshot inspector together.

## v1 Boundary

This is intentionally a proof-of-strategy repo. Production `motion-levels`
integration should happen later by consuming built game packages, manifests, or
an exported catalog from this repo.
