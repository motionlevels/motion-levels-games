# Production bundle contract

`npm run build:bundle` produces `dist/bundle`, an immutable directory described
by `bundle.json` with schema `motion-levels-games-bundle-v1`.

The manifest records contract version `1`, runner protocol version `1`, the
full source Git revision, the shared 50fps cadence, every file's SHA-256 and
size, and an `artifactDigest` over the canonical sorted file list. Consumers
must recompute both the file list and digest before building or deploying.

The bundle contains:

- `catalog.json`: all game manifests plus deterministic media references;
- `runtime/runner.mjs`: the production Node.js JSON-lines runner;
- `display/display.js`: the revision-matched browser player-display registry;
- `media/<game>/`: small/full thumbnails, animated WebP previews,
  player-display captures, and generation metadata.

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

After publication, the release workflow sends the release tag and full source
revision as inputs to the platform's `sync-games-bundle.yml` workflow dispatch.
The consumer downloads these exact private release assets
and independently verifies both the archive SHA-256 and the bundle's canonical
artifact digest before updating its pin. `PLATFORM_SYNC_TOKEN` must be a
narrowly scoped secret with Actions write access only on the platform
repository; it does not need platform Contents write access. The release fails
closed when it is absent.

Normal CI also uploads the bundle as a revision-named workflow artifact for
diagnostics. Workflow artifacts are not production release inputs.

The runtime entry is bundled for Node.js 20, matching the Debian 13 venue
package. Consumers must provide Node.js 20 or newer.
