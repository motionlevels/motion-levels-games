# Tira-Soga

Game id: `tira-soga`

Two teams compete over five rounds by rapidly stepping on their own half of a
16x32 interactive floor. Red owns rows 0-14, blue owns rows 17-31, and the two
center rows form a neutral rope line.

## Gameplay

- The rope starts in the center at the beginning of every round.
- Red presses move it toward the red end; blue presses move it toward blue.
- The rope must travel six positions from the center to win a round.
- The game always plays five rounds. The team with the most round wins takes
  the match.
- Easy requires one press per rope move, Medium requires two, and Hard requires
  three.
- A held tile only counts once until its release event arrives.
- Both teams must occupy their illuminated fields before the shared countdown
  starts; leaving during the grace period cancels it.
- A round win plays a short floor and player-display celebration. After the
  fifth round, a distinct five-second match celebration preserves the 3–2 (or
  4–1/5–0) result before the game resets.

The red and blue team layout stays fixed regardless of booking size, so the
game supports `0 / Any`. Physical readiness still requires one occupied zone
for each team before the countdown begins.

The SDK's regular `press` and `release` events are the production-facing tile
integration. `onRedTilePressed()` and `onBlueTilePressed()` are exported as
small simulation adapters for local tests and integrations without hardware.

## Development

```sh
npm run test --workspace @motion-levels-games/tira-soga
npm run typecheck --workspace @motion-levels-games/tira-soga
```

This game was created with the repository scaffold command. Keep
`manifest.id` exactly equal to the directory name: `tira-soga`, and keep the
package registered in `packages/game-catalog/src/gameplayRegistry.ts`.
