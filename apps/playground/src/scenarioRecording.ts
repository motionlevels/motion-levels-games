import { loadDataUrlImage } from "./imageLoading.ts";
import { imagesToAnimatedWebp } from "./mediaAssets.ts";
import type {
  PlaygroundScenarioRecordingAsset
} from "./playgroundApi.ts";
import { scenarioContactSheetIndices } from "./scenarioRecordingTimeline.ts";

export {
  normalizeScenarioRecordingOptions,
  scenarioContactSheetIndices,
  scenarioRecordingTimeline,
  type NormalizedScenarioRecordingOptions
} from "./scenarioRecordingTimeline.ts";

export const scenarioRecordingWidth = 1_230;
export const scenarioRecordingHeight = 540;
const contactSheetColumns = 2;
const contactSheetLabelHeight = 32;

export type ScenarioRecordingFrame = {
  atMillis: number;
  dataUrl: string;
};

export async function encodeScenarioRecording(
  frames: readonly ScenarioRecordingFrame[],
  fileStem: string,
  frameIntervalMillis: number
): Promise<{
  clip: PlaygroundScenarioRecordingAsset;
  contactSheet: PlaygroundScenarioRecordingAsset;
}> {
  const clip = await imagesToAnimatedWebp(
    frames.map((frame) => ({ dataUrl: frame.dataUrl, delayMs: frameIntervalMillis })),
    { width: scenarioRecordingWidth, height: scenarioRecordingHeight }
  );

  return {
    clip: {
      ...clip,
      fileName: `${fileStem}.webp`
    },
    contactSheet: await createScenarioContactSheet(frames, `${fileStem}-keyframes.png`)
  };
}

async function createScenarioContactSheet(
  frames: readonly ScenarioRecordingFrame[],
  fileName: string
): Promise<PlaygroundScenarioRecordingAsset> {
  const keyframes = scenarioContactSheetIndices(frames.length)
    .map((index) => frames[index])
    .filter((frame): frame is ScenarioRecordingFrame => frame !== undefined);
  if (keyframes.length === 0) throw new Error("Cannot create a contact sheet without frames");

  const cellWidth = scenarioRecordingWidth / contactSheetColumns;
  const cellHeight = scenarioRecordingHeight / contactSheetColumns;
  const rows = Math.ceil(keyframes.length / contactSheetColumns);
  const canvas = document.createElement("canvas");
  canvas.width = scenarioRecordingWidth;
  canvas.height = rows * (cellHeight + contactSheetLabelHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the scenario contact sheet canvas");

  context.fillStyle = "#05070a";
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const [index, frame] of keyframes.entries()) {
    const image = await loadDataUrlImage(frame.dataUrl, "Could not load a scenario recording frame");
    const column = index % contactSheetColumns;
    const row = Math.floor(index / contactSheetColumns);
    const x = column * cellWidth;
    const y = row * (cellHeight + contactSheetLabelHeight);
    context.drawImage(image, x, y, cellWidth, cellHeight);
    context.fillStyle = "#101722";
    context.fillRect(x, y + cellHeight, cellWidth, contactSheetLabelHeight);
    context.fillStyle = "#d9e4f2";
    context.font = "600 18px system-ui, sans-serif";
    context.textBaseline = "middle";
    context.fillText(formatTimestamp(frame.atMillis), x + 12, y + cellHeight + contactSheetLabelHeight / 2);
  }

  return {
    dataUrl: canvas.toDataURL("image/png"),
    fileName,
    height: canvas.height,
    mimeType: "image/png",
    width: canvas.width
  };
}

function formatTimestamp(atMillis: number): string {
  const sign = atMillis < 0 ? "−" : "+";
  return `t ${sign}${(Math.abs(atMillis) / 1_000).toFixed(1)}s`;
}
