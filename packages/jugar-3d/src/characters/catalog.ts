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
 * four canonical Motion Athlete silhouettes; streamed rigged skins remain
 * optional and are fetched only after selection.
 *
 * `credit` is rendered in the picker. Sahur's is a CC-BY obligation; the CC0
 * entries document provenance and thank Quaternius: see ATTRIBUTIONS.md.
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
  quaterniusCharacter(
    "adventurer",
    "Aventurero",
    "Mochila de expedición y una silueta preparada para cualquier reto.",
    "https://quaternius.com/packs/ultimatemodularcharacters.html"
  ),
  quaterniusCharacter(
    "trailblazer",
    "Pionera",
    "Exploradora de montaña con un estilo ágil y decidido.",
    "https://quaternius.com/packs/ultimatemodularwomen.html"
  ),
  quaterniusCharacter(
    "casual-hoodie",
    "Urbano",
    "Sudadera, zapatillas y movimientos naturales de juego.",
    "https://quaternius.com/packs/ultimatemodularcharacters.html"
  ),
  quaterniusCharacter(
    "street-scout",
    "Exploradora urbana",
    "Estilo callejero y una respuesta rápida en movimiento.",
    "https://quaternius.com/packs/ultimatemodularwomen.html"
  ),
  quaterniusCharacter(
    "punk",
    "Punk",
    "Cresta, actitud y animaciones con mucha personalidad.",
    "https://quaternius.com/packs/ultimatemodularcharacters.html"
  ),
  quaterniusCharacter(
    "mystic",
    "Mística",
    "Una hechicera de fantasía con capa y presencia escénica.",
    "https://quaternius.com/packs/ultimatemodularwomen.html"
  ),
  quaterniusCharacter(
    "spacesuit",
    "Astronauta",
    "Traje espacial completo para cruzar cualquier zona peligrosa.",
    "https://quaternius.com/packs/ultimatemodularcharacters.html"
  ),
  quaterniusCharacter(
    "star-pilot",
    "Piloto estelar",
    "Equipo de ciencia ficción y silueta de heroína espacial.",
    "https://quaternius.com/packs/ultimatemodularwomen.html"
  ),
  quaterniusCharacter(
    "swat",
    "Unidad táctica",
    "Equipamiento táctico robusto y movimientos precisos.",
    "https://quaternius.com/packs/ultimatemodularcharacters.html"
  ),
  quaterniusCharacter(
    "worker",
    "Constructor",
    "Casco, chaleco y botas para entrar en acción con seguridad.",
    "https://quaternius.com/packs/ultimatemodularcharacters.html"
  ),
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

function quaterniusCharacter(
  id: string,
  label: string,
  description: string,
  url: string
): CharacterMeta {
  return {
    id,
    label,
    description,
    credit: { author: "Quaternius", url, license: "CC0" }
  };
}

export const defaultCharacterId = "explorer";

export function findCharacter(id: string | null | undefined): CharacterMeta {
  return (
    characterCatalog.find((character) => character.id === id) ??
    characterCatalog.find((character) => character.id === defaultCharacterId)!
  );
}
