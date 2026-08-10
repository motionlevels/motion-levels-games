"use client";

import { formatClock } from "@motion-levels-games/game-sdk";
import { Pause, Play, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useReducer, useState } from "react";

import { soundBank } from "../audio/sfx.ts";
import type { GameSession } from "../core/session.ts";

type Props = {
  session: GameSession;
  onExit: () => void;
};

/** DOM overlay on top of the 3D stage: status, controls, finish panel. */
export function Hud({ session, onExit }: Props) {
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => session.subscribe(bump), [session]);

  const [muted, setMuted] = useState(soundBank.muted);
  const snapshot = session.state.snapshot;
  const phase = String(snapshot.phase);
  const finished = phase === "finished";
  const remaining = snapshot.remainingMillis;

  return (
    <div className="hud">
      <div className="hud-top">
        {/* Everything lives on the sides: the centre column stays clear so the
            TV can use the full vertical space. */}
        <div className="hud-left">
          <button aria-label="Salir del juego" className="hud-button" onClick={onExit} type="button">
            <X aria-hidden="true" />
            Salir
          </button>
          <div className="hud-status">
            <strong>{session.game.manifest.label}</strong>
            <span>
              {session.avatars.length > 1 ? (
                <i
                  aria-hidden="true"
                  className="hud-color-dot"
                  style={{ background: session.avatars[0]?.color }}
                />
              ) : null}
              {hintForPhase(phase, snapshot.readyPlayers, snapshot.requiredPlayers)}
            </span>
          </div>
        </div>
        <div className="hud-actions">
          {remaining > 0 && phase === "running" ? (
            <span className="hud-clock">{formatClock(remaining)}</span>
          ) : null}
          {finished ? null : (
            <button
              aria-label={session.paused ? "Reanudar" : "Pausar"}
              className="hud-button"
              onClick={() => {
                soundBank.ui();
                session.setPaused(!session.paused);
              }}
              type="button"
            >
              {session.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            </button>
          )}
          <button
            aria-label={muted ? "Activar sonido" : "Silenciar"}
            className="hud-button"
            onClick={() => {
              soundBank.unlock();
              soundBank.setMuted(!muted);
              setMuted(!muted);
              }}
              type="button"
            >
            {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div className="hud-bottom">
        <p className="hud-help">
          Haz clic o arrastra sobre el suelo para moverte · espacio o clic derecho para saltar ·
          Esc para salir
        </p>
        <button
          className="jump-button"
          onPointerDown={(event) => {
            event.preventDefault();
            soundBank.unlock();
            session.jump();
          }}
          type="button"
        >
          Saltar
        </button>
      </div>

      {finished ? (
        <div className="finish-panel" style={{ "--accent": session.game.manifest.catalog.color } as React.CSSProperties}>
          <strong>{snapshot.success ? "¡Victoria!" : "Fin de la partida"}</strong>
          <span>
            {snapshot.score > 0 ? `Puntuación: ${snapshot.score}` : snapshot.lastEventMessage}
          </span>
          <div className="finish-actions">
            <button
              className="play-button"
              onClick={() => {
                soundBank.ui();
                session.restart();
              }}
              type="button"
            >
              <RotateCcw aria-hidden="true" />
              Otra vez
            </button>
            <button className="hud-button" onClick={onExit} type="button">
              Cambiar juego
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function hintForPhase(
  phase: string,
  readyPlayers: number | undefined,
  requiredPlayers: number | undefined
): string {
  switch (phase) {
    case "waiting":
      return requiredPlayers && requiredPlayers > 1
        ? `Camina a la zona de tu color (${readyPlayers ?? 0}/${requiredPlayers})`
        : "Camina a la zona iluminada para empezar";
    case "starting":
      return "¡Prepárate!";
    case "running":
      return "En juego";
    case "paused":
      return "En pausa";
    case "finished":
      return "Partida terminada";
    default:
      return "";
  }
}
