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

Only games with `availability.production: true` may be initialized by the
production runner. Development entries remain in the catalog and media output
so the playground and development environments can inspect the same artifact.

Tagged releases matching `games-v*` publish a deterministic `.tgz` and its
SHA-256 through GitHub Releases. Normal CI uploads the same bundle as a
revision-named workflow artifact.

The runtime entry is bundled for Node.js 20, matching the Debian 13 venue
package. Consumers must provide Node.js 20 or newer.
