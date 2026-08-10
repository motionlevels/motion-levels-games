# Motion Athlete character and animation pipeline

Status: canonical v1, approved 2026-08-10.

## Art direction

Motion Athlete is a stylised, toy-like digital athlete: large helmet/head,
clear hands and feet, simple LED face, emissive team band, two readable
materials, and attachments that remain legible from the preview camera. The
four initial identities are Explorer, Runner, Trickster, and Guardian. They
share one skeleton and differ through palette, shoulder/antenna/backpack/heel
attachments, never through a private rig.

This procedural cast is canonical. Sahur remains an optional, credited interim
skin and is not the reference skeleton because it has only one walk animation.

## `motion-athlete-v1` export contract

- bind pose: A-pose;
- units: metres; target character height 1.55 m;
- +Y up, +Z forward;
- root transform at (0, 0, 0), feet seated at Y=0;
- exactly one canonical skeleton per character;
- 20 required semantic bones from `canonicalRig` in
  `@motion-levels-games/character-runtime`;
- one or two materials per character;
- textures packed into a 1K-or-smaller atlas;
- GLB output, with deterministic clip names from `minimumAnimationLibrary`;
- locomotion is in-place: remove root/hips X/Z translation curves while
  preserving vertical jump/root pose only as visual animation;
- mesh and skeleton scale must remain 1 after export.

Variant-specific attachments are parented to canonical bones. They must not
insert bones, rename bones, or change hierarchy.

## Minimum clip set

The runtime declares 29 locomotion, action, social, and feedback states:

- locomotion: neutral/alert idle, walk, run, both strafes, both turns, pivot,
  stop/recover;
- action: jump anticipation/airborne, light/heavy landing, dodge, collect,
  interact, hit, fall, revive;
- social/feedback: point, wave, small/large/team celebration,
  disappointment, fear, confusion, and restrained taunt.

`character-runtime` defines and tests this deterministic vocabulary and graph,
but the former prototype Motion Athlete renderer has been removed in favour of
the shared deployed Jugar 3D Stage. The current product Stage exposes its
smaller Robot/Sahur movement, jump, celebration, and defeat pose set; it does
not claim 29 authored or visibly distinct clips. A future canonical athlete
asset may implement this vocabulary only after every state is retargeted,
cleaned, named, visually reviewed, and validated against the same graph. One
good state per contract is preferred to unreviewed clip variants.

## Animation graph rules

- Locomotion cross-fades independently from full-body and additive upper-body
  channels.
- Each channel exposes `currentWeight` and `previousWeight` plus both clips'
  elapsed time. A transition advances both samples; optional full-body and
  upper-body channels fade in from and out to the locomotion base instead of
  appearing or disappearing in one frame. `blend` remains a compatibility
  alias for `currentWeight`.
- Hit, fall, and revive have higher interruption priority than collection,
  interaction, locomotion, or celebration.
- Head look, blink, breathing, point/gaze signalling, body lean, emotion, and
  near-miss startle are procedural deterministic layers.
- Playback rate only stretches locomotion from 0.75× through 1.25×. Outside
  that range the graph chooses another locomotion state.
- Simulation position/facing is authoritative. Animation root motion never
  changes logical tile or game state.

### Deterministic state inputs

Every declared state has an explicit selector input. Neutral/alert idle use
the current intention; walk/run use planar speed; strafes use lateral target
direction; turns use signed angular velocity; pivot uses high angular velocity
or acceleration; and stop/recover uses the bounded
`timeSinceMovementEndedMillis` window. Full-body action states map one-to-one
from `GameplayAction`. Point, wave, and taunt use `socialGesture`; objective,
success, failure, near-miss/damage, and blocked events select point,
small-celebration, disappointment, fear, and confusion respectively. Emotion
provides the deterministic fear/confusion fallback when no stronger action,
gesture, or event is active.

## Validation and compression

Run:

```sh
npm run validate:characters
npm test --workspace @motion-levels-games/character-runtime
npm run test:contracts -- --test-name-pattern='character asset'
```

The validator fails for corrupt GLB headers/chunks, unexpected hash, missing
required bones/clips, duplicate clip names, material/triangle/file-size budget
breaches, or missing attribution metadata. It also reads embedded image bytes
and verifies their declared/sniffed format, dimensions, texture references,
and embedding; audits scene roots, explicit node scale, parent cycles,
multiple-parent nodes, invalid child/joint indices, and joints unreachable from
their declared skeleton root; and prints all measured metadata as JSON.

Canonical GLBs fail when any of the 29 canonical clips is missing, any node has
non-unit scale, or a scene root is not identity. Those are errors even if a
manifest accidentally lists a smaller expected clip set. Non-canonical assets
do not get a blanket exemption: each incomplete-coverage or scale exception
must be explicit in its audit policy with a reason. Sahur is the sole current
exception. It remains `interim`, with 0/29 canonically named clips (its one clip
is `Armature|walk`) and documented FBX centimetre-conversion nodes. Its three
embedded textures must remain WebP at 512×512, its skin hierarchy must be
sound, and attribution metadata remains mandatory.

For third-party input, keep the original source, author, licence, download
date, permitted use, modification notes, and attribution in the package. The
optimizer is installed at the exact lockfile version
`@gltf-transform/cli@4.4.2` (Node 20+). Its vulnerable `sharp ~0.34` range is
scoped-overridden to the exact compatible codec `sharp@0.35.3`; the script
checks and records both installed versions. Process a reviewed source into a
new path with its expected source hash:

```sh
npm run optimize:character-asset -- \
  --input /path/to/reviewed-source.glb \
  --output /path/to/reviewed-source.processed.glb \
  --expect-input-sha256 <64-character-reviewed-source-sha256>
```

The script runs `metalrough`, a Lanczos3 resize capped at 512×512, and WebP at
quality 85 / effort 6 in separate temporary GLBs. It refuses identical
input/output paths and existing
outputs by default, writes the result atomically, and creates a deterministic
`.pipeline.json` sidecar containing tool/configuration and input/output hashes.
Use `--dry-run` to inspect the exact commands. `--force` only permits replacing
a distinct output and its sidecar; it never permits in-place processing.

The checked-in Sahur GLB was produced earlier by glTF-Transform 4.4.1 and does
not have a source-hash sidecar, so this repository does not claim that its
current byte hash can be recreated from an unspecified download. Treat the
pinned script as the required procedure for the next reviewed replacement.
Keep the original download and source hash, inspect the generated sidecar,
compare validator output and a rendered capture, then deliberately update the
asset manifest hash and attribution processing notes. Never repeatedly
compress the checked-in processed GLB.

## Measured budgets

The quality profiles in character-runtime are observable runtime contracts:

- venue/high: 10 characters, ≤40k triangles and 3 draw calls per character,
  DPR ≤2, 95th-percentile frame target 16.7 ms;
- desktop/medium: 10 characters, ≤28k triangles and 2 draw calls each, DPR
  ≤1.5, 20 ms target;
- mobile/low: 6 characters, ≤12k triangles and 1 draw call each, no per-character
  contact-shadow draw, DPR ≤1, 33.3 ms target;
- capture: deterministic higher-quality lighting/particles with a 33.3 ms
  offline capture target.

Every tier additionally allows six fixed scene calls for the instanced floor,
grid, shared shadow pass, and developer overlays. The performance monitor still
records and reports the actual total WebGL calls; it does not subtract this
allowance from diagnostics.

The performance monitor records frame/animation time, draw calls, triangles,
texture memory, and character count and reports the exact violated budgets.
