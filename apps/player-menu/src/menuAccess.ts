export type MenuAccessPolicy = {
  followMirror: boolean;
  persistLocalState: boolean;
  publishMirror: boolean;
  readOnly: boolean;
};

/** Every renderer follows the runtime-owned menu state. Interactive renderers
 * publish through that same authority; read-only previews only subscribe. */
export function menuAccessPolicyFromSearch(search: string): MenuAccessPolicy {
  const params = new URLSearchParams(search);
  const readOnly = params.get("readOnly") === "1"
    || params.get("readonly") === "1"
    || params.get("mode") === "readonly";
  const remoteControl = params.get("remoteControl") === "1";
  return {
    followMirror: true,
    persistLocalState: !readOnly && !remoteControl,
    publishMirror: !readOnly,
    readOnly
  };
}
