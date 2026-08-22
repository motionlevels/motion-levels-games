# Atrapa al topo

Game id: `whack-a-mole`

This game was created with:

```sh
npm run create:game -- whack-a-mole "Atrapa al topo"
```

## Gameplay

One to eight players occupy distinct start platforms, then chase simultaneous
2x2 targets around the full floor for 60 seconds. Targets pulse faster as their
deadline approaches, respawn immediately after a hit, and grant four to twelve
points according to reaction speed. A missed target returns with catch-up time.
The highest score wins a locked four-second celebration.

The waiting floor composes the shared sparse tile pulses with homogeneous 4x4
player platforms. Empty platforms pulse brightly and slowly; occupied
platforms retain their color at lower intensity with a quicker pulse. The
three-second start reveals the first real targets tile by tile. During play,
targets use an appearance, steady, urgency, and colored-hit sequence rather
than fading out of view. Victory reveals the winner color through seeded
appearing tiles before settling into a restrained pulse and sparkle.

Ordinary movement over an empty tile is silent and does not create a miss
event. Only an expired target emits `target-expired`; a successful target emits
`mole-hit` and is scored for the target's color owner.

## Audio

The game has calm waiting music, more energetic running music, a rate-varied
illuminated-tile hit, start and victory stings, an Atrapa al topo introduction,
and Spanish player-color victory lines. Shared Duelo assets are intentionally
referenced rather than duplicated; the reuse provenance and the generated
introduction recipe live under `assets/audio/whack-a-mole/`.

## Playtest scenarios

The standalone playground exposes deterministic `countdown`, `hit`, `expired`,
and `victory` recordings so animation and display work never requires replaying
the complete minute-long match.

## Development

```sh
npm run test --workspace @motion-levels-games/whack-a-mole
npm run typecheck --workspace @motion-levels-games/whack-a-mole
```

Keep `manifest.id` exactly equal to the directory name: `whack-a-mole`.
Register the finished package in `packages/game-catalog/src/gameplayRegistry.ts`; the
release validator requires every `games/*` package to appear in the
production runtime, catalog, and player-display registry.
Keep the player-presence gate and pre-start animation when replacing the
scaffolded gameplay. Use `start: { mode: "immediate" }` only when a product
requirement explicitly calls for selection-time autoplay.

## Player count policy

Player count is strict because every configured player owns a readiness pad,
colored target stream, and score card. All counts from one through eight are
supported and tested.

## Gameplay tuning variables

Expose values likely to need playtesting—such as movement speed, spawn rate,
or transition duration—through `manifest.config.vars` while tuning the game.
Export each descriptor from `manifest.ts` and read it with
`readGameConfigOption` so its default, bounds, and step are declared once.
After tuning, deliberately keep the supported option, set `playerFacing: false`
for an operator-only control, or hardcode the chosen value and remove the
variable. Do not leave unused controls behind.

## Required winning animations

Implement a distinct game-win animation on both the floor and player display
before this game resets. If the game has rounds, also add a shorter, visually
distinct round-win animation before the next round begins. Each transition must
show the winner and completed result, ignore scoring input while active, and
use deterministic engine timing. Add fixtures and tests for representative
animation frames, then capture and visually inspect both surfaces in the
playground.

Compose reusable deterministic floor geometry from
`@motion-levels-games/game-sdk/effects` before adding game-local drawing loops.
Keep the game's palette, timing, result state, and choreography in the game.

## Lives, when applicable

If this game uses lives, include both `lives` and `maxLives` in its snapshot
and render `LivesMeter` from `@motion-levels-games/display-kit`. Remaining
lives must be solid red hearts; lost lives must remain visible as the same
solid heart shape in muted gray. Do not create game-specific heart strings or
colors. Add fixtures and tests for full, partially depleted, and zero lives,
then visually inspect each state for wrapping and clipping.

## Required player display review

Before this game is considered complete, open it in the playground and capture
the native 1920x1080 player display for every supported main phase. Actually
inspect the rendered images with representative worst-case content: long
labels and player names, wide scores and timers, dense status text, and the
finished state. Fix overflow, clipping, collisions, ellipses, mid-word breaks,
awkward wrapping, and text that is visually too large or small for its
container. Tests and capture dimensions do not replace this visual review.

Design for venue viewing distance. Make primary score, round/progress, lives,
and time values as large as their cards safely allow. Use the widest expected
value as the fit test and inspect both native and scaled views. Do not leave
large empty metric cards around small desktop-sized values.
