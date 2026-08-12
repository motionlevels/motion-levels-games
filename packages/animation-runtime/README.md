# Animation runtime

The preferred, native TypeScript API for deterministic Motion Levels floor
animations. Animations are small compositions of reusable pixel shaders:

```ts
export const aurora = defineAnimation({
  id: "aurora",
  label: "Aurora",
  durationMillis: 16_000,
  render: compose(
    gradient(["#020617", "#081c35"]),
    screen(ribbons({ colors: ["#42ffd2", "#5b8cff", "#e66cff"] }))
  )
});
```

The engine is pure and deterministic. Hosts provide time, seed, and pressure
events; the package performs no I/O. The legacy `motion-dsl-v1` format remains
supported by the platform and venue during migration, but new built-ins should
use this API.
