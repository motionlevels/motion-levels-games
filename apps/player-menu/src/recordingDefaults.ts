import type { RecordingScope } from "./api";

export const defaultRecordingScope: RecordingScope = "selection";
export const motionlevelsOneRecordingMigrationKey = "ml-player-menu-motionlevels-1-recording-selection-v1";

export function gatewaySlugFromPathname(pathname: string): string {
  return pathname.match(/^\/gateways\/([^/]+)\/menu(?:\/|$)/u)?.[1]?.toLowerCase() ?? "";
}

export function migrateMotionlevelsOneRecordingScope(
  scope: RecordingScope,
  pathname: string,
  migrationApplied: boolean,
): { migrated: boolean; scope: RecordingScope } {
  if (migrationApplied || gatewaySlugFromPathname(pathname) !== "motionlevels-1") {
    return { migrated: false, scope };
  }
  return {
    migrated: true,
    scope: scope === "visit" ? defaultRecordingScope : scope,
  };
}
