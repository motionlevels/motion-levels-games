export type PlaygroundRuntimeMode = "venue" | "sandbox";

export const playgroundRuntimeModeParameter = "runtime";

export function readPlaygroundRuntimeMode(
  search: string,
  venueAvailable: boolean,
): PlaygroundRuntimeMode {
  if (!venueAvailable) return "sandbox";

  const parameters = new URLSearchParams(search);
  if (parameters.get("recordScenario")?.trim()) return "sandbox";
  return parameters.get(playgroundRuntimeModeParameter) === "sandbox" ? "sandbox" : "venue";
}

export function searchForPlaygroundRuntimeMode(
  search: string,
  mode: PlaygroundRuntimeMode,
  venueAvailable: boolean,
): string {
  const parameters = new URLSearchParams(search);
  if (!venueAvailable || mode === "venue") {
    parameters.delete(playgroundRuntimeModeParameter);
  } else {
    parameters.set(playgroundRuntimeModeParameter, "sandbox");
  }

  const encoded = parameters.toString();
  return encoded ? `?${encoded}` : "";
}
