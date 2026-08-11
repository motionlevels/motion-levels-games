"use client";

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { GameSnapshot } from "@motion-levels-games/game-sdk";

import { useCharacterChoice } from "./characters/useCharacterChoice.ts";
import type { JugarCatalogRenderer } from "./catalog.ts";
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
  | { kind: "error"; entry: GameEntry; options: SessionOptions; runId: number; message: string }
  | { kind: "play"; game: RegisteredGame; options: SessionOptions; runId: number };

/**
 * The playable Motion Levels browser experience. Ported from
 * `motionlevels/motion-levels-minigame` (the reference implementation of this
 * web runtime); game logic itself always comes from the vendored
 * pinned motion-levels-games checkout, never from here.
 */
export type Jugar3DAppProps = Readonly<{
  entries: readonly GameEntry[];
  /** Optional host catalog UI. Jugar still owns selection, setup and play. */
  catalogRenderer?: JugarCatalogRenderer;
  sahurModelUrl?: string;
  captureFrames?: boolean;
  exposeDebug?: boolean;
  onRunStarted?(run: JugarRunStarted): void;
  onRunFinished?(run: JugarRunFinished): void;
}>;

export function Jugar3DApp({
  entries,
  catalogRenderer,
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
      setScreen((current) => ({
        kind: "loading",
        entry,
        options,
        runId: "runId" in current ? current.runId + 1 : 1,
      }));
    },
    [],
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
    loadGameEntry(screen.entry, screen.options)
      .then(({ game, options }) => {
        if (!cancelled) {
          onRunStarted?.({
            gameId: screen.entry.manifest.id,
            playerCount: options.playerCount,
            difficulty: options.difficulty ?? "medium",
            ...(options.contentSelection?.levelId ? { levelId: options.contentSelection.levelId } : {}),
            ...(options.contentSelection?.mode ? { mode: options.contentSelection.mode } : {})
          });
          setScreen({ kind: "play", game, options, runId: screen.runId });
        }
      })
      .catch((error: unknown) => {
        console.error("Could not load the game", error);
        if (!cancelled) {
          setScreen({
            kind: "error",
            entry: screen.entry,
            options: screen.options,
            runId: screen.runId,
            message: error instanceof Error ? error.message : "No se pudo preparar el juego."
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onRunStarted, screen]);

  if (screen.kind === "picker") {
    return (
      <div className="mlg">
        <GamePicker
          catalogRenderer={catalogRenderer}
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

  if (screen.kind === "error") {
    return (
      <div className="mlg mlg-gamemode">
        <main className="load-error" role="alert">
          <p>No se pudo cargar {screen.entry.manifest.label}</p>
          <strong>{screen.message}</strong>
          <div>
            <button
              onClick={() => setScreen({
                kind: "loading",
                entry: screen.entry,
                options: screen.options,
                runId: screen.runId + 1
              })}
              type="button"
            >
              Reintentar
            </button>
            <button onClick={handleExit} type="button">Volver a juegos</button>
          </div>
        </main>
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

export async function loadGameEntry(
  entry: GameEntry,
  options: SessionOptions
): Promise<{ game: RegisteredGame; options: SessionOptions }> {
  const contentPromise = entry.contentSource
    ? options.contentSelection
      ? entry.contentSource.load(options.contentSelection)
      : Promise.reject(new Error("Falta la selección del nivel."))
    : Promise.resolve(undefined);
  const [game, content] = await Promise.all([entry.load(), contentPromise]);
  return {
    game,
    options: content ? { ...options, gameContent: content } : options
  };
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
      onRunFinished(jugarRunFinishedPayload(
        session.game.manifest.id,
        session.options.contentSelection,
        snapshot
      ));
    });
  }, [onRunFinished, session]);
}

export function jugarRunFinishedPayload(
  gameId: string,
  selection: SessionOptions["contentSelection"],
  snapshot: Pick<GameSnapshot, "score" | "success"> & { readonly level?: unknown }
): JugarRunFinished {
  const authoritativeLevelId = typeof snapshot.level === "string" && snapshot.level.trim().length > 0
    ? snapshot.level
    : selection?.levelId;
  return {
    gameId,
    ...(authoritativeLevelId ? { levelId: authoritativeLevelId } : {}),
    ...(selection?.mode ? { mode: selection.mode } : {}),
    score: snapshot.score,
    success: snapshot.success
  };
}
