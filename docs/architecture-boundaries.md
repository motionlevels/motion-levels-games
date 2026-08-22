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

## Enforced composition boundary

`packages/runtime` owns reusable, registry-injected `GameSession` behavior and
depends only on `game-sdk`. `packages/game-catalog` is the explicit product
composition root: it imports concrete game packages and owns gameplay and
browser-display registries. Applications inject that catalog into the runtime.

Run:

```sh
npm run validate:architecture
```

to reject new violations. Strict invocations use the same exception-free rules:

```sh
npm run validate:architecture -- --strict
```

The registry parity contract verifies exact coverage of every playable
`games/*` package and rejects identity collisions, so catalog drift fails CI.

## Preparing for a future games repository

Each `games/<slug>` package should be extractable with only:

- its own source/tests/assets;
- declared public package dependencies;
- no relative path escaping its package;
- no imports from applications or venue code;
- no dependency on another concrete game.

The current validator enforces the most important parts now, while all packages
remain in one npm workspace.
