import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { characterCatalog, defaultCharacterId } from "@motion-levels-games/jugar-3d";
import {
  Stage,
  useGameSession,
  type JugarStageDiagnostics,
  type SessionTrajectoryFrame
} from "@motion-levels-games/jugar-3d/react";
import type { GameDifficulty, GameEngineState } from "@motion-levels-games/game-sdk";
import {
  REPLAY_SCHEMA_VERSION,
  ReplayPlayer,
  ReplayRecorder,
  encodeReplay,
  type GameReplay,
  type ReplayJsonValue,
  type ReplayRecordFrame
} from "@motion-levels-games/replay-runtime";

import type { PlaygroundAgentProfile, PlaygroundGame } from "./gameRegistry.ts";
import type {
  AgentLabApi,
  AgentLabCapture,
  AgentLabDebugOptions,
  AgentLabState
} from "./playgroundApi.ts";

export type JugarAgentSurfaceController = Omit<AgentLabApi, "setActive">;

type Props = Readonly<{
  game: PlaygroundGame;
  seed: number;
  playerCount: number;
  difficulty: GameDifficulty;
  durationMillis: number;
  gameOptions: Readonly<Record<string, unknown>>;
  hostPaused: boolean;
  onController(controller: JugarAgentSurfaceController | null): void;
  onState(state: GameEngineState): void;
  onSeedChange(seed: number): void;
  onPlayerCountChange(playerCount: number): void;
}>;

const profileOptions: readonly PlaygroundAgentProfile[] = [
  "mixed",
  "cautious",
  "balanced",
  "bold",
  "helper",
  "explorer",
  "expert"
];
const qualityOptions = ["mobile-low", "desktop-medium", "venue-high", "capture"] as const;
const speedOptions = [0.25, 0.5, 1, 2, 4] as const;
const defaultDebug: Required<AgentLabDebugOptions> = Object.freeze({
  paths: true,
  reservations: false,
  targets: true
});

/**
 * Additive lab controls around the shared production Jugar 3D session/Stage.
 * Live authority is never regenerated for replay: exact per-tick frames are
 * retained and presented while the one engine remains paused and untouched.
 */
