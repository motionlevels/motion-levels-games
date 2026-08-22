# Production bundle contract v2

`npm run build:bundle` produces `dist/bundle`, an immutable directory described
by `bundle.json` with schema `motion-levels-games-bundle-v2` and contract
version `2`. Consumers recompute the sorted file list, every SHA-256, and the
canonical `artifactDigest` before install.

The manifest keeps two distinct forms of build identity. `sourceRevision` is
always the full 40-character Git SHA used by the runtime, catalog, and asset
matching contracts. `buildVersion` is the compact player-facing label shared
by the menu, display shell, and hosted playground. When the source revision has
a canonical exact tag `games-vMAJOR.MINOR.PATCH`, the visible value is
`vMAJOR.MINOR.PATCH` and `releaseTag` records the original tag. Otherwise
`buildVersion` is exactly the first six characters of `sourceRevision` and
`releaseTag` is `null`.

`MOTION_LEVELS_GAMES_RELEASE_TAG` is the explicit build-time override for a
planned immutable release tag. It must use the canonical tag format and takes
precedence over repository tags. Without that override, the builder considers
only canonical tags pointing exactly at `sourceRevision`; if several exist,
the highest version-sorted tag wins. The compact label never replaces or
weakens the full-SHA contracts. The main release gate resolves this label
before building its verified artifact, while tag creation remains a later
promotion step.

The required production entries are:

- `venueRuntime: { entry: "venue/runtime.mjs", apiProtocolVersion: 1,
  controllerProtocolVersion: 2, games: [...] }`;
- `playerMenu: { entry: "menu/index.html", buildManifest: "menu/build.json",
  adapterProtocolVersion: 2 }`;
- `playerDisplay: { entry: "display/display.js", styleEntry:
  "display/display.css", shellEntry: "display/index.html", buildManifest:
  "display/build.json", games: [...] }`;
- `playground: { entry: "playground/index.html", basePath: "/games/play/" }`.

- `catalog.json`: all game manifests plus deterministic media references;
- `animations.json`: the canonical native TypeScript animation catalog,
  deterministic preview recipe, and media references;
- `player-experience-state.schema.json`: the language-neutral canonical live
  state consumed by both Player Menu and Player Display;
- `venue/runtime.mjs`: the in-process TypeScript gameplay runtime and venue API;
- `display/index.html`, `display/build.json`, and the shell's static assets: the
  complete production TV shell and its full source revision, declared as
  `playerDisplay.shellEntry` and `playerDisplay.buildManifest`; `build.json`
  also mirrors the bundle's `buildVersion` and `releaseTag`;
- `display/display.js`: the revision-matched browser player-display registry,
  declared as `playerDisplay.entry` and loaded by the shell. During the
  contract-v2 migration it also carries a generated copy of the compiled CSS
  so older shells that only load this entry remain styled;
- `display/display.css`: the revision-matched shared and game-owned player-display
  styles, declared as `playerDisplay.styleEntry` and loaded atomically with the
  renderer by the shell;
- `menu/`: the revision-matched static player menu, including its production
  entry point and human-readable `build.json`; both the manifest and compiled
  JavaScript declare the bundle's full `sourceRevision`, while `build.json`
  also mirrors the bundle's `buildVersion` and `releaseTag`;
- `playground/`: the complete hosted menu-to-display playground, built for the
  canonical `/games/play/` path and declared as `playground.entry`;
- `media/<game>/`: small/full thumbnails, animated WebP previews,
  player-display captures, and generation metadata.
- `media/animations/<animation>/`: small/full floor thumbnails, WebP previews,
  and generation metadata for every native animation. Catalog entries declare
  `animated`; deliberately static entries use a one-frame WebP while animated
  entries must retain multiple encoded frames.

The player-display shell, renderer, menu, and venue runtime are built from this
repository and shipped in one release. The shell reports its compiled revision,
loads revision-matched renderer CSS and JavaScript as one guarded transaction,
and replaces the active stylesheet only after the candidate renderer is ready.
It prefers `display.css`; if that asset is absent in a historical contract-v2
bundle, it accepts the renderer's matching legacy embedded style. A monotonic
load generation prevents superseded revisions from activating stale CSS or
replacing the accepted runtime. The generated CSS copy in `display.js` is a
contract-v2 compatibility bridge, not a second authored stylesheet: shared and
game-owned CSS remain source-owned by display-kit and each game respectively.
The shell reloads once when a newer runtime revision is ready and gameplay is
not active. Venue consumers package and serve these files but do not keep
fallback source builds.

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
content digest, actual WebP dimension, animated-frame chunk, and the shared
build identity compiled into the player menu and display shell before release.

`venueRuntime.games` and `playerDisplay.games` contain only manifests with
`availability.production: true`. Development games remain in the catalog and
media for inspection, but the production `GameSession` rejects them.
`npm run validate:games` requires the directories under `games/*` to match
`packages/runtime/src/gameplayRegistry.ts`; a separate browser display registry
keeps React out of the Node gameplay graph.

Release tags exactly match `games-vMAJOR.MINOR.PATCH`. Contract v2 must be
published on major 2 or newer; automation promotes a v1 release directly to
`games-v2.0.0` before using the normal manifest-minor/content-patch policy.
Release assets are immutable. The platform sync consumes the exact archive and
revision that passed CI. Venue releases are source-first: the venue repository
pins this repository by full revision in `venue-components.lock.json` and builds
the verified bundle locally from that clean source checkout. The separate
release workflow is manual recovery for an existing tag; tag creation does not
start a second copy of the release gate already completed by main CI.

The runtime entry targets Node.js 24. See `docs/venue-runtime.md` for its HTTP
and controller contracts and for deliberate legacy feature removals.
