"use client";

import { useCallback, useState } from "react";

import { defaultCharacterId, findCharacter } from "./catalog.ts";

// v2: the default became Sahur; the bumped key re-defaults earlier visitors.
const STORAGE_KEY = "ml_minigame_character_v2";

/**
 * The selected character, remembered across visits. Defaults to the robot.
 * `?character=<id>` overrides it, which is handy for sharing a link or for
 * screenshots without hunting for the picker.
 */
export function useCharacterChoice(): [string, (id: string) => void] {
  const [characterId, setCharacterId] = useState(readInitialCharacter);

  const choose = useCallback((id: string) => {
    const resolved = findCharacter(id).id;
    setCharacterId(resolved);
    try {
      window.localStorage.setItem(STORAGE_KEY, resolved);
    } catch {
      // Private browsing and similar: the choice just will not persist.
    }
  }, []);

  return [characterId, choose];
}

function readInitialCharacter(): string {
  if (typeof window === "undefined") {
    return defaultCharacterId;
  }
  const fromUrl = new URLSearchParams(window.location.search).get("character");
  if (fromUrl) {
    return findCharacter(fromUrl).id;
  }
  try {
    return findCharacter(window.localStorage.getItem(STORAGE_KEY)).id;
  } catch {
    return defaultCharacterId;
  }
}
