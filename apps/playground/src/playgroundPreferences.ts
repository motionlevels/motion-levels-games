export const selectedGameStorageKey = "motion-levels.playground.selected-game";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readStoredSelectedGameId(
  availableGameIds: readonly string[],
  storage: StorageLike | undefined = browserStorage()
): string | undefined {
  if (!storage) {
    return undefined;
  }

  try {
    const storedGameId = storage.getItem(selectedGameStorageKey);
    return storedGameId && availableGameIds.includes(storedGameId) ? storedGameId : undefined;
  } catch {
    return undefined;
  }
}

export function storeSelectedGameId(
  gameId: string,
  storage: StorageLike | undefined = browserStorage()
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(selectedGameStorageKey, gameId);
  } catch {
    // The playground still works when browser storage is unavailable.
  }
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
