# Authored level runtime

Deterministic TypeScript runtime for repository-owned 16×32 authored games.
`motion-levels-games` is the production source of truth. The platform remains
the visual editor and draft database; it exports a versioned content contract
and opens a focused GitHub content PR. The venue loads the immutable games
bundle and never fetches gameplay content from the platform.

## Contract

Content uses `motion-levels-published-level-content-v1` and carries:

- `gameId`: immutable canonical UUID or lowercase 32/40/64-character hash;
- `engineGame`: mutable dispatch/diagnostic slug;
- `contentRevision`: deterministic SHA-256 of the canonical game manifest,
  normalized level records, and result-animation records. Selection state is
  excluded, so every difficulty/session points at one authored revision;
- `selectedLevelId`: immutable level UUID/hash, paired with mutable
  `selectedLevelSlug` for labels/routes;
- frames, rules, difficulty settings, audio references, objectives, and result
  animation references.

`parsePublishedLevelContent` validates the nested payload, requires stable
identities, rejects duplicate level IDs, validates 16×32 cells and frame
timings, applies resource limits, strips platform-only fields, and deep-freezes
the result. The engine performs no network I/O and is the only timing/input
authority.

The concrete Parkour and Temporada catalogs do not live in this reusable
package. They are committed as one diffable source file per level under
`games/parkour/content/` and `games/temporada1-niveles/content/`.

## Runtime behavior

`createPublishedLevelGame` preserves the authored frame timing, difficulty
settings, blue and purple objectives, red-tile damage, lives, level transitions,
result animations, and the shared deterministic `game-sdk` engine. The shared
Spanish player display and session controller are reusable adapters; concrete
game catalogs remain outside this package.