export function JugarAgentSurface({
  game,
  seed,
  playerCount,
  difficulty,
  durationMillis,
  gameOptions,
  hostPaused,
  onController,
  onState,
  onSeedChange,
  onPlayerCountChange
}: Props) {
  const hostRef = useRef<HTMLElement>(null);
  const hostPausedRef = useRef(hostPaused);
  const seedRef = useRef(seed);
  const localPausedRef = useRef(false);
  const recordingRef = useRef(true);
  const replayModeRef = useRef(false);
  const replayPausedRef = useRef(true);
  const replayIndexRef = useRef(0);
  const replaySpeedRef = useRef(1);
  const speedRef = useRef(1);
  const framesRef = useRef<SessionTrajectoryFrame[]>([]);
  const replayRecorderRef = useRef<ReplayRecorder<ReplayJsonValue> | undefined>(undefined);
  const replayPlayerRef = useRef<ReplayPlayer<ReplayJsonValue> | undefined>(undefined);
  const latestFrameRef = useRef<SessionTrajectoryFrame | undefined>(undefined);
  const debugRef = useRef({ ...defaultDebug });
  const selectedAgentRef = useRef<string | undefined>(undefined);
  const performanceRef = useRef<JugarStageDiagnostics | undefined>(undefined);
  const stateRef = useRef<AgentLabState>(emptyState(seed, playerCount));

  const [profile, setProfile] = useState<PlaygroundAgentProfile>("mixed");
  const [characterId, setCharacterId] = useState(defaultCharacterId);
  const [qualityTier, setQualityTier] = useState<(typeof qualityOptions)[number]>("desktop-medium");
  const [recording, setRecording] = useState(true);
  const [replayMode, setReplayMode] = useState(false);
  const [replayPaused, setReplayPaused] = useState(true);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [debugVisibility, setDebugVisibility] = useState({ ...defaultDebug });
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [, refresh] = useState(0);

  hostPausedRef.current = hostPaused;
  seedRef.current = seed;
  recordingRef.current = recording;
  replayModeRef.current = replayMode;
  replayPausedRef.current = replayPaused;
  replayIndexRef.current = replayIndex;
  replaySpeedRef.current = replaySpeed;
  speedRef.current = speed;
  debugRef.current = debugVisibility;
  selectedAgentRef.current = selectedAgentId;

  const sessionOptions = useMemo(() => ({
    controllerProfile: profile,
    controllerSlots: "all" as const,
    difficulty,
    durationMillis,
    gameOptions,
    playerCount,
    seed
  }), [difficulty, durationMillis, gameOptions, playerCount, profile, seed]);
  const session = useGameSession(game, sessionOptions);

  const resetRecorder = useCallback((initial: SessionTrajectoryFrame) => {
    const recorder = createRecorder(game, session, profile, difficulty, durationMillis, playerCount);
    recorder.record(replayRecord(initial));
    replayRecorderRef.current = recorder;
  }, [difficulty, durationMillis, game, playerCount, profile, session]);

  const updatePublicState = useCallback(() => {
    const trajectory = replayModeRef.current
      ? framesRef.current[replayIndexRef.current]
      : latestFrameRef.current;
    const snapshot = session.state.snapshot;
    const nextSelected = selectedAgentRef.current ?? session.avatars[0]?.id.toString();
    if (nextSelected !== selectedAgentRef.current) selectedAgentRef.current = nextSelected;
    stateRef.current = {
      available: true,
      active: true,
      paused: replayModeRef.current
        ? hostPausedRef.current || replayPausedRef.current
        : hostPausedRef.current || localPausedRef.current,
      replayMode: replayModeRef.current,
      replayPaused: replayPausedRef.current,
      recording: recordingRef.current,
      agentCount: session.avatars.length,
      profile,
      qualityTier,
      speed: speedRef.current,
      replaySpeed: replaySpeedRef.current,
      replayEndTick: framesRef.current.at(-1)?.tick ?? 0,
      ...(nextSelected ? { selectedAgentId: nextSelected } : {}),
      seed: session.seed,
      tick: trajectory?.tick ?? session.tick,
      checksum: trajectory?.checksum ?? "pending",
      debug: { ...debugRef.current, reservations: false },
      ...(performanceRef.current ? { performance: performanceRef.current } : {}),
      metrics: {
        completed: String(snapshot.phase) === "finished",
        elapsedMillis: snapshot.elapsedMillis,
        score: snapshot.score
      }
    };
  }, [profile, qualityTier, session]);

  useEffect(() => {
    const availableIds = session.avatars.map((avatar) => avatar.id.toString());
    const current = selectedAgentRef.current;
    if (current && availableIds.includes(current)) return;
    const first = availableIds[0];
    selectedAgentRef.current = first;
    setSelectedAgentId(first);
    updatePublicState();
  }, [session, updatePublicState]);

  const setReplayPausedState = useCallback((paused: boolean) => {
    replayPausedRef.current = paused;
    setReplayPaused(paused);
    updatePublicState();
  }, [updatePublicState]);

  useEffect(() => {
    const initial = session.captureTrajectoryFrame();
    framesRef.current = [initial];
    latestFrameRef.current = initial;
    resetRecorder(initial);
    replayPlayerRef.current = undefined;
    replayIndexRef.current = 0;
    setReplayIndex(0);
    setReplayMode(false);
    setReplayPaused(true);
    recordingRef.current = true;
    setRecording(true);
    const unsubscribe = session.subscribeTrajectory((frame) => {
      latestFrameRef.current = frame;
      if (!recordingRef.current || replayModeRef.current) return;
      const frames = framesRef.current;
      frames.push(frame);
      replayRecorderRef.current?.record(replayRecord(frame));
      if (frame.tick % 5 === 0) refresh((value) => value + 1);
    });
    return unsubscribe;
  }, [resetRecorder, session]);

  useEffect(() => {
    if (!replayMode) session.setPaused(hostPaused || localPausedRef.current);
    if (hostPaused && replayMode) setReplayPausedState(true);
    updatePublicState();
    refresh((value) => value + 1);
  }, [hostPaused, replayMode, session, setReplayPausedState, updatePublicState]);

  useEffect(() => {
    const publish = () => {
      updatePublicState();
      onState(session.state);
      refresh((value) => value + 1);
    };
    publish();
    return session.subscribe(publish);
  }, [onState, session, updatePublicState]);

  const presentReplayIndex = useCallback((index: number) => {
    const frames = framesRef.current;
    if (frames.length === 0) return;
    const normalized = Math.max(0, Math.min(frames.length - 1, Math.trunc(index)));
    const frame = frames[normalized];
    if (!frame) return;
    replayIndexRef.current = normalized;
    setReplayIndex(normalized);
    session.presentTrajectoryFrame(frame);
    updatePublicState();
  }, [session, updatePublicState]);

  const enterReplay = useCallback(() => {
    if (framesRef.current.length === 0) {
      framesRef.current = [session.captureTrajectoryFrame()];
    }
    replayModeRef.current = true;
    replayPausedRef.current = true;
    setReplayMode(true);
    setReplayPaused(true);
    session.setPaused(true);
    const replay = replayRecorderRef.current?.finish();
    if (replay) {
      replayPlayerRef.current = new ReplayPlayer(replay);
      replayPlayerRef.current.seek(framesRef.current[0]?.tick ?? 0);
    }
    presentReplayIndex(0);
  }, [presentReplayIndex, session]);

  const exitReplay = useCallback(() => {
    if (!replayModeRef.current) return;
    replayModeRef.current = false;
    replayPausedRef.current = true;
    setReplayMode(false);
    setReplayPaused(true);
    replayPlayerRef.current = undefined;
    session.exitTrajectoryPlayback();
    session.setPaused(hostPausedRef.current || localPausedRef.current);
    updatePublicState();
  }, [session, updatePublicState]);

  const seekReplay = useCallback((tick: number) => {
    if (!replayModeRef.current) enterReplay();
    const cursorTick = replayPlayerRef.current?.seek(tick).tick ?? tick;
    const frames = framesRef.current;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    frames.forEach((frame, index) => {
      const distance = Math.abs(frame.tick - cursorTick);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    presentReplayIndex(bestIndex);
  }, [enterReplay, presentReplayIndex]);

  useEffect(() => {
    if (!replayMode || replayPaused || hostPaused) return undefined;
    let frameHandle = 0;
    let previousAt: number | undefined;
    replayPlayerRef.current?.play();
    const animate = (now: number) => {
      const deltaTicks = previousAt === undefined
        ? 0
        : (now - previousAt) / session.frameMillis;
      previousAt = now;
      const advanced = replayPlayerRef.current?.advance(deltaTicks) ?? [];
      const tick = advanced.at(-1)?.tick;
      if (tick !== undefined) seekReplay(tick);
      if (replayPlayerRef.current?.state.paused) {
        setReplayPausedState(true);
        return;
      }
      frameHandle = requestAnimationFrame(animate);
    };
    frameHandle = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameHandle);
  }, [hostPaused, replayMode, replayPaused, seekReplay, session.frameMillis, setReplayPausedState]);

  const setRunPaused = useCallback((paused: boolean) => {
    if (replayModeRef.current) {
      setReplayPausedState(paused);
      return;
    }
    localPausedRef.current = paused;
    session.setPaused(hostPausedRef.current || paused);
    updatePublicState();
    refresh((value) => value + 1);
  }, [session, setReplayPausedState, updatePublicState]);

  const reset = useCallback((options: { newSeed?: boolean } = {}) => {
    exitReplay();
    const nextSeed = options.newSeed ? nextSeedFrom(seedRef.current) : seedRef.current;
    session.restart({ seed: nextSeed });
    const initial = session.captureTrajectoryFrame();
    framesRef.current = [initial];
    latestFrameRef.current = initial;
    resetRecorder(initial);
    if (nextSeed !== seedRef.current) onSeedChange(nextSeed);
    updatePublicState();
  }, [exitReplay, onSeedChange, resetRecorder, session, updatePublicState]);

  const startRecording = useCallback(() => {
    exitReplay();
    const initial = session.captureTrajectoryFrame();
    framesRef.current = [initial];
    latestFrameRef.current = initial;
    resetRecorder(initial);
    recordingRef.current = true;
    setRecording(true);
    updatePublicState();
  }, [exitReplay, resetRecorder, session, updatePublicState]);

  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    setRecording(false);
    updatePublicState();
  }, [updatePublicState]);

  const capture = useCallback(async (
    options: { width?: number; height?: number } = {}
  ): Promise<AgentLabCapture> => {
    const source = hostRef.current?.querySelector("canvas");
    if (!(source instanceof HTMLCanvasElement)) throw new Error("Jugar 3D canvas is not ready");
    const dimensions = captureDimensions(source, options);
    if (dimensions.width === source.width && dimensions.height === source.height) {
      return { surface: "agents3d", ...dimensions, dataUrl: source.toDataURL("image/png") };
    }
    const output = document.createElement("canvas");
    output.width = dimensions.width;
    output.height = dimensions.height;
    const context = output.getContext("2d");
    if (!context) throw new Error("Could not create Jugar 3D capture surface");
    context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
    return { surface: "agents3d", ...dimensions, dataUrl: output.toDataURL("image/png") };
  }, []);

  const setProfileState = useCallback((nextProfile: PlaygroundAgentProfile) => {
    if (!profileOptions.includes(nextProfile)) throw new Error(`Unknown agent profile: ${nextProfile}`);
    setProfile(nextProfile);
  }, []);

  const setQualityState = useCallback((tier: AgentLabState["qualityTier"]) => {
    if (!qualityOptions.some((candidate) => candidate === tier)) {
      throw new Error(`Unknown Jugar quality tier: ${tier}`);
    }
    performanceRef.current = undefined;
    setQualityTier(tier as (typeof qualityOptions)[number]);
  }, []);

  const handleStageDiagnostics = useCallback((diagnostics: JugarStageDiagnostics) => {
    performanceRef.current = diagnostics;
    updatePublicState();
    refresh((value) => value + 1);
  }, [updatePublicState]);

  const setDebugState = useCallback((options: AgentLabDebugOptions) => {
    const next = { ...debugRef.current, ...options, reservations: false };
    debugRef.current = next;
    setDebugVisibility(next);
    updatePublicState();
  }, [updatePublicState]);

  const controller = useMemo<JugarAgentSurfaceController>(() => ({
    getState: () => ({ ...stateRef.current, active: true, available: true }),
    play: () => setRunPaused(false),
    pause: () => setRunPaused(true),
    step: (ticks = 1) => {
      if (replayModeRef.current) presentReplayIndex(replayIndexRef.current + ticks);
      else session.stepTicks(ticks);
      updatePublicState();
    },
    reset,
    setAgentCount: onPlayerCountChange,
    setProfile: setProfileState,
    setQualityTier: setQualityState,
    setSpeed: (nextSpeed) => {
      session.setTimeScale(nextSpeed);
      speedRef.current = nextSpeed;
      setSpeed(nextSpeed);
      updatePublicState();
    },
    selectAgent: (agentId) => {
      selectedAgentRef.current = agentId;
      setSelectedAgentId(agentId);
      updatePublicState();
    },
    setDebug: setDebugState,
    startRecording,
    stopRecording,
    exportReplay: () => encodeReplay(replayRecorderRef.current?.finish() ?? emptyReplay(game, session)),
    replay: {
      enter: enterReplay,
      exit: exitReplay,
      play: () => setReplayPausedState(false),
      pause: () => setReplayPausedState(true),
      seek: seekReplay,
      setSpeed: (nextSpeed) => {
        if (!Number.isFinite(nextSpeed) || nextSpeed <= 0 || nextSpeed > 4) {
          throw new Error("Replay speed must be greater than 0 through 4");
        }
        replaySpeedRef.current = nextSpeed;
        replayPlayerRef.current?.setSpeed(nextSpeed);
        setReplaySpeed(nextSpeed);
        updatePublicState();
      }
    },
    capture
  }), [
    capture,
    enterReplay,
    exitReplay,
    game,
    onPlayerCountChange,
    presentReplayIndex,
    reset,
    seekReplay,
    session,
    setDebugState,
    setProfileState,
    setQualityState,
    setReplayPausedState,
    setRunPaused,
    startRecording,
    stopRecording,
    updatePublicState
  ]);

  useEffect(() => {
    onController(controller);
    return () => onController(null);
  }, [controller, onController]);

  const publicState = stateRef.current;
  const selectedNumericId = selectedAgentId === undefined ? undefined : Number(selectedAgentId);
  const selectedDebug = session.agentDebug.find((entry) => entry.avatarId === selectedNumericId);
  return (
    <section className="agent-lab jugar-agent-surface" ref={hostRef}>
      <div className="agent-lab-viewport">
        <Stage
          captureFrames
          characterId={characterId}
          characterModelBaseUrl={`${import.meta.env.BASE_URL}models/quaternius`}
          debug={{
            paths: debugVisibility.paths,
            targets: debugVisibility.targets,
            ...(Number.isInteger(selectedNumericId) ? { selectedAvatarId: selectedNumericId } : {})
          }}
          onDiagnostics={handleStageDiagnostics}
          quality={qualityTier}
          session={session}
        />
        <div className="agent-lab-hud" aria-live="polite">
          <span><i className={publicState.paused ? "is-paused" : "is-live"} />{replayMode ? "Replay" : "Live authority"}</span>
          <code>seed {publicState.seed}</code>
          <code>tick {publicState.tick}</code>
          <code>{publicState.checksum}</code>
          {publicState.performance ? (
            <code>
              {Math.round(publicState.performance.p95FrameMillis * 10) / 10}ms · {publicState.performance.maxDrawCalls} calls
            </code>
          ) : null}
        </div>
        {selectedDebug ? (
          <div className="jugar-agent-explanation">
            <strong>Agent {selectedDebug.playerIndex + 1}</strong>
            <span>{selectedDebug.explanation}</span>
          </div>
        ) : null}
        <div className="jugar-agent-controls" aria-label="Jugar 3D agent controls">
          <button onClick={() => setRunPaused(!publicState.paused)} type="button">
            {publicState.paused ? "Play" : "Pause"}
          </button>
          <button onClick={() => controller.step(1)} type="button">Tick</button>
          <button onClick={() => reset()} type="button">Same seed</button>
          <button onClick={() => reset({ newSeed: true })} type="button">New seed</button>
          <button onClick={recording ? stopRecording : startRecording} type="button">
            {recording ? "Stop record" : "Record"}
          </button>
          <button onClick={replayMode ? exitReplay : enterReplay} type="button">
            {replayMode ? "Return live" : "Replay"}
          </button>
          <label>Profile
            <select onChange={(event) => setProfileState(event.target.value as PlaygroundAgentProfile)} value={profile}>
              {profileOptions.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </label>
          <label>Quality
            <select onChange={(event) => setQualityState(event.target.value as AgentLabState["qualityTier"])} value={qualityTier}>
              {qualityOptions.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
          </label>
          <label>Speed
            <select onChange={(event) => controller.setSpeed(Number(event.target.value))} value={speed}>
              {speedOptions.map((entry) => <option key={entry} value={entry}>{entry}×</option>)}
            </select>
          </label>
          <label>Agent
            <select
              aria-label="Selected agent"
              onChange={(event) => controller.selectAgent(event.target.value)}
              value={selectedAgentId ?? ""}
            >
              {session.avatars.map((avatar) => (
                <option key={avatar.id} value={avatar.id.toString()}>
                  {avatar.playerIndex + 1}
                </option>
              ))}
            </select>
          </label>
          <label>Character
            <select
              aria-label="Playable character"
              onChange={(event) => setCharacterId(event.target.value)}
              value={characterId}
            >
              {characterCatalog.map((character) => (
                <option key={character.id} value={character.id}>{character.label}</option>
              ))}
            </select>
          </label>
          <label><input checked={debugVisibility.paths} onChange={(event) => setDebugState({ paths: event.target.checked })} type="checkbox" />Paths</label>
          <label><input checked={debugVisibility.targets} onChange={(event) => setDebugState({ targets: event.target.checked })} type="checkbox" />Targets</label>
          {replayMode ? (
            <div className="jugar-replay-timeline">
              <button onClick={() => setReplayPausedState(!replayPaused)} type="button">{replayPaused ? "Play replay" : "Pause replay"}</button>
              <input
                aria-label="Replay tick"
                max={Math.max(0, framesRef.current.length - 1)}
                min={0}
                onChange={(event) => presentReplayIndex(Number(event.target.value))}
                type="range"
                value={replayIndex}
              />
              <code>{publicState.tick}/{publicState.replayEndTick}</code>
              <select aria-label="Replay speed" onChange={(event) => controller.replay.setSpeed(Number(event.target.value))} value={replaySpeed}>
                {speedOptions.map((entry) => <option key={entry} value={entry}>{entry}×</option>)}
              </select>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function emptyState(seed: number, agentCount: number): AgentLabState {
  return {
    available: true,
    active: true,
    paused: false,
    replayMode: false,
    replayPaused: true,
    recording: true,
    agentCount,
    profile: "mixed",
    qualityTier: "desktop-medium",
    speed: 1,
    replaySpeed: 1,
    replayEndTick: 0,
    seed,
    tick: 0,
    checksum: "pending",
    debug: { ...defaultDebug }
  };
}

function nextSeedFrom(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function captureDimensions(
  source: HTMLCanvasElement,
  options: { width?: number; height?: number }
): { width: number; height: number } {
  const width = normalizeCaptureDimension(
    options.width,
    options.height === undefined ? source.width : Math.round(source.width * options.height / source.height)
  );
  const height = normalizeCaptureDimension(
    options.height,
    options.width === undefined ? source.height : Math.round(source.height * options.width / source.width)
  );
  if (width > source.width || height > source.height) {
    throw new Error(
      `Jugar 3D capture can downscale ${source.width}x${source.height}, but cannot claim an upscaled native frame`
    );
  }
  return { width, height };
}

function normalizeCaptureDimension(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) {
    throw new Error("Jugar 3D capture dimensions must be positive finite numbers");
  }
  return Math.round(value);
}

function createRecorder(
  game: PlaygroundGame,
  session: ReturnType<typeof useGameSession>,
  profile: PlaygroundAgentProfile,
  difficulty: GameDifficulty,
  durationMillis: number,
  playerCount: number
): ReplayRecorder<ReplayJsonValue> {
  return new ReplayRecorder({
    schemaVersion: REPLAY_SCHEMA_VERSION,
    gameId: game.manifest.id,
    gameVersion: "motion-levels-games-release",
    simulationVersion: "jugar-3d-fixed-step-1",
    brainVersions: game.createSessionController ? { product: "session-controller" } : {},
    seed: String(session.seed),
    tickRate: session.fps,
    config: { difficulty, durationMillis, playerCount, profile }
  });
}

function replayRecord(frame: SessionTrajectoryFrame): ReplayRecordFrame<ReplayJsonValue> {
  return {
    tick: frame.tick,
    actions: frame.agentDebug.map((debug) => ({
      agentId: String(debug.avatarId),
      action: {
        kind: "move",
        ...(debug.target ? { target: { ...debug.target } } : {}),
        path: debug.path.map((point) => ({ ...point })),
        explanation: debug.explanation
      }
    })),
    events: frame.state.events,
    agents: frame.avatars.map((avatar) => ({
      id: String(avatar.id),
      position: { ...avatar.position },
      facingRadians: avatar.target
        ? Math.atan2(avatar.target.x - avatar.position.x, avatar.target.y - avatar.position.y)
        : 0,
      action: avatar.target ? "move" : "idle",
      state: { playerIndex: avatar.playerIndex, isBot: avatar.isBot }
    })),
    state: trajectoryState(frame),
    authoritativeState: frame.state
  };
}

function trajectoryState(frame: SessionTrajectoryFrame) {
  return {
    state: frame.state,
    avatars: frame.avatars,
    agentDebug: frame.agentDebug
  };
}

function emptyReplay(
  game: PlaygroundGame,
  session: ReturnType<typeof useGameSession>
): GameReplay<ReplayJsonValue> {
  return {
    header: {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      gameId: game.manifest.id,
      gameVersion: "motion-levels-games-release",
      simulationVersion: "jugar-3d-fixed-step-1",
      brainVersions: {},
      seed: String(session.seed),
      tickRate: session.fps
    },
    frames: [],
    snapshots: []
  };
}
