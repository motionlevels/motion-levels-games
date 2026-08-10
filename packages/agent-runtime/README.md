# Agent runtime

Deterministic, framework-free agent policies for Motion Levels games. The
package does not read clocks, use ambient randomness, or mutate game state.
Callers provide versioned observations and simulation time; brains return
versioned data-only actions that can be recorded and replayed.

## Main layers

- `AgentObservation`, `AgentAction`, `AgentDefinition`, `AgentSnapshot`, and
  `AgentBrain` are the versioned integration boundary. Contract constructors
  defensively copy and recursively freeze arrays, plain records, maps, and sets
  so later caller mutation cannot rewrite replay data; functions and class
  instances are explicit opaque service references.
- `createAgentRuntime` adds reaction delay, seeded bounded mistakes, intention
  stickiness, snapshots, and stuck replanning around any brain. Runtime
  snapshots preserve the exact next-plan deadline, queued force-replan flag,
  pending decision, random stream, and stuck-detector sample window so restore
  continues bit-for-bit from the next observation.
- `createGrid` and `findPath` provide deterministic A* with dynamic, timed,
  crowding, and reservation costs.
- `ReservationBook` coordinates expiring objective, destination, and corridor
  claims.
- `selectIntention` ranks utility intentions and preserves per-factor scoring
  explanations.
- `AGENT_PROFILES` exposes cautious, balanced, bold, helper, explorer,
  chaotic, and expert bounded presets.

Reference controllers cover objective/hazard play, lava safe zones, chase
interception, imperfect memory, team arena assignments, Pong, Tetris, space
arcade behavior, and scripted choreography.

## Legacy fixed patrols

`adaptLegacyFixedPatrol` preserves a declared patrol verbatim. It prepends the
spawn point when necessary, visits waypoints in their fixed order, loops by
default, and carries `speed`, `damage`, and `spawn` from
`AgentDefinition.config.patrol` to each action payload.

```ts
import { adaptLegacyFixedPatrol } from "@motion-levels-games/agent-runtime";

const { definition, brain, spawn } = adaptLegacyFixedPatrol({
  id: "crossing-car",
  spawn: { x: 0, y: 12 },
  path: [{ x: 15, y: 12 }],
  speed: 4,
  damage: 1
});
```

Pass `definition` and `brain` to `createAgentRuntime`; use `spawn` when
creating the game entity. The action payload keeps the legacy tuning metadata
available to the game adapter.
