# Core, game, and composition boundaries

## Target dependency direction

The repository should have one directed dependency graph:

```text
shared primitives
        ↓
canonical game engine / SDK
        ↓
optional reusable game capabilities
        ↓
concrete games
        ↓
catalog and product composition
        ↓
venue runtime, player applications, playground, release tooling
```

Dependencies must never point upward. In particular:

- the canonical engine does not know that any concrete game exists;
- one game does not import another game;
- reusable packages do not depend on the concrete catalog;
- applications may compose the engine and games;
- deployment code consumes a versioned artifact rather than rebuilding product source.

`architecture-boundaries.json` is deliberately explicit and is checked by
`scripts/validate-architecture.ts`.

## Current exception

`packages/runtime` currently owns both:

1. reusable `GameSession` behavior; and
2. the concrete gameplay/display registries importing every `games/*` package.

That makes `packages/runtime` a composition root despite living under `packages/`.
It is listed in `allowedConcreteGameConsumers` so current CI can become strict
without a flag day. No additional package can acquire the same coupling.

Run:

```sh
npm run validate:architecture
```

to reject new violations, and:

```sh
npm run validate:architecture -- --strict
```

to expose the remaining extraction blocker.

## Recommended extraction

### 1. Introduce a composition package

Create `packages/game-catalog` or `apps/game-catalog` containing:

- gameplay registry;
- display registry;
- catalog ordering and aliases;
- generated concrete-game imports.

It is a product composition package, not part of the engine.

### 2. Inject resolution into `GameSession`

Change reusable session construction from implicit global lookup:

```ts
new GameSession()
```

to an injected resolver:

```ts
new GameSession({ resolveGame })
```

or:

```ts
new GameSession(gameModule)
```

The venue and playground composition roots provide the catalog. Tests can pass
a tiny fake module without loading every game.

### 3. Move concrete dependencies

Move every `@motion-levels-games/<game>` dependency and both registry files out
of `packages/runtime`. Once no concrete dependency remains, remove
`packages/runtime` from `allowedConcreteGameConsumers`.

### 4. Consolidate timing authority

`packages/game-sdk` owns the canonical deterministic engine. `packages/jugar-3d`
currently has a larger session simulation with its own tick/clock lifecycle.
Keep 3D presentation and avatar/controller orchestration in Jugar, but make its
game timing, input, pause, restart, and snapshots delegate to the SDK engine.
There should be one source of truth for game time and input ordering.

### 5. Generate, do not hand-maintain, catalog imports

A script should discover game package manifests and write deterministic registry
modules. CI should run the generator in check mode and fail on a diff. This avoids
three separate hand-maintained catalogs drifting apart.

## Preparing for a future games repository

Each `games/<slug>` package should be extractable with only:

- its own source/tests/assets;
- declared public package dependencies;
- no relative path escaping its package;
- no imports from applications or venue code;
- no dependency on another concrete game.

The current validator enforces the most important parts now, while all packages
remain in one npm workspace.
