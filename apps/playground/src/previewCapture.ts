import {
  type GameEngine,
  type GameEngineState,
  type GamePreviewScenario
} from "@motion-levels-games/game-sdk";
import { rotateFrameClockwise, type RenderableFrame } from "./frameTransforms.ts";

export type PlayerDisplayMediaFrame = {
  delayMs: number;
  frame: GameEngineState["frame"];
  snapshot: GameEngineState["snapshot"];
};

export type PreviewFrame = {
  display: PlayerDisplayMediaFrame;
  frame: RenderableFrame;
  delayMs: number;
};

const defaultAnimationFrameCount = 18;
const defaultAnimationFrameDelayMillis = 120;

export function collectPreviewFrames(engine: GameEngine, preview: GamePreviewScenario): PreviewFrame[] {
  const frames: PreviewFrame[] = [];
  const actions = preview.actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => left.action.atMillis - right.action.atMillis || left.index - right.index);
  let actionIndex = 0;
  const frameCount = Math.max(1, Math.min(120, preview.frameCount || defaultAnimationFrameCount));
  const frameIntervalMillis = Math.max(1, preview.frameIntervalMillis || defaultAnimationFrameDelayMillis);

  for (let index = 0; index < frameCount; index += 1) {
    const captureAtMillis = preview.captureStartMillis + index * frameIntervalMillis;
    while (actionIndex < actions.length && actions[actionIndex]!.action.atMillis <= captureAtMillis) {
      const action = actions[actionIndex]!.action;
      engine.tickTo(action.atMillis);
      if (action.type === "press") {
        engine.press(action.x, action.y, action.atMillis);
      } else {
        engine.release(action.x, action.y, action.atMillis);
      }
      actionIndex += 1;
    }
    const state = engine.tickTo(captureAtMillis);
    frames.push({
      display: {
        delayMs: frameIntervalMillis,
        frame: state.frame,
        snapshot: state.snapshot
      },
      frame: rotateFrameClockwise(state.frame),
      delayMs: frameIntervalMillis
    });
  }

  return frames;
}
