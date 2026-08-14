export type MenuAccessPolicy = {
  followMirror: boolean;
  persistLocalState: boolean;
  publishMirror: boolean;
  readOnly: boolean;
};

/** A platform controller follows the kiosk-owned mirror but remains a command
 * surface. Only the physical kiosk persists and publishes menu state. */
export function menuAccessPolicyFromSearch(search: string): MenuAccessPolicy {
  const params = new URLSearchParams(search);
  const readOnly = params.get("readOnly") === "1"
    || params.get("readonly") === "1"
    || params.get("mode") === "readonly";
  const remoteControl = params.get("remoteControl") === "1";
  const followMirror = readOnly || remoteControl;
  return {
    followMirror,
    persistLocalState: !followMirror,
    publishMirror: !followMirror,
    readOnly
  };
}
