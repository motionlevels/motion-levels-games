"use client";

import { useEffect, useMemo, useReducer } from "react";

import { soundBank } from "../audio/sfx.ts";
import type { RegisteredGame } from "../contracts.ts";
import { JugarPresentationSession, type SessionOptions } from "./session.ts";

export type UseGameSessionOptions = Readonly<{
  /** Explicit diagnostic seam; avoids bundler-specific environment globals. */
  exposeOnWindow?: boolean;
}>;

const mountCounts = new WeakMap<JugarPresentationSession, number>();
const SESSION_DISPOSE_GRACE_MILLIS = 100;

/**
 * Owns a JugarPresentationSession for the lifetime of a play screen. The adapter advances
 * itself on requestAnimationFrame; React re-renders at the session's throttled
 * notify rate (~12 Hz), which keeps the TV display and HUD fresh without
 * re-rendering the 3D scene (the scene reads the session imperatively).
 */
export function useGameSession(
  game: RegisteredGame,
  options: SessionOptions,
  hookOptions: UseGameSessionOptions = {}
): JugarPresentationSession {
  const session = useMemo(() => {
    // A new session is intentional whenever the selection changes. Sounds are
    // wired here, in the session's creation scope, so the object is never
    // mutated after render hands it out.
    const created = new JugarPresentationSession(game, options);
    created.sounds = {
      cue: (cue) => soundBank.cue(cue),
      step: () => soundBank.step(),
      jump: () => soundBank.jump()
    };
    return created;
  }, [game, options]);

  const [, bump] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    mountCounts.set(session, (mountCounts.get(session) ?? 0) + 1);
    if (hookOptions.exposeOnWindow) {
      (window as unknown as Record<string, unknown>)["__jugar3dSession"] = session;
    }
    const unsubscribe = session.subscribe(bump);
    session.start();
    return () => {
      unsubscribe();
      session.stop();
      const remaining = Math.max(0, (mountCounts.get(session) ?? 1) - 1);
      mountCounts.set(session, remaining);
      // React can tear down one surface and mount the next one in separate
      // passive-effect turns. Defer disposal through a macrotask so a surface
      // switch can reattach the shared session before it is finalized.
      setTimeout(() => {
        if ((mountCounts.get(session) ?? 0) === 0) {
          mountCounts.delete(session);
          session.dispose();
          const globals = window as unknown as Record<string, unknown>;
          if (globals["__jugar3dSession"] === session) delete globals["__jugar3dSession"];
        }
      }, SESSION_DISPOSE_GRACE_MILLIS);
    };
  }, [hookOptions.exposeOnWindow, session]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // `code` is layout-independent; `key` covers hosts that only fill that in.
      const isJumpKey =
        event.code === "Space" ||
        event.code === "ArrowUp" ||
        event.key === " " ||
        event.key === "ArrowUp";
      if (!isJumpKey) {
        return;
      }
      // Holding the key should not machine-gun jumps.
      if (event.repeat) {
        return;
      }
      // Space activates a focused control; let the button jump instead of
      // jumping twice. The target is not always an element (it is the window
      // for programmatically dispatched events), so feature-check it.
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest("button") || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      soundBank.unlock();
      session.jump();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session]);

  // No visibility-based auto-pause: a backgrounded tab already stops getting
  // animation frames, and the session clamps the delta on the frame it comes
  // back, so play resumes where it left off. Reacting to `document.hidden`
  // instead would wedge the game permanently in embedded contexts (previews,
  // webviews) that report the document as hidden while still painting.

  return session;
}
