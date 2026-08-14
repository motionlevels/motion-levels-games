export type MenuMirrorEnvelope<TSnapshot> = {
  version: number;
  updatedUnixMillis: number;
  snapshot: TSnapshot | null;
};

export type MenuMirrorResolution<TSnapshot> = {
  accepted: boolean;
  ready: true;
  snapshot: TSnapshot | null;
  updatedUnixMillis: number;
  version: number;
};

/** A successful fetch makes an embedded menu usable even when a freshly
 * started runtime has no physical-kiosk snapshot yet. */
export function resolveMenuMirrorEnvelope<TSnapshot>(
  envelope: MenuMirrorEnvelope<TSnapshot>,
  currentVersion: number,
  currentUpdatedUnixMillis: number
): MenuMirrorResolution<TSnapshot> {
  if (!envelope.snapshot) {
    return {
      accepted: false,
      ready: true,
      snapshot: null,
      updatedUnixMillis: currentUpdatedUnixMillis,
      version: currentVersion,
    };
  }
  const newerVersion = envelope.version > currentVersion;
  const newerSnapshot = envelope.updatedUnixMillis > currentUpdatedUnixMillis;
  if (!newerVersion && !newerSnapshot) {
    return {
      accepted: false,
      ready: true,
      snapshot: null,
      updatedUnixMillis: currentUpdatedUnixMillis,
      version: currentVersion,
    };
  }
  return {
    accepted: true,
    ready: true,
    snapshot: envelope.snapshot,
    updatedUnixMillis: envelope.updatedUnixMillis,
    version: envelope.version,
  };
}
