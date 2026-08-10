import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Activity,
  CircleStop,
  Download,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  Video
} from "lucide-react";
import type { CharacterPerformanceReport, CharacterQualityTier } from "@motion-levels-games/character-runtime";
import { createAgentSceneRenderer, type AgentSceneRenderer } from "@motion-levels-games/three-renderer";
import type { GameDifficulty, GameEngine } from "@motion-levels-games/game-sdk";
import {
  AgentLabFrameTrajectory,
  advanceAgentLabHarness,
  agentLabProfiles,
  agentLabQualityTiers,
  nextAgentLabSeed,
  replayFileName,
  toAgentRenderSnapshot,
  toRendererDebugInput,
  type AgentLabDebugVisibility
} from "./agentLabModel.ts";
import type {
  PlaygroundAgentHarness,
  PlaygroundAgentHarnessFactory,
  PlaygroundAgentHarnessFrame,
  PlaygroundAgentProfile,
  PlaygroundRenderableAgent
} from "./gameRegistry.ts";
import type {
  AgentLabApi,
  AgentLabCapture,
  AgentLabDebugOptions,
  AgentLabState
} from "./playgroundApi.ts";

const fixedTickMillis = 20;
const maxCatchUpTicks = 20;
const defaultDebugVisibility: AgentLabDebugVisibility = Object.freeze({
  paths: true,
  reservations: true,
  targets: true
});

export type AgentLabController = Omit<AgentLabApi, "setActive">;

type AgentLabProps = {
  createHarness: PlaygroundAgentHarnessFactory;
  difficulty: GameDifficulty;
  hostPaused: boolean;
  seed: number;
  onController(controller: AgentLabController | null): void;
  onFrame(frame: PlaygroundAgentHarnessFrame, engine: GameEngine): void;
  onSeedChange(seed: number): void;
};

