/** @jsxRuntime automatic */
import { createContext, useContext, type ReactNode } from "react";
import {
  normalizeFloorRotationDegrees,
  type FloorRotationDegrees
} from "@motion-levels-games/game-sdk";

type PlayerDisplayRuntime = {
  paused: boolean;
  floorRotationDegrees: FloorRotationDegrees;
};

const PlayerDisplayRuntimeContext = createContext<PlayerDisplayRuntime>({
  paused: false,
  floorRotationDegrees: 0
});

export function PlayerDisplayRuntimeProvider({
  paused,
  floorRotationDegrees = 0,
  children
}: {
  paused: boolean;
  floorRotationDegrees?: FloorRotationDegrees;
  children?: ReactNode;
}) {
  return (
    <PlayerDisplayRuntimeContext.Provider value={{
      paused,
      floorRotationDegrees: normalizeFloorRotationDegrees(floorRotationDegrees)
    }}>
      {children}
    </PlayerDisplayRuntimeContext.Provider>
  );
}

export function usePlayerDisplayRuntime(): PlayerDisplayRuntime {
  return useContext(PlayerDisplayRuntimeContext);
}
