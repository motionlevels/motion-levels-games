"use client";

import {
  defaultGamePlayerCount,
  gameDifficultyOptions,
  gamePlayerCountOptions,
  normalizeGameDifficulty,
  type GameDifficulty,
  type GameManifest
} from "@motion-levels-games/game-sdk";
import {
  ArrowRight,
  Check,
  CircleUserRound,
  Clock3,
  Play,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { soundBank } from "../audio/sfx.ts";
import { findCharacter } from "../characters/catalog.ts";
import type {
  JugarCatalogEntry,
  JugarCatalogPresentation,
  JugarCatalogRenderer,
  JugarCatalogRenderProps
} from "../catalog.ts";
import type { GameEntry, GameLevelChoice } from "../contracts.ts";
import type { SessionOptions } from "../core/session.ts";
import { CharacterPicker } from "./CharacterPicker.tsx";

type Props = {
  entries: readonly GameEntry[];
  onPlay: (game: GameEntry, options: SessionOptions) => void;
  characterId: string;
  onCharacterChange: (id: string) => void;
  catalogRenderer?: JugarCatalogRenderer;
};

export type JugarCatalogSelection = Readonly<{
  entry: GameEntry;
  presentation?: JugarCatalogPresentation;
}>;

const categoryLabels: Record<string, string> = {
  individual: "Individual",
  arcade: "Arcade",
  team: "Equipo",
  versus: "Versus"
};

const difficultyLabels: Record<string, string> = {
  easy: "Fácil",
  medium: "Media",
  hard: "Difícil",
  expert: "Experta"
};

export function GamePicker({
  entries,
  onPlay,
  characterId,
  onCharacterChange,
  catalogRenderer
}: Props) {
  const [selection, setSelection] = useState<JugarCatalogSelection | null>(null);
  const [characterOpen, setCharacterOpen] = useState(false);

  const selected = useMemo(
    () => selection === null
      ? null
      : resolveCatalogSelection(entries, selection.entry.manifest.id, selection.presentation),
    [entries, selection]
  );

  const catalogEntries = useMemo(() => projectCatalogEntries(entries), [entries]);
  const character = useMemo(() => ({
    id: characterId,
    label: findCharacter(characterId).label
  }), [characterId]);
  const handleSelect = useCallback((id: string, presentation?: JugarCatalogPresentation) => {
    const nextSelection = resolveCatalogSelection(entries, id, presentation);
    if (!nextSelection) return;
    soundBank.unlock();
    soundBank.ui();
    setSelection(nextSelection);
  }, [entries]);
  const handleOpenCharacterPicker = useCallback(() => {
    soundBank.unlock();
    soundBank.ui();
    setCharacterOpen(true);
  }, []);

  return (
    <GamePickerFrame
      catalogEntries={catalogEntries}
      catalogRenderer={catalogRenderer}
      character={character}
      characterOpen={characterOpen}
      onCharacterChange={onCharacterChange}
      onCloseCharacter={() => setCharacterOpen(false)}
      onCloseGame={() => setSelection(null)}
      onOpenCharacterPicker={handleOpenCharacterPicker}
      onPlay={onPlay}
      onSelect={handleSelect}
      selected={selected}
    />
  );
}

type GamePickerFrameProps = Readonly<{
  catalogEntries: readonly JugarCatalogEntry[];
  catalogRenderer?: JugarCatalogRenderer;
  character: JugarCatalogRenderProps["character"];
  characterOpen: boolean;
  onCharacterChange(id: string): void;
  onCloseCharacter(): void;
  onCloseGame(): void;
  onOpenCharacterPicker(): void;
  onPlay: Props["onPlay"];
  onSelect(id: string, presentation?: JugarCatalogPresentation): void;
  selected: JugarCatalogSelection | null;
}>;

/** Internal controlled composition exported only for focused package tests. */
export function GamePickerFrame({
  catalogEntries,
  catalogRenderer,
  character,
  characterOpen,
  onCharacterChange,
  onCloseCharacter,
  onCloseGame,
  onOpenCharacterPicker,
  onPlay,
  onSelect,
  selected
}: GamePickerFrameProps) {
  const CatalogRenderer = catalogRenderer ?? DefaultCatalogRenderer;

  return (
    <div className="picker">
      <CatalogRenderer
        character={character}
        entries={catalogEntries}
        onOpenCharacterPicker={onOpenCharacterPicker}
        onSelect={onSelect}
      />

      {selected ? (
        <GameDialog
          game={selected.entry}
          onClose={onCloseGame}
          onPlay={onPlay}
          presentation={selected.presentation}
        />
      ) : null}

      {characterOpen ? (
        <CharacterPicker
          characterId={character.id}
          onClose={onCloseCharacter}
          onSelect={onCharacterChange}
        />
      ) : null}
    </div>
  );
}

function DefaultCatalogRenderer({
  entries,
  character,
  onOpenCharacterPicker,
  onSelect
}: JugarCatalogRenderProps) {
  return (
    <>
      <header className="picker-header">
        <div>
          <p className="picker-label">Juegos disponibles</p>
          <p className="picker-hint">
            {entries.length} modos listos para jugar en el navegador
          </p>
        </div>

        <button
          className="character-trigger"
          onClick={onOpenCharacterPicker}
          title="Cambiar personaje"
          type="button"
        >
          <CircleUserRound aria-hidden="true" />
          <span>Personaje</span>
          <strong>{character.label}</strong>
        </button>
      </header>

      <ul className="picker-grid">
        {entries.map(({ id, manifest }) => {
          const accent = manifest.catalog.color;
          return (
            <li key={id}>
              <button
                className="game-card"
                onClick={() => onSelect(id)}
                style={{ "--accent": accent } as React.CSSProperties}
                type="button"
              >
                <span className="game-card-glow" aria-hidden="true" />
                <span className="game-card-topline">
                  <span className="game-card-category">
                    {categoryLabels[manifest.catalog.category] ?? manifest.catalog.category}
                    {!manifest.availability.production ? <em>Lab</em> : null}
                  </span>
                  <ArrowRight aria-hidden="true" className="game-card-arrow" />
                </span>
                <strong className="game-card-title">{manifest.label}</strong>
                <span className="game-card-mode">{manifest.catalog.modeLabel}</span>
                <span className="game-card-meta">
                  <span><UsersRound aria-hidden="true" />{playersLabel(manifest)}</span>
                  <span><Clock3 aria-hidden="true" />{manifest.catalog.durationLabel}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function GameDialog({
  game,
  onClose,
  onPlay,
  presentation
}: {
  game: GameEntry;
  onClose: () => void;
  onPlay: Props["onPlay"];
  presentation?: JugarCatalogPresentation;
}) {
  const { manifest } = game;
  const catalog = resolveGameDialogPresentation(manifest, presentation);
  const accent = catalog.color;
  const difficulties = gameDifficultyOptions(manifest);
  const playerCounts = gamePlayerCountOptions(manifest).filter((count) => count > 0);

  const [difficulty, setDifficulty] = useState<GameDifficulty>(
    normalizeGameDifficulty(undefined, manifest)
  );
  const [playerCount, setPlayerCount] = useState(() => {
    const preferred = defaultGamePlayerCount(manifest);
    return preferred > 0 ? preferred : Math.min(...(playerCounts.length ? playerCounts : [1]));
  });
  const modes = game.contentSource?.modes ?? [];
  const [mode, setMode] = useState(() => game.contentSource?.defaultMode ?? modes[0]?.id ?? "free");
  const [levelId, setLevelId] = useState<string | undefined>();
  const [levels, setLevels] = useState<readonly GameLevelChoice[]>([]);
  const [contentState, setContentState] = useState<"idle" | "loading" | "ready" | "error">(
    game.contentSource ? "loading" : "idle"
  );
  const [contentError, setContentError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const source = game.contentSource;
    if (!source) return;
    let cancelled = false;
    setContentState("loading");
    setContentError("");
    source.list({ difficulty, ...(mode ? { mode } : {}) }).then((nextLevels) => {
      if (cancelled) return;
      setLevels(nextLevels);
      setLevelId((current) => nextLevels.some((level) => level.id === current)
        ? current
        : nextLevels[0]?.id);
      setContentState("ready");
    }).catch((error: unknown) => {
      if (cancelled) return;
      setLevels([]);
      setLevelId(undefined);
      setContentError(error instanceof Error ? error.message : "No se pudieron cargar los niveles.");
      setContentState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [difficulty, game.contentSource, mode, reloadToken]);

  const contentReady = !game.contentSource || (contentState === "ready" && Boolean(levelId));

  return (
    <div className="dialog-backdrop" role="presentation">
      <button
        aria-label="Cerrar selector de juego"
        className="dialog-backdrop-dismiss"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="game-dialog-title"
        aria-modal="true"
        className="dialog"
        role="dialog"
        style={{ "--accent": accent } as React.CSSProperties}
      >
        <header className="dialog-head">
          <div>
            <span className="game-card-category">
              {categoryLabels[catalog.category] ?? catalog.category}
            </span>
            <h2 id="game-dialog-title">{catalog.label}</h2>
            <p>{catalog.modeLabel} · {catalog.durationLabel}. Ajusta las opciones de la partida antes de comenzar.</p>
          </div>
          <button aria-label="Cerrar" className="dialog-close" onClick={onClose} type="button">
            <X aria-hidden="true" />
          </button>
        </header>

        <ul className="dialog-rules">
          {catalog.rules.map((rule, index) => (
            <li key={`${index}-${rule}`}><Check aria-hidden="true" />{rule}</li>
          ))}
        </ul>

        <div className="dialog-options">
          {difficulties.length > 1 ? (
            <label>
              <span>Dificultad</span>
              <div className="chip-row" role="radiogroup" aria-label="Dificultad">
                {difficulties.map((option) => (
                  <button
                    aria-checked={difficulty === option}
                    className={`chip${difficulty === option ? " is-active" : ""}`}
                    key={option}
                    onClick={() => setDifficulty(option)}
                    role="radio"
                    type="button"
                  >
                    {difficultyLabels[option] ?? option}
                  </button>
                ))}
              </div>
            </label>
          ) : null}

          {modes.length > 1 ? (
            <label>
              <span>Modo</span>
              <div className="chip-row" role="radiogroup" aria-label="Modo">
                {modes.map((option) => (
                  <button
                    aria-checked={mode === option.id}
                    className={`chip${mode === option.id ? " is-active" : ""}`}
                    key={option.id}
                    onClick={() => setMode(option.id)}
                    role="radio"
                    title={option.description}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </label>
          ) : null}

          {game.contentSource ? (
            <label>
              <span>Nivel</span>
              {contentState === "error" ? (
                <div className="content-load-error" role="alert">
                  {contentError}
                  <button onClick={() => setReloadToken((value) => value + 1)} type="button">
                    Reintentar
                  </button>
                </div>
              ) : (
                <select
                  aria-busy={contentState === "loading"}
                  disabled={contentState !== "ready"}
                  onChange={(event) => setLevelId(event.target.value)}
                  value={levelId ?? ""}
                >
                  {contentState === "loading" ? <option value="">Cargando niveles…</option> : null}
                  {levels.length === 0 && contentState === "ready" ? (
                    <option value="">No hay niveles publicados</option>
                  ) : null}
                  {levels.map((level) => (
                    <option key={level.id} value={level.id}>{level.label}</option>
                  ))}
                </select>
              )}
            </label>
          ) : null}

          {playerCounts.length > 1 ? (
            <label>
              <span>Jugadores (los demás son robots)</span>
              <div className="chip-row" role="radiogroup" aria-label="Jugadores">
                {playerCounts.map((count) => (
                  <button
                    aria-checked={playerCount === count}
                    className={`chip${playerCount === count ? " is-active" : ""}`}
                    key={count}
                    onClick={() => setPlayerCount(count)}
                    role="radio"
                    type="button"
                  >
                    {count}
                  </button>
                ))}
              </div>
            </label>
          ) : null}
        </div>

        <button
          className="play-button"
          disabled={!contentReady}
          onClick={() => {
            soundBank.unlock();
            soundBank.cue("start");
            onPlay(game, {
              playerCount,
              difficulty,
              ...(game.contentSource ? {
                contentSelection: {
                  difficulty,
                  ...(levelId ? { levelId } : {}),
                  ...(mode ? { mode } : {})
                }
              } : {})
            });
          }}
          type="button"
        >
          <Play aria-hidden="true" />
          Jugar ahora
        </button>
      </section>
    </div>
  );
}

function playersLabel(manifest: GameManifest): string {
  const { min, max } = manifest.players;
  if (min === max) {
    return min === 1 ? "1 jugador" : `${min} jugadores`;
  }
  return `${min}–${max} jugadores`;
}

export function projectCatalogEntries(entries: readonly GameEntry[]): readonly JugarCatalogEntry[] {
  return entries.map(({ manifest }) => ({ id: manifest.id, manifest }));
}

export function resolveCatalogSelection(
  entries: readonly GameEntry[],
  id: string,
  presentation?: JugarCatalogPresentation
): JugarCatalogSelection | null {
  const entry = entries.find((candidate) => candidate.manifest.id === id);
  if (!entry) return null;
  const snapshot = snapshotCatalogPresentation(presentation);
  return {
    entry,
    ...(snapshot ? { presentation: snapshot } : {})
  };
}

type ResolvedGameDialogPresentation = Readonly<{
  label: string;
  color: string;
  category: string;
  modeLabel: string;
  durationLabel: string;
  rules: readonly string[];
}>;

export function resolveGameDialogPresentation(
  manifest: GameManifest,
  presentation?: JugarCatalogPresentation
): ResolvedGameDialogPresentation {
  const snapshot = snapshotCatalogPresentation(presentation);
  return {
    label: snapshot?.label ?? manifest.label,
    color: snapshot?.color ?? manifest.catalog.color,
    category: snapshot?.category ?? manifest.catalog.category,
    modeLabel: snapshot?.modeLabel ?? manifest.catalog.modeLabel,
    durationLabel: snapshot?.durationLabel ?? manifest.catalog.durationLabel,
    rules: snapshot?.rules ?? manifest.catalog.rules
  };
}

function snapshotCatalogPresentation(
  presentation?: JugarCatalogPresentation
): JugarCatalogPresentation | undefined {
  if (!presentation) return undefined;
  const label = cleanPresentationText(presentation.label);
  const color = cleanPresentationText(presentation.color);
  const category = cleanPresentationText(presentation.category);
  const modeLabel = cleanPresentationText(presentation.modeLabel);
  const durationLabel = cleanPresentationText(presentation.durationLabel);
  const rules = presentation.rules?.map((rule) => rule.trim()).filter(Boolean);
  const snapshot: JugarCatalogPresentation = {
    ...(label ? { label } : {}),
    ...(color ? { color } : {}),
    ...(category ? { category } : {}),
    ...(modeLabel ? { modeLabel } : {}),
    ...(durationLabel ? { durationLabel } : {}),
    ...(rules ? { rules } : {})
  };
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function cleanPresentationText(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}
