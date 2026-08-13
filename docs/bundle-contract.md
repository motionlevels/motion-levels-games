# Production bundle contract v2

`npm run build:bundle` produces `dist/bundle`, an immutable directory described
by `bundle.json` with schema `motion-levels-games-bundle-v2` and contract
version `2`. Consumers recompute the sorted file list, every SHA-256, and the
canonical `artifactDigest` before install.

The required production entries are:

- `venueRuntime: { entry: "venue/runtime.mjs", apiProtocolVersion: 1,
  controllerProtocolVersion: 2, games: [...] }`;
- `playerMenu: { entry: "menu/index.html", adapterProtocolVersion: 2 }`;
- `playerDisplay: { entry: "display/display.js", games: [...] }`;
- `playground: { entry: "playground/index.html", basePath: "/games/play/" }`.

- `catalog.json`: all game manifests plus deterministic media references;
- `animations.json`: the canonical native TypeScript animation catalog,
  deterministic preview recipe, and media references;
- `player-experience-state.schema.json`: the language-neutral canonical live
  state consumed by both Player Menu and Player Display;
- `venue/runtime.mjs`: the in-process TypeScript gameplay runtime and venue API;
- `display/display.js`: the revision-matched browser player-display registry;
- `menu/`: the revision-matched static player menu, including its production
  entry point declared as `playerMenu.entry`;
- `playground/`: the complete hosted menu-to-display playground, built for the
  canonical `/games/play/` path and declared as `playground.entry`;
- `media/<game>/`: small/full thumbnails, animated WebP previews,
  player-display captures, and generation metadata.
- `media/animations/<animation>/`: small/full floor thumbnails, animated WebP
  previews, and generation metadata for every native animation.

The animation runtime owns the IDs, labels, preview recipe, filenames, and
bundle-relative media references. Platform and venue consumers should read
`animations.json` rather than duplicating the TypeScript animation library or
rendering catalog previews through a separate engine endpoint. The menu,
playground, display, animation catalog, and gameplay runtime are mandatory and
revision-matched. There is no legacy JSON-lines process protocol entry.

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