export function AgentLab({
  createHarness,
  difficulty,
  hostPaused,
  seed,
  onController,
  onFrame,
  onSeedChange
}: AgentLabProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<AgentSceneRenderer | undefined>(undefined);
  const rendererDisposalTimerRef = useRef<number | undefined>(undefined);
  const harnessRef = useRef<PlaygroundAgentHarness | undefined>(undefined);
  const liveHarnessRef = useRef<PlaygroundAgentHarness | undefined>(undefined);
  const liveHarnessFactoryRef = useRef<PlaygroundAgentHarnessFactory | undefined>(undefined);
  const liveHarnessSignatureRef = useRef("");
  const currentFrameRef = useRef<PlaygroundAgentHarnessFrame | undefined>(undefined);
  const createHarnessRef = useRef(createHarness);
  const onFrameRef = useRef(onFrame);
  const seedRef = useRef(seed);
  const difficultyRef = useRef(difficulty);
  const hostPausedRef = useRef(hostPaused);
  const [agentCount, setAgentCount] = useState(3);
  const agentCountRef = useRef(agentCount);
  const [profile, setProfile] = useState<PlaygroundAgentProfile>("mixed");
  const profileRef = useRef(profile);
  const [qualityTier, setQualityTier] = useState<CharacterQualityTier>("desktop-medium");
  const qualityTierRef = useRef(qualityTier);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(speed);
  const [runPaused, setRunPaused] = useState(false);
  const runPausedRef = useRef(runPaused);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const selectedAgentIdRef = useRef(selectedAgentId);
  const [debugVisibility, setDebugVisibility] = useState<AgentLabDebugVisibility>(defaultDebugVisibility);
  const debugVisibilityRef = useRef(debugVisibility);
  const [recording, setRecording] = useState(true);
  const recordingRef = useRef(recording);
  const [replayMode, setReplayMode] = useState(false);
  const replayModeRef = useRef(replayMode);
  const [replayPaused, setReplayPaused] = useState(true);
  const replayPausedRef = useRef(replayPaused);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const replaySpeedRef = useRef(replaySpeed);
  const [replayEndTick, setReplayEndTick] = useState(0);
  const replayEndTickRef = useRef(replayEndTick);
  const savedReplayRef = useRef<unknown>(undefined);
  const recordedFramesRef = useRef(new AgentLabFrameTrajectory());
  const seekReplayRef = useRef<(tick: number) => void>(() => undefined);
  const replayChecksumsRef = useRef(new Map<number, string>());
  const [replayVerified, setReplayVerified] = useState(true);
  const [performanceReport, setPerformanceReport] = useState<Readonly<CharacterPerformanceReport> | undefined>(undefined);
  const performanceRef = useRef<Readonly<CharacterPerformanceReport> | undefined>(undefined);
  const [frameVersion, setFrameVersion] = useState(0);
  const [rendererError, setRendererError] = useState<string>();
  const stateRef = useRef<AgentLabState>(emptyAgentLabState(seed));

  createHarnessRef.current = createHarness;
  onFrameRef.current = onFrame;
  seedRef.current = seed;
  difficultyRef.current = difficulty;
  hostPausedRef.current = hostPaused;

  const updatePublicState = useCallback(() => {
    const frame = currentFrameRef.current;
    stateRef.current = {
      available: true,
      active: true,
      paused: hostPausedRef.current || runPausedRef.current || (replayModeRef.current && replayPausedRef.current),
      replayMode: replayModeRef.current,
      replayPaused: replayPausedRef.current,
      recording: recordingRef.current,
      agentCount: agentCountRef.current,
      profile: profileRef.current,
      qualityTier: qualityTierRef.current,
      speed: speedRef.current,
      replaySpeed: replaySpeedRef.current,
      replayEndTick: replayEndTickRef.current,
      ...(selectedAgentIdRef.current ? { selectedAgentId: selectedAgentIdRef.current } : {}),
      seed: seedRef.current,
      tick: frame?.tick ?? 0,
      checksum: frame?.replay.checksum ?? "pending",
      debug: { ...debugVisibilityRef.current },
      ...(frame ? { metrics: { ...frame.metrics } } : {}),
      ...(performanceRef.current ? { performance: { ...performanceRef.current } } : {})
    };
  }, []);

  const applyFrame = useCallback((frame: PlaygroundAgentHarnessFrame, resetTimeline = false) => {
    currentFrameRef.current = frame;
    const renderer = rendererRef.current;
    if (renderer) {
      if (resetTimeline) {
        renderer.clearAgents();
        renderer.resetTimeline(true);
      }
      renderer.setFrame(frame.state.frame);
      frame.agents.forEach((agent, index) => renderer.pushAgentSnapshot(toAgentRenderSnapshot(frame, agent, index)));
      renderer.setDebugData(toRendererDebugInput(
        frame,
        debugVisibilityRef.current,
        selectedAgentIdRef.current
      ));
      renderer.render(frame.atMillis);
      const report = renderer.performanceReport();
      performanceRef.current = report;
      setPerformanceReport(report);
    }
    if (!selectedAgentIdRef.current || !frame.agents.some((agent) => agent.id === selectedAgentIdRef.current)) {
      const firstId = frame.agents[0]?.id;
      selectedAgentIdRef.current = firstId;
      setSelectedAgentId(firstId);
    }
    const expected = replayModeRef.current ? replayChecksumsRef.current.get(frame.tick) : undefined;
    if (expected !== undefined && expected !== frame.replay.checksum) setReplayVerified(false);
    updatePublicState();
    onFrameRef.current(frame, harnessRef.current?.engine ?? liveHarnessRef.current?.engine as GameEngine);
    setFrameVersion((current) => current + 1);
  }, [updatePublicState]);

  const harnessOptions = useCallback(() => ({
    seed: seedRef.current,
    profile: profileRef.current,
    agentCount: agentCountRef.current,
    difficulty: difficultyRef.current,
    playerCount: 0
  }), []);

  const harnessSignature = useCallback(() => [
    seedRef.current,
    difficultyRef.current,
    profileRef.current,
    agentCountRef.current
  ].join(":"), []);

  const createFreshHarness = useCallback((asLive = true) => {
    const harness = createHarnessRef.current(harnessOptions());
    harnessRef.current = harness;
    if (asLive) {
      liveHarnessRef.current = harness;
      liveHarnessFactoryRef.current = createHarnessRef.current;
      liveHarnessSignatureRef.current = harnessSignature();
      if (recordingRef.current) {
        recordedFramesRef.current.reset(harness.frame);
        savedReplayRef.current = undefined;
        replayChecksumsRef.current.clear();
        replayEndTickRef.current = 0;
        setReplayEndTick(0);
      }
    }
    applyFrame(harness.frame, true);
    return harness;
  }, [applyFrame, harnessOptions, harnessSignature]);

  const advanceLiveHarness = useCallback((ticks: number) => {
    const harness = harnessRef.current;
    if (!harness) return undefined;
    const finalFrame = advanceAgentLabHarness(harness, ticks, (frame) => {
      if (recordingRef.current) recordedFramesRef.current.append(frame);
    });
    applyFrame(finalFrame);
    return finalFrame;
  }, [applyFrame]);

  const showRecordedFrame = useCallback((tick: number, resetTimeline = false) => {
    const frame = recordedFramesRef.current.frameAtOrBefore(tick);
    if (frame !== undefined) applyFrame(frame, resetTimeline);
    return frame;
  }, [applyFrame]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return undefined;
    if (rendererDisposalTimerRef.current !== undefined) {
      window.clearTimeout(rendererDisposalTimerRef.current);
      rendererDisposalTimerRef.current = undefined;
    }
    let renderer = rendererRef.current;
    if (!renderer || renderer.disposed) {
      try {
        renderer = createAgentSceneRenderer({
          canvas,
          qualityTier: qualityTierRef.current,
          width: Math.max(1, viewport.clientWidth),
          height: Math.max(1, viewport.clientHeight)
        });
        setRendererError(undefined);
      } catch (error) {
        setRendererError(error instanceof Error ? error.message : "WebGL renderer unavailable");
        return undefined;
      }
      rendererRef.current = renderer;
    } else {
      renderer.resize(
        Math.max(1, viewport.clientWidth),
        Math.max(1, viewport.clientHeight),
        window.devicePixelRatio
      );
    }
    if (currentFrameRef.current) applyFrame(currentFrameRef.current, true);
    const resize = () => renderer.resize(
      Math.max(1, viewport.clientWidth),
      Math.max(1, viewport.clientHeight),
      window.devicePixelRatio
    );
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      rendererDisposalTimerRef.current = window.setTimeout(() => {
        if (rendererRef.current === renderer) rendererRef.current = undefined;
        renderer.dispose();
        rendererDisposalTimerRef.current = undefined;
      }, 0);
    };
  }, [applyFrame]);

  useEffect(() => {
    if (
      liveHarnessRef.current
      && liveHarnessFactoryRef.current === createHarnessRef.current
      && liveHarnessSignatureRef.current === harnessSignature()
    ) return;
    createFreshHarness(true);
  }, [createFreshHarness, createHarness, difficulty, harnessSignature, seed]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setQualityTier(qualityTier);
    if (currentFrameRef.current) applyFrame(currentFrameRef.current, true);
  }, [applyFrame, qualityTier]);

  useEffect(() => {
    if (!currentFrameRef.current || !rendererRef.current) return;
    rendererRef.current.setDebugData(toRendererDebugInput(
      currentFrameRef.current,
      debugVisibility,
      selectedAgentId
    ));
    rendererRef.current.render(currentFrameRef.current.atMillis);
  }, [debugVisibility, selectedAgentId]);

  useEffect(() => {
    let animationFrame = 0;
    let previous = window.performance.now();
    let accumulator = 0;
    const animate = (now: number) => {
      const delta = Math.min(250, Math.max(0, now - previous));
      previous = now;
      const isReplay = replayModeRef.current;
      const canAdvance = !hostPausedRef.current && (isReplay ? !replayPausedRef.current : !runPausedRef.current);
      if (canAdvance) {
        accumulator += delta * (isReplay ? replaySpeedRef.current : speedRef.current);
        const requestedTicks = Math.min(maxCatchUpTicks, Math.floor(accumulator / fixedTickMillis));
        if (requestedTicks > 0) {
          if (isReplay) {
            const currentTick = currentFrameRef.current?.tick ?? recordedFramesRef.current.firstTick ?? 0;
            const targetTick = Math.min(replayEndTickRef.current, currentTick + requestedTicks);
            const advancedTicks = Math.max(0, targetTick - currentTick);
            if (advancedTicks > 0) showRecordedFrame(targetTick);
            accumulator -= advancedTicks * fixedTickMillis;
            if (targetTick >= replayEndTickRef.current) {
              replayPausedRef.current = true;
              setReplayPaused(true);
              accumulator = 0;
            }
          } else {
            advanceLiveHarness(requestedTicks);
            accumulator -= requestedTicks * fixedTickMillis;
          }
          if (requestedTicks >= maxCatchUpTicks) accumulator = 0;
        }
      }
      const frame = currentFrameRef.current;
      if (frame && rendererRef.current) rendererRef.current.render(frame.atMillis);
      updatePublicState();
      animationFrame = window.requestAnimationFrame(animate);
    };
    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [advanceLiveHarness, showRecordedFrame, updatePublicState]);

  const setRunPausedState = useCallback((paused: boolean) => {
    runPausedRef.current = paused;
    setRunPaused(paused);
    updatePublicState();
  }, [updatePublicState]);

  const setAgentCountState = useCallback((count: number) => {
    const normalized = Math.max(1, Math.min(10, Math.round(count)));
    agentCountRef.current = normalized;
    setAgentCount(normalized);
    replayModeRef.current = false;
    setReplayMode(false);
    createFreshHarness(true);
    updatePublicState();
  }, [createFreshHarness, updatePublicState]);

  const setProfileState = useCallback((nextProfile: PlaygroundAgentProfile) => {
    if (!agentLabProfiles.includes(nextProfile)) throw new Error(`Unknown Agent Lab profile: ${nextProfile}`);
    profileRef.current = nextProfile;
    setProfile(nextProfile);
    replayModeRef.current = false;
    setReplayMode(false);
    createFreshHarness(true);
    updatePublicState();
  }, [createFreshHarness, updatePublicState]);

  const setQualityTierState = useCallback((tier: CharacterQualityTier) => {
    if (!agentLabQualityTiers.includes(tier)) throw new Error(`Unknown Agent Lab quality tier: ${tier}`);
    qualityTierRef.current = tier;
    setQualityTier(tier);
    updatePublicState();
  }, [updatePublicState]);

  const setSpeedState = useCallback((nextSpeed: number) => {
    const normalized = clampSpeed(nextSpeed);
    speedRef.current = normalized;
    setSpeed(normalized);
    updatePublicState();
  }, [updatePublicState]);

  const selectAgentState = useCallback((agentId?: string) => {
    if (agentId && !currentFrameRef.current?.agents.some((agent) => agent.id === agentId)) {
      throw new Error(`Unknown Agent Lab agent: ${agentId}`);
    }
    selectedAgentIdRef.current = agentId;
    setSelectedAgentId(agentId);
    updatePublicState();
  }, [updatePublicState]);

  const setDebugState = useCallback((options: AgentLabDebugOptions) => {
    const next = {
      paths: options.paths ?? debugVisibilityRef.current.paths,
      reservations: options.reservations ?? debugVisibilityRef.current.reservations,
      targets: options.targets ?? debugVisibilityRef.current.targets
    };
    debugVisibilityRef.current = next;
    setDebugVisibility(next);
    updatePublicState();
  }, [updatePublicState]);

  const finalizeRecording = useCallback((harness: PlaygroundAgentHarness) => {
    if (recordedFramesRef.current.length === 0) recordedFramesRef.current.reset(harness.frame);
    savedReplayRef.current = harness.finishReplay();
    const endTick = recordedFramesRef.current.endTick ?? harness.frame.tick;
    replayEndTickRef.current = endTick;
    replayChecksumsRef.current = recordedFramesRef.current.checksumMap();
    recordingRef.current = false;
    setReplayEndTick(endTick);
    setRecording(false);
  }, []);

  const exitReplay = useCallback(() => {
    replayModeRef.current = false;
    replayPausedRef.current = true;
    setReplayMode(false);
    setReplayPaused(true);
    const live = liveHarnessRef.current ?? createFreshHarness(true);
    harnessRef.current = live;
    applyFrame(live.frame, true);
  }, [applyFrame, createFreshHarness]);

  const resetLab = useCallback((options: { newSeed?: boolean } = {}) => {
    if (options.newSeed) {
      const next = nextAgentLabSeed(seedRef.current);
      seedRef.current = next;
      onSeedChange(next);
    }
    replayModeRef.current = false;
    replayPausedRef.current = true;
    setReplayMode(false);
    setReplayPaused(true);
    recordingRef.current = true;
    setRecording(true);
    replayChecksumsRef.current.clear();
    setReplayVerified(true);
    createFreshHarness(true);
  }, [createFreshHarness, onSeedChange]);

  const step = useCallback((ticks = 1) => {
    const normalized = Math.max(1, Math.min(1_000, Math.round(ticks)));
    if (replayModeRef.current) {
      const target = Math.min(replayEndTickRef.current, (currentFrameRef.current?.tick ?? 0) + normalized);
      seekReplayRef.current(target);
      return;
    }
    advanceLiveHarness(normalized);
  }, [advanceLiveHarness]);

  const startRecording = useCallback(() => {
    if (replayModeRef.current) exitReplay();
    recordingRef.current = true;
    setRecording(true);
    createFreshHarness(true);
    updatePublicState();
  }, [createFreshHarness, exitReplay, updatePublicState]);

  const stopRecording = useCallback(() => {
    const harness = harnessRef.current;
    if (harness && recordingRef.current) finalizeRecording(harness);
    updatePublicState();
  }, [finalizeRecording, updatePublicState]);

  const exportReplay = useCallback(() => {
    const replay = savedReplayRef.current ?? harnessRef.current?.finishReplay();
    if (!replay) throw new Error("Agent Lab has no replay to export");
    return JSON.stringify(replay, null, 2);
  }, []);

  const enterReplay = useCallback(() => {
    if (replayModeRef.current) return;
    const live = liveHarnessRef.current ?? harnessRef.current;
    if (!live) return;
    liveHarnessRef.current = live;
    harnessRef.current = live;
    if (recordingRef.current) finalizeRecording(live);
    if (recordedFramesRef.current.length === 0) {
      recordedFramesRef.current.reset(live.frame);
      savedReplayRef.current = live.finishReplay();
      replayEndTickRef.current = live.frame.tick;
      replayChecksumsRef.current = recordedFramesRef.current.checksumMap();
      setReplayEndTick(live.frame.tick);
    }
    replayModeRef.current = true;
    replayPausedRef.current = true;
    setReplayMode(true);
    setReplayPaused(true);
    setReplayVerified(true);
    showRecordedFrame(recordedFramesRef.current.firstTick ?? 0, true);
  }, [finalizeRecording, showRecordedFrame]);

  const seekReplay = useCallback((tick: number) => {
    if (!replayModeRef.current) enterReplay();
    const target = Math.max(0, Math.min(replayEndTickRef.current, Math.round(tick)));
    showRecordedFrame(target, true);
  }, [enterReplay, showRecordedFrame]);
  seekReplayRef.current = seekReplay;

  const setReplayPausedState = useCallback((paused: boolean) => {
    if (!replayModeRef.current && !paused) enterReplay();
    replayPausedRef.current = paused;
    setReplayPaused(paused);
    updatePublicState();
  }, [enterReplay, updatePublicState]);

  const setReplaySpeedState = useCallback((nextSpeed: number) => {
    const normalized = clampSpeed(nextSpeed);
    replaySpeedRef.current = normalized;
    setReplaySpeed(normalized);
    updatePublicState();
  }, [updatePublicState]);

  const capture = useCallback(async (options: { width?: number; height?: number } = {}): Promise<AgentLabCapture> => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    const viewport = viewportRef.current;
    const frame = currentFrameRef.current;
    if (!canvas || !renderer || !viewport || !frame) throw new Error("Agent Lab renderer is not ready");
    const width = captureDimension(options.width, 1_920);
    const height = captureDimension(options.height, 1_080);
    const restoreWidth = Math.max(1, viewport.clientWidth);
    const restoreHeight = Math.max(1, viewport.clientHeight);
    try {
      renderer.resize(width, height, 1);
      renderer.render(frame.atMillis);
      if (canvas.width !== width || canvas.height !== height) {
        throw new Error(`Agent Lab capture buffer is ${canvas.width}x${canvas.height}; expected ${width}x${height}`);
      }
      return { surface: "agents3d", width, height, dataUrl: canvas.toDataURL("image/png") };
    } finally {
      renderer.resize(restoreWidth, restoreHeight, window.devicePixelRatio);
      renderer.render(frame.atMillis);
    }
  }, []);

  const controller = useMemo<AgentLabController>(() => ({
    getState: () => stateRef.current,
    play: () => setRunPausedState(false),
    pause: () => setRunPausedState(true),
    step,
    reset: resetLab,
    setAgentCount: setAgentCountState,
    setProfile: setProfileState,
    setQualityTier: setQualityTierState,
    setSpeed: setSpeedState,
    selectAgent: selectAgentState,
    setDebug: setDebugState,
    startRecording,
    stopRecording,
    exportReplay,
    replay: {
      enter: enterReplay,
      exit: exitReplay,
      play: () => setReplayPausedState(false),
      pause: () => setReplayPausedState(true),
      seek: seekReplay,
      setSpeed: setReplaySpeedState
    },
    capture
  }), [
    capture,
    enterReplay,
    exitReplay,
    exportReplay,
    resetLab,
    seekReplay,
    selectAgentState,
    setAgentCountState,
    setDebugState,
    setProfileState,
    setQualityTierState,
    setReplayPausedState,
    setReplaySpeedState,
    setRunPausedState,
    setSpeedState,
    startRecording,
    step,
    stopRecording
  ]);

  useEffect(() => {
    onController(controller);
    return () => onController(null);
  }, [controller, onController]);

  useEffect(() => {
    updatePublicState();
  }, [agentCount, debugVisibility, hostPaused, profile, qualityTier, recording, replayMode, replayPaused, replaySpeed, runPaused, selectedAgentId, speed, updatePublicState]);

  const frame = currentFrameRef.current;
  const selectedAgent = frame?.agents.find((agent) => agent.id === selectedAgentId) ?? frame?.agents[0];
  const metrics = frame?.metrics;
  const replayTick = frame?.tick ?? 0;
  const effectivePaused = hostPaused || (replayMode ? replayPaused : runPaused);

  return (
    <section className="agent-lab" data-testid="agent-lab" aria-label="Cruce Galáctico 3D Agent Lab">
      <div className="agent-lab-viewport" ref={viewportRef}>
        <canvas
          aria-label={`3D simulation of ${agentCount} deterministic Cruce Galáctico agents`}
          className="agent-lab-canvas"
          data-agent-lab-capture="1920x1080"
          ref={canvasRef}
          role="img"
        />
        {rendererError ? (
          <p className="agent-lab-renderer-error" role="alert">
            The deterministic simulation is running, but this browser could not start WebGL.
            <small>{rendererError}</small>
          </p>
        ) : null}
        <div className="agent-lab-hud" aria-live="polite">
          <span><i className={effectivePaused ? "is-paused" : "is-live"} />{replayMode ? "Replay" : "Live"}</span>
          <code>seed {seed}</code>
          <code>tick {replayTick}</code>
          <code>{frame?.replay.checksum ?? "--------"}</code>
        </div>
        <div className="agent-lab-metrics" aria-label="Agent simulation metrics">
          <Metric label="Score" value={metrics?.score ?? 0} />
          <Metric label="Hits" value={metrics?.collisions ?? 0} />
          <Metric label="Replans" value={metrics?.replans ?? 0} />
          <Metric label="Routes" value={formatMetric(metrics?.routeDiversity)} />
        </div>
      </div>

      <aside className="agent-lab-console" aria-label="Agent Lab controls">
        <div className="agent-lab-console-heading">
          <div>
            <span>Deterministic vertical slice</span>
            <strong>Cruce Agent Lab</strong>
          </div>
          <span className={`agent-budget-badge ${performanceReport?.withinBudget === false ? "is-over" : ""}`}>
            <Gauge size={13} aria-hidden="true" />
            {performanceReport?.withinBudget === false ? "Over budget" : "Within budget"}
          </span>
        </div>

        <div className="agent-lab-control-grid">
          <label>
            <span>Agents</span>
            <input
              aria-label="Agent count"
              max={10}
              min={1}
              onChange={(event) => setAgentCountState(Number(event.target.value))}
              type="number"
              value={agentCount}
            />
          </label>
          <label>
            <span>Profiles</span>
            <select onChange={(event) => setProfileState(event.target.value as PlaygroundAgentProfile)} value={profile}>
              {agentLabProfiles.map((entry) => <option key={entry} value={entry}>{label(entry)}</option>)}
            </select>
          </label>
          <label>
            <span>Quality</span>
            <select onChange={(event) => setQualityTierState(event.target.value as CharacterQualityTier)} value={qualityTier}>
              {agentLabQualityTiers.map((tier) => <option key={tier} value={tier}>{label(tier)}</option>)}
            </select>
          </label>
          <label>
            <span>Speed</span>
            <select onChange={(event) => setSpeedState(Number(event.target.value))} value={speed}>
              {speedOptions.map((entry) => <option key={entry} value={entry}>{entry}×</option>)}
            </select>
          </label>
        </div>

        <div className="agent-lab-button-row" role="group" aria-label="Live simulation controls">
          <button onClick={() => setRunPausedState(!runPaused)} type="button">
            {runPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
            {runPaused ? "Play" : "Pause"}
          </button>
          <button aria-label="Advance one fixed tick" onClick={() => step(1)} type="button">
            <StepForward size={14} aria-hidden="true" /> Tick
          </button>
          <button onClick={() => resetLab()} type="button"><RotateCcw size={14} aria-hidden="true" /> Same seed</button>
          <button onClick={() => resetLab({ newSeed: true })} type="button">New seed</button>
        </div>

        <fieldset className="agent-debug-options">
          <legend>Debug overlay</legend>
          {(["paths", "reservations", "targets"] as const).map((key) => (
            <label key={key}>
              <input
                checked={debugVisibility[key]}
                onChange={(event) => setDebugState({ [key]: event.target.checked })}
                type="checkbox"
              />
              <span>{label(key)}</span>
            </label>
          ))}
        </fieldset>

        <label className="agent-selection">
          <span>Inspect agent</span>
          <select onChange={(event) => selectAgentState(event.target.value || undefined)} value={selectedAgent?.id ?? ""}>
            {frame?.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.id} · {agent.profileId}</option>
            ))}
          </select>
        </label>

        <AgentInspector agent={selectedAgent} />

        <section className="agent-replay-controls" aria-label="Replay controls">
          <div className="agent-replay-heading">
            <span><Activity size={13} aria-hidden="true" /> Replay</span>
            <code>{replayVerified ? "checksum verified" : "checksum mismatch"}</code>
          </div>
          <div className="agent-lab-button-row">
            <button onClick={recording ? stopRecording : startRecording} type="button">
              {recording ? <CircleStop size={14} aria-hidden="true" /> : <Video size={14} aria-hidden="true" />}
              {recording ? "Stop" : "Record"}
            </button>
            <button onClick={replayMode ? exitReplay : enterReplay} type="button">
              {replayMode ? "Return live" : "Open replay"}
            </button>
            <button onClick={() => downloadReplay(exportReplay(), replayFileName(seedRef.current))} type="button">
              <Download size={14} aria-hidden="true" /> Export
            </button>
          </div>
          {replayMode ? (
            <div className="agent-replay-timeline">
              <button aria-label={replayPaused ? "Play replay" : "Pause replay"} onClick={() => setReplayPausedState(!replayPaused)} type="button">
                {replayPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
              </button>
              <input
                aria-label="Replay tick"
                max={Math.max(0, replayEndTick)}
                min={0}
                onChange={(event) => seekReplay(Number(event.target.value))}
                type="range"
                value={Math.min(replayTick, replayEndTick)}
              />
              <code>{replayTick}/{replayEndTick}</code>
              <select aria-label="Replay speed" onChange={(event) => setReplaySpeedState(Number(event.target.value))} value={replaySpeed}>
                {speedOptions.map((entry) => <option key={entry} value={entry}>{entry}×</option>)}
              </select>
            </div>
          ) : null}
        </section>

        <div className="agent-performance-report">
          <span>Renderer</span>
          <code>{formatMetric(performanceReport?.p95FrameMillis)} ms p95</code>
          <code>{performanceReport?.maxDrawCalls ?? 0} draws</code>
          <code>{performanceReport?.maxTriangles ?? 0} tris</code>
        </div>
      </aside>
      <span className="sr-only" aria-live="polite">Agent frame {frameVersion}</span>
    </section>
  );
}

