"use client";

import {
  defaultGamePlayerCount,
  gameDifficultyOptions,
  gamePlayerCountOptions,
  normalizeGameDifficulty,
  type GameDifficulty
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
import { useMemo, useState } from "react";

import { soundBank } from "../audio/sfx.ts";
import { findCharacter } from "../characters/catalog.ts";
import type { GameEntry } from "../contracts.ts";
import type { SessionOptions } from "../core/session.ts";
import { CharacterPicker } from "./CharacterPicker.tsx";

type Props = {
  entries: readonly GameEntry[];
  onPlay: (game: GameEntry, options: SessionOptions) => void;
  characterId: string;
  onCharacterChange: (id: string) => void;
};

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

export function GamePicker({ entries, onPlay, characterId, onCharacterChange }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [characterOpen, setCharacterOpen] = useState(false);

  const selected = useMemo(
    () => entries.find((game) => game.manifest.id === selectedId) ?? null,
    [entries, selectedId]
  );

  return (
    <div className="picker">
      <header className="picker-header">
        <div>
          <p className="picker-label">Juegos disponibles</p>
          <p className="picker-hint">
            {entries.length} modos listos para jugar en el navegador
          </p>
        </div>

        <button
          className="character-trigger"
          onClick={() => {
            soundBank.unlock();
            soundBank.ui();
            setCharacterOpen(true);
          }}
          title="Cambiar personaje"
          type="button"
        >
          <CircleUserRound aria-hidden="true" />
          <span>Personaje</span>
          <strong>{findCharacter(characterId).label}</strong>
        </button>
      </header>

      <ul className="picker-grid">
        {entries.map((game) => {
          const { manifest } = game;
          const accent = manifest.catalog.color;
          return (
            <li key={manifest.id}>
              <button
                className="game-card"
                onClick={() => {
                  soundBank.unlock();
                  soundBank.ui();
                  setSelectedId(manifest.id);
                }}
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
                  <span><UsersRound aria-hidden="true" />{playersLabel(game)}</span>
                  <span><Clock3 aria-hidden="true" />{manifest.catalog.durationLabel}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected ? (
        <GameDialog
          game={selected}
          onClose={() => setSelectedId(null)}
          onPlay={onPlay}
        />
      ) : null}

      {characterOpen ? (
        <CharacterPicker
          characterId={characterId}
          onClose={() => setCharacterOpen(false)}
          onSelect={onCharacterChange}
        />
      ) : null}
    </div>
  );
}

function GameDialog({
  game,
  onClose,
  onPlay
}: {
  game: GameEntry;
  onClose: () => void;
  onPlay: Props["onPlay"];
}) {
  const { manifest } = game;
  const accent = manifest.catalog.color;
  const difficulties = gameDifficultyOptions(manifest);
  const playerCounts = gamePlayerCountOptions(manifest).filter((count) => count > 0);

  const [difficulty, setDifficulty] = useState<GameDifficulty>(
    normalizeGameDifficulty(undefined, manifest)
  );
  const [playerCount, setPlayerCount] = useState(() => {
    const preferred = defaultGamePlayerCount(manifest);
    return preferred > 0 ? preferred : Math.min(...(playerCounts.length ? playerCounts : [1]));
  });

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
              {categoryLabels[manifest.catalog.category] ?? manifest.catalog.category}
            </span>
            <h2 id="game-dialog-title">{manifest.label}</h2>
            <p>{manifest.catalog.modeLabel}. Ajusta las opciones de la partida antes de comenzar.</p>
          </div>
          <button aria-label="Cerrar" className="dialog-close" onClick={onClose} type="button">
            <X aria-hidden="true" />
          </button>
        </header>

        <ul className="dialog-rules">
          {manifest.catalog.rules.map((rule) => (
            <li key={rule}><Check aria-hidden="true" />{rule}</li>
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
          onClick={() => {
            soundBank.unlock();
            soundBank.cue("start");
            onPlay(game, { playerCount, difficulty });
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

function playersLabel(game: GameEntry): string {
  const { min, max } = game.manifest.players;
  if (min === max) {
    return min === 1 ? "1 jugador" : `${min} jugadores`;
  }
  return `${min}–${max} jugadores`;
}
