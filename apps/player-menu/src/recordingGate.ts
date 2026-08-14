import type {
  PlayerExperienceControl,
  PlayerExperienceLifecycle,
  PlayerExperienceRecordingGate,
  PlayerExperienceRecordingGateReason,
} from "@motion-levels-games/player-experience";

export type RecordingGateAction = Extract<
  PlayerExperienceControl,
  "recording_retry" | "recording_continue_without" | "recording_cancel"
>;

export type RecordingGateMenuProjection = {
  state: PlayerExperienceRecordingGate["state"];
  title: string;
  body: string;
  actions: RecordingGateAction[];
  blocking: boolean;
};

const recordingGateActions: RecordingGateAction[] = [
  "recording_retry",
  "recording_continue_without",
  "recording_cancel",
];

export function isRecordingGateAction(action: PlayerExperienceControl): action is RecordingGateAction {
  return recordingGateActions.includes(action as RecordingGateAction);
}

export function recordingGateBlocks(gate: PlayerExperienceRecordingGate | undefined): boolean {
  return gate?.state === "arming" || gate?.state === "timed_out";
}

export function recordingGateAllowsGameStarted(input: {
  lifecycle: PlayerExperienceLifecycle;
  recordingGate?: PlayerExperienceRecordingGate;
}): boolean {
  return input.lifecycle !== "launching"
    && (!input.recordingGate || input.recordingGate.state === "ready");
}

export function recordingGateMenuProjection(
  gate: PlayerExperienceRecordingGate | undefined,
  allowedControls: readonly PlayerExperienceControl[] = [],
): RecordingGateMenuProjection | null {
  if (!gate) return null;
  if (gate.state === "arming") {
    return {
      state: gate.state,
      title: "Preparando GoPro",
      body: "La partida empezará cuando la cámara confirme la grabación.",
      actions: [],
      blocking: true,
    };
  }
  if (gate.state === "timed_out") {
    return {
      state: gate.state,
      title: recordingGateFailureTitle(gate.reason),
      body: "Elige cómo quieres continuar.",
      actions: recordingGateActions.filter((action) => allowedControls.includes(action)),
      blocking: true,
    };
  }
  return {
    state: gate.state,
    title: "GoPro lista",
    body: "Grabación iniciada",
    actions: [],
    blocking: false,
  };
}

export function recordingGateActionLabel(action: RecordingGateAction, pending = false): string {
  if (action === "recording_retry") return pending ? "Reintentando" : "Reintentar";
  if (action === "recording_continue_without") return pending ? "Iniciando" : "Jugar sin grabación";
  return pending ? "Cancelando" : "Cancelar";
}

function recordingGateFailureTitle(reason: PlayerExperienceRecordingGateReason | undefined): string {
  if (reason === "unavailable") return "La GoPro no está disponible";
  if (reason === "start_rejected") return "La GoPro no pudo empezar a grabar";
  if (reason === "start_unconfirmed") return "La GoPro no confirmó la grabación";
  return "La GoPro está tardando más de lo esperado";
}
