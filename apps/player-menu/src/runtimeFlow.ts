export type ScreenMode = "browse" | "game";
export type ActiveLevelLaunchPhase = "stopping" | "loading";
export type ActiveLevelLaunch = {
  gameID: string;
  levelID: string;
  phase: ActiveLevelLaunchPhase;
};

export function visibleActiveLevelLaunch({
  gameID,
  launch,
  screenMode,
}: {
  gameID: string;
  launch: ActiveLevelLaunch | null;
  screenMode: ScreenMode;
}): ActiveLevelLaunch | null {
  if (screenMode !== "game") return null;
  if (!launch || launch.gameID !== gameID) return null;
  return launch;
}
