# Motion Levels Games

TypeScript-first Motion Levels game packages, production venue runtime, player
menu, player displays, and local playground. Game logic runs directly
in-process in Node; the venue keeps its controller and supervisor in Go.

## Quickstart

The repository standardizes local development, CI, and production tooling on
Node.js 24.17.0 with npm 11.13.0. Version managers should read
[`.node-version`](.node-version); npm rejects other Node major versions.

```sh
npm install
npm run check:fast
npm run check
npm run dev
```

`npm run dev` starts the production-shaped local venue at
`http://127.0.0.1:4104/`: the playground, TypeScript venue runtime, embedded
player menu, and a revision-matched mock controller run together. The runtime
API remains available at `http://127.0.0.1:4102`. `npm run
dev:venue:no-controller` is a compatibility alias for the same command, while
`npm run dev:venue` connects to a real controller. The developer toolbar at
that single browser origin switches explicitly between `Venue`, which is a
façade over the canonical runtime, and `Sandbox`, which uses the isolated
deterministic browser session. Display, menu, floor, and agent choices remain
separate presentation controls rather than changing the state owner.
Sandbox never sends controls, input, or audio to the canonical venue; returning
to Venue resynchronizes its latest snapshot. This isolation also means a
Sandbox or recording tab cannot interrupt another tab using Venue.

Use Sandbox on `4104` for normal deterministic authoring, prepared scenarios,
and media generation. A `?recordScenario=<id>` URL selects Sandbox
automatically. Keep `npm run dev:standalone` for isolated automation or
debugging when the venue process is deliberately absent; it omits the venue
runtime and kiosk menu, so it cannot validate production lifecycle behavior.
Use `--api-only` with the venue script when only the API is needed.
`npm run test:dev:venue` starts the default environment and verifies the
playground root, player-menu entry point, proxied health endpoint, and direct
venue API before shutting it down. Its playground, API, and mock-controller
ports can be isolated with `MOTION_LEVELS_DEV_VENUE_PORT`,
`MOTION_LEVELS_DEV_VENUE_API_PORT`, and
`MOTION_LEVELS_DEV_VENUE_CONTROLLER_PORT`.
`npm run check:fast` runs the native linter and strict workspace typechecks for
the normal edit loop. `npm run check` adds all tests, validation, builds, the
scaffold smoke test, and deterministic game playtests before a commit or push.
See [`docs/testing.md`](docs/testing.md) for the contract, coverage, and CI
layers.

## Workspace

- `packages/game-sdk`: framework-agnostic TypeScript game contract.
- `packages/display-kit`: reusable React display primitives.
- `packages/runtime`: reusable, registry-injected `GameSession` and no concrete games.
- `packages/game-catalog`: explicit gameplay and browser-display composition.
- `games/*`: independently tested game packages discovered through their
  manifests and index exports.
- `apps/venue-runtime`: Node production host and controller protocol v2 client.
- `apps/player-menu`: release-matched kiosk menu.
- `apps/player-display`: release-matched player-facing TV shell that loads the
  bundle's exact game display renderer.
- `apps/playground`: local app that runs the player menu, game, floor, display,
  event log, and snapshot inspector together.

## Repository-owned authored content

Production-playable editor-authored games are versioned here:

```text
games/<engine-game>/content/game.json
games/<engine-game>/content/levels/<stable-level-id>.json
content/result-animations/<stable-animation-id>.json
```

Parkour currently has 15 real published variants under
[`games/parkour/content/`](games/parkour/content/); Temporada 1 has 96 real
difficulty variants under
[`games/temporada1-niveles/content/`](games/temporada1-niveles/content/).
Each level is a focused JSON diff and retains its immutable identity; slugs
and labels remain editable presentation fields. Shared result animations live
once at repository root and each `game.json` lists its `resultAnimationIds`.
Media files such as previews, thumbnails, and audio remain in the assets
repository; authored levels contain stable references only.

Run the deterministic compiler and validation with:

```sh
npm run content:build
npm run content:format
npm run content:validate
```

The compiler normalizes ordering, validates the versioned contract, frames,
rules, references, objectives, and result animations, then writes the runtime
artifact to `dist/authored-content/`. The release compiler copies those files
into `content/` in the immutable bundle and records each `contentRevision` in
`bundle.json`. `content:format` is an optional source formatter that keeps
large cell tuples to one reviewable line.

`contentRevision`, `content.lock.json`, and `src/content.generated.ts` are
compiler-owned outputs. The lock and TypeScript module are ignored by Git and
are recreated by `npm ci` plus the root build, typecheck, test, and development
commands. A content PR therefore contains authored JSON only; neither the
platform nor a contributor calculates a revision or commits generated files.

The platform editor is a draft tool. **Create content PR** exports `game.json`,
the game's level files, and referenced shared result-animation sources. It
creates a `content/` branch and opens one focused PR against
`motion-levels-games:main`; it never overwrites production or pushes editor
data directly to `main`. Configure the platform-side GitHub App/service token
as `MOTION_LEVELS_GAMES_PUBLISH_TOKEN` (or
`GAMES_CONTENT_PUBLISH_TOKEN`) and optionally set
`MOTION_LEVELS_GAMES_REPOSITORY=motionlevels/motion-levels-games`.

To edit without the platform, modify one source JSON, run the content commands,
then run the normal tests and bundle checks. With the platform stopped or
blocked, the venue still loads Parkour and Temporada 1 from the local bundle.
Rollback means selecting an earlier immutable games release whose bundle
manifest names the desired source and content revisions.
