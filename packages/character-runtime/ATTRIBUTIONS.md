# Third-party assets

## `assets/tung-tung-tung-sahur.glb`

**“Tung Tung Tung Sahur LowPoly (Mixamo Rig)”** by **KAG3D**
([@Kag3d](https://sketchfab.com/Kag3d)), licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

- Source: https://sketchfab.com/3d-models/tung-tung-tung-sahur-lowpoly-mixamo-rig-99c84a57df394dc8b3976f5582f74c52
- Downloaded: 20 July 2026 as a 1.67 MB glTF Binary, approximately 1.4k
  triangles / 720 vertices, with `Armature|walk` on a Mixamo humanoid rig.
- SHA-256 of this processed file:
  `0107681fe307b9b8200abbfbf711659c6e837c8293f833b3c7fbdc5438fb9d92`

The geometry, rig, and animation are unchanged. Materials were converted from
the retired `KHR_materials_pbrSpecularGlossiness` extension to metallic-
roughness, textures were resized to 512 px and encoded as WebP, reducing the
asset to 269,968 bytes. Runtime consumers remove hip-position tracks for
in-place locomotion, scale the model to character height, and seat it on the
floor.

CC-BY requires KAG3D to be credited anywhere this asset is presented. The four
procedural Motion Athlete variants are original Motion Levels geometry and do
not have third-party asset dependencies.

## Quaternius modular characters

Ten characters are derived from the **Ultimate Modular Characters Pack** and
**Ultimate Modular Women Pack** by **Quaternius**, released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).

- Sources:
  - https://quaternius.com/packs/ultimatemodularcharacters.html
  - https://quaternius.com/packs/ultimatemodularwomen.html
- Downloaded: 12 August 2026
- Included characters: Adventurer, Casual Hoodie, Mystic, Punk, Spacesuit,
  Star Pilot, Street Scout, SWAT, Trailblazer, and Worker.
- Each character includes one humanoid skin and 24 authored animation clips.

The source glTF files were converted to self-contained GLBs and compressed
losslessly with meshopt. Geometry, armatures, animation curves, and palette
materials were preserved. Exact per-file hashes, size ceilings, triangle
budgets, source URLs, and required bones are declared in `src/index.ts` and
checked by `npm run validate:characters`.

CC0 does not require attribution; this notice and the visible picker credit are
kept as transparent provenance and thanks to Quaternius.
