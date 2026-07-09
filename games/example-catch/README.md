# Example Catch

Game id: `example-catch`

Example Catch is a minimal single-player target game used to demonstrate the
Motion Levels game contract. A blue target appears on the 16x32 floor and the
player scores by stepping on it before time expires.

## Development

```sh
npm run test --workspace @motion-levels-games/example-catch
npm run typecheck --workspace @motion-levels-games/example-catch
```

Keep `manifest.id` exactly equal to the directory name: `example-catch`.
