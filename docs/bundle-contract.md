# Production bundle contract v2

`npm run build:bundle` produces `dist/bundle`, an immutable directory described
by `bundle.json` with schema `motion-levels-games-bundle-v2` and contract
version `2`. Consumers recompute the sorted file list, every SHA-256, and the
canonical `artifactDigest` before install.

The required production entries are:

- `venueRuntime: { entry: "venue/runtime.mjs", apiProtocolVersion: 1,
  controllerProtocolVersion: 2, games: [...] }`;
- `playerMenu: { entry: "menu/index.html", adapterProtocolVersion: 1 }`;
- `playerDisplay: { entry: "display/display.js", games: [...] }`.

The bundle also contains `catalog.json`, the complete static `menu/`, and
deterministic `media/<game>/` assets. The menu and player display are mandatory
and revision-matched to the runtime. There is no legacy process protocol entry.

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
