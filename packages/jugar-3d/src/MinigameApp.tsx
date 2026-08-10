"use client";

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";

import { useCharacterChoice } from "./characters/useCharacterChoice.ts";
import type {
  GameEntry,
  JugarRunFinished,
  JugarRunStarted,
  RegisteredGame
} from "./contracts.ts";
import type { SessionOptions } from "./core/session.ts";
import { useGameSession } from "./core/useGameSession.ts";
import { GamePicker } from "./ui/GamePicker.tsx";
import { Hud } from "./ui/Hud.tsx";
import { LoadingScreen } from "./ui/LoadingScreen.tsx";

const Stage = lazy(() => import("./scene/Stage.tsx"));

type Screen =
  | { kind: "picker" }
  | { kind: "loading"; entry: GameEntry; options: SessionOptions; runId: number }
  | { kind: "play"; game: RegisteredGame; options: SessionOptions; runId: number };

/**
 * The playable Motion Levels browser experience. Ported from
 * `motionlevels/motion-levels-minigame` (the reference implementation of this
 * web runtime); game logic itself always comes from the vendored
 * pinned motion-levels-games checkout, never from here.
 */
export type Jugar3DAppProps = Readonly<{
  entries: readonly GameEntry[];
  sahurModelUrl?: string;
  captureFrames?: boolean;
  exposeDebug?: boolean;
  onRunStarted?(run: JugarRunStarted): void;
  onRunFinished?(run: JugarRunFinished): void;
}>;

export function Jugar3DApp({
  entries,
  sahurModelUrl = "/models/tung-tung-tung-sahur.glb",
  captureFrames = false,
  exposeDebug = false,
  onRunStarted,
  onRunFinished
}: Jugar3DAppProps) {
  const [screen, setScreen] = useState<Screen>({ kind: "picker" });
  const [characterId, setCharacterId] = useCharacterChoice();

  const handlePlay = useCallback(
    (entry: GameEntry, options: SessionOptions) => {
      onRunStarted?.({
        gameId: entry.manifest.id,
        playerCount: options.playerCount,
        difficulty: options.difficulty ?? "medium"
      });
      setScreen((current) => ({
        kind: "loading",
        entry,
        options,
        runId: "runId" in current ? current.runId + 1 : 1,
      }));
    },
    [onRunStarted],
  );

  const handleExit = useCallback(() => setScreen({ kind: "picker" }), []);

  // Loading and play are "game mode": the page cannot scroll, the game owns
  // the whole viewport, and Escape (or the exit button) leaves it.
  const inGameMode = screen.kind !== "picker";
  useEffect(() => {
    if (!inGameMode) {
      return;
    }
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    const previousOverscroll = html.style.overscrollBehavior;
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleExit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      html.style.overflow = previousOverflow;
      html.style.overscrollBehavior = previousOverscroll;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [inGameMode, handleExit]);

  // Game logic and its player display are only fetched once a game is chosen.
  useEffect(() => {
    if (screen.kind !== "loading") {
      return;
    }
    let cancelled = false;
    screen.entry
      .load()
      .then((game) => {
        if (!cancelled) {
          setScreen({ kind: "play", game, options: screen.options, runId: screen.runId });
        }
      })
      .catch((error: unknown) => {
        console.error("Could not load the game", error);
        if (!cancelled) {
          setScreen({ kind: "picker" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [screen]);

  if (screen.kind === "picker") {
    return (
      <div className="mlg">
        <GamePicker
          characterId={characterId}
          entries={entries}
          onCharacterChange={setCharacterId}
          onPlay={handlePlay}
        />
      </div>
    );
  }

  if (screen.kind === "loading") {
    return (
      <div className="mlg mlg-gamemode">
        <LoadingScreen label={`Cargando ${screen.entry.manifest.label}…`} />
      </div>
    );
  }

  return (
    <PlayScreen
      characterId={characterId}
      captureFrames={captureFrames}
      exposeDebug={exposeDebug}
      game={screen.game}
      key={`${screen.game.manifest.id}-${screen.runId}`}
      onExit={handleExit}
      onRunFinished={onRunFinished}
      options={screen.options}
      sahurModelUrl={sahurModelUrl}
    />
  );
}

function PlayScreen({
  characterId,
  captureFrames,
  exposeDebug,
  game,
  options,
  onExit,
  onRunFinished,
  sahurModelUrl
}: {
  characterId: string;
  captureFrames: boolean;
  exposeDebug: boolean;
  game: RegisteredGame;
  options: SessionOptions;
  onExit: () => void;
  onRunFinished?: (run: JugarRunFinished) => void;
  sahurModelUrl: string;
}) {
  const session = useGameSession(game, options, { exposeOnWindow: exposeDebug });
  useRunFinished(session, onRunFinished);
  return (
    <div className="mlg mlg-gamemode">
      <div className="play-screen">
        <Suspense fallback={<LoadingScreen label="Preparando el suelo…" />}>
          <Stage
            captureFrames={captureFrames}
            characterId={characterId}
            exposeFitDebug={exposeDebug}
            sahurModelUrl={sahurModelUrl}
            session={session}
          />
        </Suspense>
        <Hud onExit={onExit} session={session} />
      </div>
    </div>
  );
}

function useRunFinished(
  session: ReturnType<typeof useGameSession>,
  onRunFinished: ((run: JugarRunFinished) => void) | undefined
): void {
  const reported = useRef(false);
  useEffect(() => {
    reported.current = false;
    return session.subscribe(() => {
      const snapshot = session.state.snapshot;
      if (String(snapshot.phase) !== "finished") {
        reported.current = false;
        return;
      }
      if (reported.current || onRunFinished === undefined) return;
      reported.current = true;
      onRunFinished({
        gameId: session.game.manifest.id,
        score: snapshot.score,
        success: snapshot.success
      });
    });
  }, [onRunFinished, session]);
}
