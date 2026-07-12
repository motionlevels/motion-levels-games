export type ScaffoldReadmeOptions = {
  gameId: string;
  label: string;
};

export function scaffoldReadmeTemplate(options: ScaffoldReadmeOptions): string {
  return `# ${options.label}

Game id: \`${options.gameId}\`

This game was created with:

\`\`\`sh
npm run create:game -- ${options.gameId} "${options.label}"
\`\`\`

## Gameplay

The game waits for one player to remain on the illuminated floor, then shows a
two-second start animation before gameplay begins.

Step on each visible green target to finish the sequence.

## Development

\`\`\`sh
npm run test --workspace @motion-levels-games/${options.gameId}
npm run typecheck --workspace @motion-levels-games/${options.gameId}
\`\`\`

Keep \`manifest.id\` exactly equal to the directory name: \`${options.gameId}\`.
Register the finished package in \`packages/runner/src/registry.ts\`; the
release validator requires every \`games/*\` package to appear in the
production runner, catalog, and player-display registry.
Keep the player-presence gate and pre-start animation when replacing the
scaffolded gameplay. Use \`start: { mode: "immediate" }\` only when a product
requirement explicitly calls for selection-time autoplay.

## Player count policy

This scaffold enables \`0 / Any\` so groups can take turns without changing
their booking or teams. Keep \`players.allowAny: true\` while player count does
not change the board, readiness zones, scoring, or rules. Set it to \`false\`
only when the exact count materially changes gameplay, then document and test
each supported count.

## Gameplay tuning variables

Expose values likely to need playtesting—such as movement speed, spawn rate,
or transition duration—through \`manifest.config.vars\` while tuning the game.
Export each descriptor from \`manifest.ts\` and read it with
\`readGameConfigOption\` so its default, bounds, and step are declared once.
After tuning, deliberately keep the supported option, set \`playerFacing: false\`
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
\`@motion-levels-games/game-sdk/effects\` before adding game-local drawing loops.
Keep the game's palette, timing, result state, and choreography in the game.

## Lives, when applicable

If this game uses lives, include both \`lives\` and \`maxLives\` in its snapshot
and render \`LivesMeter\` from \`@motion-levels-games/display-kit\`. Remaining
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
`;
}
