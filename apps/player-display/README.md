# Player Display

Full-screen player-facing TV shell for score, timer, phase, and game status.
The application and the revision-matched game renderer are published together
in every production games bundle. Venue infrastructure only packages and serves
that immutable artifact.

The display talks to the local TypeScript venue runtime at `http://127.0.0.1:4102`
and subscribes to the canonical revisioned `/api/player-state/events` feed.

```sh
npm install --workspace @motion-levels-games/player-display
npm run dev --workspace @motion-levels-games/player-display
```

Open:

```txt
http://127.0.0.1:4104
```

The default HUD is the arcade player display. The previous display remains
available for recovery or comparison:

```txt
http://127.0.0.1:4104/?hud=classic
```

For design review without a running venue runtime, use one of the built-in demo
states:

```txt
http://127.0.0.1:4104/?demo=players
http://127.0.0.1:4104/?demo=countdown
http://127.0.0.1:4104/?demo=team
http://127.0.0.1:4104/?demo=duel
http://127.0.0.1:4104/?hud=classic&demo=classic
```

Set `VITE_VENUE_RUNTIME_URL` if the display is pointed at a different runtime:

```sh
VITE_VENUE_RUNTIME_URL=http://192.168.1.137:4102 \
  npm run dev --workspace @motion-levels-games/player-display
```

`VITE_GAME_ENGINE_URL` remains an input alias for older deployment tooling.
Electron, Chromium kiosk flags, Caddy, and physical display setup are owned by
the venue repository and intentionally do not live in this package.