function AgentInspector({ agent }: { agent?: PlaygroundRenderableAgent }) {
  if (!agent) return <p className="agent-inspector-empty">Waiting for the first authoritative agent snapshot.</p>;
  return (
    <dl className="agent-inspector">
      <div><dt>Identity</dt><dd>{agent.id} · {agent.profileId}</dd></div>
      <div><dt>Intention</dt><dd>{agent.intention ?? "Waiting"}</dd></div>
      <div><dt>Target</dt><dd>{agent.targetId ?? formatPoint(agent.target)}</dd></div>
      <div><dt>Path</dt><dd>{agent.debug.path.length} tiles</dd></div>
      <div><dt>Utility</dt><dd>{formatMetric(agent.debug.utility)}</dd></div>
      <div><dt>Replans</dt><dd>{agent.debug.replans} · {agent.debug.stuckReplans} stuck</dd></div>
      <div className="agent-inspector-explanation"><dt>Why</dt><dd>{agent.debug.explanation}</dd></div>
    </dl>
  );
}

function Metric({ label: metricLabel, value }: { label: string; value: string | number }) {
  return <span><small>{metricLabel}</small><strong>{value}</strong></span>;
}

function emptyAgentLabState(seed: number): AgentLabState {
  return {
    available: true,
    active: true,
    paused: true,
    replayMode: false,
    replayPaused: true,
    recording: true,
    agentCount: 3,
    profile: "mixed",
    qualityTier: "desktop-medium",
    speed: 1,
    replaySpeed: 1,
    replayEndTick: 0,
    seed,
    tick: 0,
    checksum: "pending",
    debug: { ...defaultDebugVisibility }
  };
}

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Agent Lab speed must be finite");
  return Math.max(0.25, Math.min(4, value));
}

function captureDimension(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate) || candidate < 1 || candidate > 8_192) {
    throw new Error("Agent Lab capture dimensions must be between 1 and 8192 pixels");
  }
  return Math.round(candidate);
}

function downloadReplay(serialized: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([serialized], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.download = fileName;
  anchor.href = url;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function label(value: string): string {
  return value.split("-").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function formatMetric(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(value >= 10 ? 0 : 2);
}

function formatPoint(point?: Readonly<{ x: number; y: number }>): string {
  return point ? `${point.x}, ${point.y}` : "—";
}

const speedOptions = [0.25, 0.5, 1, 2, 4] as const;
