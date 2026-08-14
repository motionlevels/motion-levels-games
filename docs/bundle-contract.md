# Production bundle contract v2

`npm run build:bundle` produces `dist/bundle`, an immutable directory described
by `bundle.json` with schema `motion-levels-games-bundle-v2` and contract
version `2`. Consumers recompute the sorted file list, every SHA-256, and the
canonical `artifactDigest` before install.

The required production entries are:

- `venueRuntime: { entry: "venue/runtime.mjs", apiProtocolVersion: 1,
  controllerProtocolVersion: 2, games: [...] }`;
- `playerMenu: { entry: "menu/index.html", buildManifest: "menu/build.json",
  adapterProtocolVersion: 2 }`;
- `playerDisplay: { entry: "display/display.js", shellEntry:
  "display/index.html", games: [...] }`;
- `playground: { entry: "playground/index.html", basePath: "/games/play/" }`.

- `catalog.json`: all game manifests plus deterministic media references;
- `animations.json`: the canonical native TypeScript animation catalog,
  deterministic preview recipe, and media references;
- `player-experience-state.schema.json`: the language-neutral canonical live
  state consumed by both Player Menu and Player Display;
- `venue/runtime.mjs`: the in-process TypeScript gameplay runtime and venue API;
- `display/index.html` and its static assets: the complete production TV shell,
  declared as `playerDisplay.shellEntry`;
- `display/display.js`: the revision-matched browser player-display registry,
  declared as `playerDisplay.entry` and loaded by the shell;
- `menu/`: the revision-matched static player menu, including its production
  entry point and human-readable `build.json`; both the manifest and compiled
  JavaScript declare the bundle's full `sourceRevision`;
- `playground/`: the complete hosted menu-to-display playground, built for the
  canonical `/games/play/` path and declared as `playground.entry`;
- `media/<game>/`: small/full thumbnails, animated WebP previews,
  player-display captures, and generation metadata.
- `media/animations/<animation>/`: small/full floor thumbnails, animated WebP
  previews, and generation metadata for every native animation.

The player-display shell, renderer, menu, and venue runtime are built from this
repository and shipped in one release. Venue consumers package and serve these
files but do not keep fallback source builds.

`packages/game-sdk/src/media.ts` owns the media dimensions, filename suffixes,
bundle-relative references, and URL resolution for both games and native
animations. The five game surfaces are fixed at 256x128 (`thumbnailSmall`),
1024x512 (`thumbnail`), 512x256 (`animation`), 1280x720 (`playerDisplay`), and
640x360 (`playerDisplayAnimation`). `mediaReferenceURL` and the game/animation
URL helpers receive the bundle root URL explicitly; consumers alone resolve an
app path such as `menu/` or `playground/` back to that root.

The animation runtime owns the animation IDs, labels, and deterministic preview
recipe while reusing that SDK media contract. Platform and venue consumers
should read `catalog.json` and `animations.json` rather than duplicating either
TypeScript registry or rendering catalog previews through a separate endpoint.
The menu, playground, display, animation catalog, and gameplay runtime are
mandatory and revision-matched. There is no legacy JSON-lines process protocol
entry. `npm run verify:bundle` validates every catalog reference, metadata file,
content digest, actual WebP dimension, and animated-frame chunk before release.

`venueRuntime.games` and `playerDisplay.games` contain only manifests with
`availability.production: true`. Development games remain in the catalog and
media for inspection, but the production `GameSession` rejects them.
`npm run validate:games` requires the directories under `games/*` to match
`packages/runtime/src/gameplayRegistry.ts`; a separate browser display registry
keeps React out of the Node gameplay graph.

Release tags exactly match `games-vMAJOR.MINOR.PATCH`. Contract v2 must be
published on major 2 or newer; automation promotes a v1 release directly to
`games-v2.0.0` before using the normal manifest-minor/content-patch policy.
Release assets are immutable and both platform and venue consume the exact
archive and revision that passed CI.

The runtime entry targets Node.js 20. See `docs/venue-runtime.md` for its HTTP
and controller contracts and for deliberate legacy feature removals.
