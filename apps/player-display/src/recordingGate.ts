import type { PlayerExperienceRecordingGate } from "@motion-levels-games/player-experience";

export type RecordingGateDisplayProjection = {
  state: PlayerExperienceRecordingGate["state"];
  title: string;
  body: string;
  blocking: boolean;
};

export function recordingGateDisplayProjection(
  gate: PlayerExperienceRecordingGate | undefined,
): RecordingGateDisplayProjection | null {
  if (!gate) return null;
  if (gate.state === "arming") {
    return {
      state: gate.state,
      title: "Preparando GoPro",
      body: "La partida empezará cuando la cámara esté grabando",
      blocking: true,
    };
  }
  if (gate.state === "timed_out") {
    return {
      state: gate.state,
      title: "La GoPro no responde",
      body: "Elige una opción en el menú",
      blocking: true,
    };
  }
  return {
    state: gate.state,
    title: "GoPro lista",
    body: "Grabación iniciada",
    blocking: false,
  };
}
