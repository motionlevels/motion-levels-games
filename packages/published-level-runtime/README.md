# Published level runtime

Deterministic TypeScript authority for platform-authored 16×32 level games.
The platform editor remains the source of truth: a host fetches the current
published document and passes it through `GameConfig.content`. The engine does
no network I/O and never contains a copied production catalog.

## Content boundary

Content uses `motion-levels-published-level-content-v1` and carries:

- `gameId`: immutable canonical platform UUID or lowercase 32/40/64-character
  content-addressed identifier;
- `engineGame`: a non-empty mutable dispatch/diagnostic alias;
- `contentRevision`: deterministic lowercase hexadecimal hash of the selected
  published content. Production platform payloads use the complete 64-character
  SHA-256 revision; deterministic 16-character hashes are reserved for offline
  fixtures. The generic boundary accepts 16–64 characters without rewriting a
  supplied value;
- `selectedLevelId`: immutable platform level-row UUID/hash, paired with the mutable
  `selectedLevelSlug` used for labels/routes;
- selected mode, visible levels (each with UUID/hash plus slug), audio references,
  and filtered result animations.

`parsePublishedLevelContent` validates the complete nested payload, requires
the canonical stable game ID, accepts a non-empty mutable `engineGame` even
after a transparent rename, rejects duplicate canonical level IDs, applies resource
limits, strips irrelevant platform fields, and deep-freezes the result. An
explicit malformed document fails loudly. Offline fallback content is used
only when the host supplies no content.

For one migration window, an old slug in `selectedLevelId` is resolved only
when exactly one supplied level owns it. The normalized document and every
snapshot immediately use the canonical UUID/hash. Snapshots also expose the
diagnostic `engineGame` alias and exact `contentRevision` so run telemetry can
prove which live editor revision was played without treating either as identity.

## Runtime behavior

`createPublishedLevelGame` preserves the existing `niveles` rules: the
three-second green-platform load, authored frame timing and difficulty speed,
challenge/free modes, blue and purple objectives, connected blue capture,
red-tile damage cooldown, lives, green transitions/ripples, result animations,
automatic next-level countdown, and immediate failed-level retry after its
three-second result.

The shared Spanish `PublishedLevelPlayerDisplay` and semantic
`createPublishedLevelSessionController` are reusable product adapters. The 3D
controller reserves objectives across bots, plans deterministic hazard-aware
paths, and jumps moving danger or held purple objectives while observing the
same supplied game instance. Its exported factory, controller, observation,
avatar, action, and result types are structurally compatible with Jugar 3D but
depend only on `game-sdk`; the gameplay runtime has no renderer/UI dependency.
