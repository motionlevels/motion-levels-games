/**
 * Character metadata — plain data, deliberately free of any three.js import.
 *
 * The picker and the app shell read from here so the initial bundle stays
 * small; the actual character meshes live in `components.tsx`, which only the
 * lazily-loaded 3D stage pulls in. Importing `components.tsx` from app-shell
 * code would drag three.js into the entry chunk.
 */
export type CharacterCredit = {
  author: string;
  url: string;
  license: string;
};

export type CharacterMeta = {
  id: string;
  label: string;
  /** One line shown in the character picker. */
  description: string;
  credit?: CharacterCredit;
};

/**
 * Playable characters for the HUMAN player. Companion bots rotate through the
 * four canonical Motion Athlete silhouettes; Sahur remains an optional skin.
 *
 * `credit` is rendered in the picker. The Sahur model is CC-BY, so that credit
 * is a licence obligation, not decoration: see ATTRIBUTIONS.md.
 */
export const characterCatalog: CharacterMeta[] = [
  {
    id: "explorer",
    label: "Explorador",
    description: "Compacto, curioso y equipado con mochila baliza."
  },
  {
    id: "runner",
    label: "Velocista",
    description: "Silueta ligera con banda de energía magenta."
  },
  {
    id: "trickster",
    label: "Tramposo",
    description: "Antena asimétrica y movimientos más juguetones."
  },
  {
    id: "guardian",
    label: "Guardián",
    description: "Hombros anchos y una presencia protectora."
  },
  {
    id: "sahur",
    label: "Tung Tung Tung Sahur",
    description: "Brainrot italiano, con su propia animación de caminar.",
    credit: {
      author: "KAG3D",
      url: "https://sketchfab.com/3d-models/tung-tung-tung-sahur-lowpoly-mixamo-rig-99c84a57df394dc8b3976f5582f74c52",
      license: "CC Attribution"
    }
  }
];

export const defaultCharacterId = "explorer";

export function findCharacter(id: string | null | undefined): CharacterMeta {
  return (
    characterCatalog.find((character) => character.id === id) ??
    characterCatalog.find((character) => character.id === defaultCharacterId)!
  );
}
