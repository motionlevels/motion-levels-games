# Character runtime

Framework-independent character presentation contracts for Motion Levels.
The package owns the canonical rig vocabulary, visual cast metadata, animation
graph, interpolation, procedural signalling, GLB inspection, quality tiers,
and performance measurements. It does not own game rules or authoritative
movement.

`motion-athlete-v1` is the canonical procedural humanoid rig. Explorer,
Runner, Trickster, and Guardian are visual variants of that one rig, not
separate skeletons. The included Sahur model remains an audited interim asset:
it is commercially usable under CC-BY 4.0 but has only one walk clip and needs
retargeting before it can satisfy the full shared animation library.

The runtime also includes ten optimized CC0 Quaternius characters on a shared
62-bone humanoid rig. Every character carries the same 24 authored clips,
including neutral idle, walk, run, roll, interaction, hit, wave, and death.
Palette materials avoid texture downloads; meshopt compression keeps the whole
collection near 7.4 MB while preserving geometry, armatures, and animation.

All 29 graph states have deterministic action, movement, gesture, event, or
emotion inputs. Animation channels retain the outgoing clip and elapsed time
while exposing explicit previous/current weights, including optional-layer
fade-in and fade-out, so renderers can apply genuine cross-fades.

Run the asset and state-machine checks with:

```sh
npm run validate:characters
npm test --workspace @motion-levels-games/character-runtime
```

The repository validator checks embedded texture codecs and dimensions plus
scene, scale, skin, and hierarchy metadata. Canonical imported GLBs must cover
all canonical animation names; Sahur's incomplete Mixamo clip set and FBX scale
nodes are explicit, documented `interim` exceptions rather than canonical
precedent. See `docs/character-asset-pipeline.md` for the exact pinned,
non-destructive optimization command.
