export type PauseLockSet = ReadonlySet<string>;

export function updatePauseLocks(locks: PauseLockSet, lockId: string, active: boolean): PauseLockSet {
  if (active === locks.has(lockId)) {
    return locks;
  }

  const nextLocks = new Set(locks);
  if (active) {
    nextLocks.add(lockId);
  } else {
    nextLocks.delete(lockId);
  }
  return nextLocks;
}

export function isPlaygroundPaused(manuallyPaused: boolean, locks: PauseLockSet): boolean {
  return manuallyPaused || locks.size > 0;
}
