# Production bundle contract

`npm run build:bundle` produces `dist/bundle`, an immutable directory described
by `bundle.json` with schema `motion-levels-games-bundle-v1`.

The manifest records contract version `1`, runner protocol version `1`, the
full source Git revision, the shared 50fps cadence, every file's SHA-256 and
size, and an `artifactDigest` over the canonical sorted file list. Consumers
must recompute both the file list and digest before building or deploying.

The bundle contains:

- `catalog.json`: all game manifests plus deterministic media references;
- `animations.json`: the canonical native TypeScript animation catalog,
  deterministic preview recipe, and media references;
- `player-experience-state.schema.json`: the language-neutral canonical live
  state consumed by both Player Menu and Player Display;
- `runtime/runner.mjs`: the production Node.js JSON-lines runner;
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
rendering catalog previews through a separate engine endpoint. The media
catalog is additive to contract version `1`; consumers that do not yet use it
can continue to ignore the `animations` manifest field.

`playerMenu.adapterProtocolVersion` versions only the menu-to-venue boundary.
Venue consumers must reject an unsupported value before serving the static
menu. Electron, reverse-proxy configuration, the game supervisor, controller
connectivity, physical output, and venue deployment remain consumer-owned.

`npm run validate:games` and the runner registry contract require the IDs under
`games/*` to exactly match `packages/runner/src/registry.ts`. Every registered
module must export both its game factory and player display. The bundle catalog
and its runtime/player-display declarations therefore cannot silently omit a
newly added game package.

Only games with `availability.production: true` may be initialized by the
production runner. Development entries remain in the catalog and media output
so the playground and development environments can inspect the same artifact.

Release tags must exactly match `games-vMAJOR.MINOR.PATCH` without leading
zeroes or prerelease suffixes, and must resolve to the current `origin/main`
commit. The tag workflow runs the complete reusable CI suite before publishing
the deterministic `.tgz` and its SHA-256 through GitHub Releases. Existing
release assets are never overwritten.

After CI succeeds on `main`, the promotion job compares the verified commit to
the latest published tag. Changes to bundle inputs are tagged automatically;
adding, removing, or renaming a game manifest advances the minor version, while
manifest edits and other bundle changes advance the patch version. The job skips
stale CI runs and already published commits, then explicitly dispatches the tag
workflow because tags written with the repository's Actions token do not
recursively start other workflows. Releases are serialized, and a completed
bundle is not sent to consumers if a newer `main` commit changed its inputs.
Platform and venue notification run as independent retryable jobs, so one
consumer cannot mask or force a rebuild for a failure in the other. Manual tag
and workflow dispatch remain available as recovery paths.

After publication, the release workflow sends the release tag and full source
revision as inputs to the `sync-games-bundle.yml` workflow in both
`motion-levels-platform` and `motion-levels-venue`. Each consumer downloads the
exact private release assets and independently verifies both the archive
SHA-256 and the bundle's canonical artifact digest before updating its own pin.

The games repository uses separate, narrowly scoped dispatch secrets:

- `PLATFORM_SYNC_TOKEN`: Actions write access only on
  `motionlevels/motion-levels-platform`;
- `VENUE_SYNC_TOKEN`: Actions write access only on
  `motionlevels/motion-levels-venue`.

Neither dispatch token needs Contents write access on its target repository.
The release fails closed before publication when either secret is absent. Each
consumer repository also provides its own `GAMES_REPO_TOKEN` with Contents read
access to `motionlevels/motion-levels-games` so its sync workflow can download
the private release assets.

Normal CI also uploads the bundle as a revision-named workflow artifact for
diagnostics. Workflow artifacts are not production release inputs.

The runtime entry is bundled for Node.js 20, matching the Debian 13 venue
package. Consumers must provide Node.js 20 or newer.
