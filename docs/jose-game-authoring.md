# Jose Game Authoring

Jose works on the `dev` branch. This branch is for adding and iterating on
games before they are manually reviewed and merged into `main`.

## Branch Rules

Always start by rebasing `dev` on top of latest `main`:

```sh
git fetch origin
git switch dev
git rebase origin/main
```

If there are conflicts, resolve them deliberately, then continue:

```sh
git status
git add <resolved-files>
git rebase --continue
```

Do not merge `main` into `dev`. Keep `dev` linear by rebasing.

## Create A Game

Use the scaffold command. Do not copy an existing game by hand.

```sh
npm run create:game -- color-chase "Color Chase"
npm install
```

The scaffold creates:

- `games/<game-id>/README.md`
- `games/<game-id>/src/manifest.ts`
- `games/<game-id>/src/game.ts`
- `games/<game-id>/src/display.tsx`
- `games/<game-id>/src/fixtures.ts`
- `games/<game-id>/test/<game-id>.test.ts`

The game id must match the directory exactly. For `games/color-chase`,
`manifest.id` must be `color-chase`.

## Run The Playground

```sh
npm run dev --workspace apps/playground
```

The playground automatically discovers games from `games/*/src/index.ts`. New
games and code changes should appear in the selector while Vite is running.

## Before Pushing To Dev

```sh
npm run validate:games
npm run check
git status
git push origin dev
```

The `Dev Games CI` workflow runs on every push to `dev`. It fails if `dev` is
not rebased on latest `origin/main`, or if validation, tests, build, scaffold
test, or playtest fail.

## Instructions For Jose's AI Agent

1. Read `AGENTS.md`, `docs/contract.md`, `docs/ai-playtest-workflow.md`, and
   this file before editing.
2. Work only on branch `dev`.
3. Rebase `dev` on `origin/main` before starting and before pushing.
4. Create new games with `npm run create:game -- <game-id> "Display Name"`.
5. Keep all game code inside `games/<game-id>/`.
6. Do not manually add game imports to `apps/playground/src/App.tsx`.
7. Keep `manifest.id`, package name, README, tests, and fixtures in sync.
8. Run `npm run check` before pushing.
9. If CI fails, fix `dev` and push again. Do not ask Jose to merge until CI is
   green.
