import type { HexColor } from "@motion-levels-games/game-sdk";
import {
  add,
  checker,
  compose,
  defineAnimation,
  gradient,
  hash,
  hsv,
  kaleidoscope,
  mapShader,
  mask,
  mix,
  multiply,
  plasma,
  ribbons,
  rings,
  screen,
  solid,
  sparkles,
  wave,
  type AnimationCategory,
  type NativeAnimation,
  type PixelShader,
  type Rgb
} from "./core.ts";

type LibraryDefinition = Readonly<{
  id: string;
  label: string;
  description: string;
  category?: AnimationCategory;
  durationMillis?: number;
  palette: readonly HexColor[];
  tags?: readonly string[];
  pressure?: NativeAnimation["pressure"];
  render: PixelShader;
}>;

function libraryAnimation(definition: LibraryDefinition): NativeAnimation {
  return defineAnimation({
    category: definition.category ?? "ambient",
    durationMillis: definition.durationMillis ?? 10_000,
    tags: definition.tags ?? [],
    pressure: definition.pressure ?? "ripple",
    ...definition
  });
}

const dark = (color: HexColor) => gradient(["#010307", color], { angle: 100 });

const definitions: readonly NativeAnimation[] = [
  libraryAnimation({
    id: "arcoiris", label: "Arcoíris", description: "Bandas de color que recorren toda la pista", palette: ["#ff416c", "#ffca3a", "#56f39a", "#35d7ff", "#b968ff"], tags: ["color", "suave"],
    render: compose(gradient(["#ff416c", "#ffca3a", "#56f39a", "#35d7ff", "#b968ff"], { angle: 26, speed: 1 }), multiply(wave({ colors: ["#657080", "#ffffff"], angle: -18, frequency: 3, speed: 2, softness: 0.8 })))
  }),
  libraryAnimation({
    id: "cometas", label: "Cometas", description: "Estelas luminosas cruzan el suelo en diagonal", palette: ["#07121f", "#35d7ff", "#e9fbff"], tags: ["espacio", "movimiento"], pressure: "spark",
    render: compose(dark("#061a2e"), add(mask(wave({ colors: ["#35d7ff", "#ffffff"], angle: 28, frequency: 8, speed: 3, softness: 0.18 }), (context) => hash(Math.floor(context.yn * 9), context.seed) > 0.42 ? 0.9 : 0.08)), screen(sparkles({ density: 0.035, speed: 4 })))
  }),
  libraryAnimation({
    id: "pulso", label: "Pulso", description: "Ondas concéntricas con ritmo de neón", palette: ["#02020a", "#ff3bd7", "#35d7ff"], tags: ["ritmo", "neón"], pressure: "glow", durationMillis: 8_000,
    render: compose(solid("#02020a"), add(rings({ colors: ["#ff3bd7", "#35d7ff", "#ffffff"], frequency: 8, speed: 3, width: 0.12 })))
  }),
  libraryAnimation({
    id: "chispas", label: "Chispas", description: "Destellos cálidos que aparecen al compás", palette: ["#120704", "#ff8a1f", "#fff0a8"], tags: ["energía", "destellos"], pressure: "spark", durationMillis: 8_000,
    render: compose(dark("#180704"), add(sparkles({ color: "#ffd27a", density: 0.13, speed: 9, size: 2 })), screen(sparkles({ color: "#ffffff", density: 0.03, speed: 5 })))
  }),
  libraryAnimation({
    id: "aurora", label: "Aurora", description: "Cortinas boreales fluidas y profundas", palette: ["#020617", "#42ffd2", "#5b8cff", "#e66cff"], tags: ["naturaleza", "suave"], category: "nature", durationMillis: 16_000,
    render: compose(dark("#071329"), screen(ribbons({ colors: ["#42ffd2", "#5b8cff", "#e66cff"], count: 5, speed: 0.55, bend: 0.18, width: 0.08 })), screen(sparkles({ density: 0.025, speed: 2 })))
  }),
  libraryAnimation({
    id: "vortice", label: "Vórtice", description: "Espiral hipnótica que gira hacia el centro", palette: ["#080318", "#774dff", "#ff43cf", "#35d7ff"], tags: ["espiral", "intenso"], category: "energetic", durationMillis: 12_000,
    render: compose(dark("#080318"), screen(kaleidoscope({ colors: ["#15104d", "#774dff", "#ff43cf", "#35d7ff", "#080318"], segments: 7, speed: 1.2 })), add(rings({ colors: ["#000000", "#c6f8ff"], frequency: 11, speed: 1, width: 0.08 })))
  }),
  libraryAnimation({
    id: "radar", label: "Radar", description: "Barrido verde con ecos circulares", palette: ["#010806", "#25ff79", "#d7ffe8"], tags: ["tecnología", "barrido"], durationMillis: 10_000,
    render: compose(
      dark("#04150e"),
      add(rings({ colors: ["#062d1a", "#3cff8d"], frequency: 7, speed: 0.8, width: 0.06 })),
      screen(mask(
        gradient(["#03110b", "#76ffae"], { angle: 25, speed: 1 }),
        (context) => Math.max(0, Math.sin(Math.atan2(context.yn - 0.5, context.xn - 0.5) - context.progress * Math.PI * 2))
      ))
    )
  }),
  libraryAnimation({
    id: "oceano", label: "Océano", description: "Oleaje azul con crestas de espuma", palette: ["#020c1e", "#087ea4", "#35d7ff", "#e8fdff"], tags: ["agua", "calma"], category: "nature", durationMillis: 14_000,
    render: compose(gradient(["#020c1e", "#075985", "#0ea5e9"], { angle: 90 }), screen(wave({ colors: ["#0b77a6", "#e8fdff"], angle: 12, frequency: 5, speed: 1.2, softness: 0.22, alpha: 0.66 })))
  }),
  libraryAnimation({
    id: "portal", label: "Portal", description: "Anillos de energía convergen en otra dimensión", palette: ["#070216", "#6d39ff", "#ff48d7", "#ffffff"], tags: ["espacio", "anillos"], category: "energetic", durationMillis: 10_000,
    render: compose(dark("#0d0428"), screen(rings({ colors: ["#6d39ff", "#ff48d7", "#ffffff"], frequency: 14, speed: 4, width: 0.1 })), multiply(kaleidoscope({ colors: ["#ffffff", "#40188d", "#090115"], segments: 10, speed: 0.4 })))
  }),
  libraryAnimation({
    id: "lava", label: "Lava", description: "Magma vivo con grietas incandescentes", palette: ["#100100", "#8f1300", "#ff4d00", "#ffd36b"], tags: ["fuego", "orgánico"], category: "nature", durationMillis: 18_000,
    render: plasma({ colors: ["#100100", "#4b0900", "#c92700", "#ff7500", "#ffd36b"], scale: 3.8, speed: 0.8 })
  }),
  libraryAnimation({
    id: "matriz", label: "Matriz", description: "Lluvia digital verde sobre la oscuridad", palette: ["#010703", "#00c853", "#92ffb1"], tags: ["digital", "retro"], category: "energetic", durationMillis: 8_000,
    render: compose(dark("#011208"), add(mask(sparkles({ color: "#92ffb1", density: 0.15, speed: 10, size: 0.7 }), (context) => 0.3 + positiveSine(context.y * 0.45 - context.timeSeconds * 8) * 0.7)), multiply(checker({ colors: ["#64ff91", "#053e1c"], size: 1, speed: 2 })))
  }),
  libraryAnimation({
    id: "estrellas", label: "Estrellas", description: "Cielo profundo con estrellas centelleantes", palette: ["#01020a", "#3449a7", "#dce7ff"], tags: ["espacio", "calma"], durationMillis: 12_000,
    render: compose(gradient(["#01020a", "#080c2c"], { angle: 90 }), screen(sparkles({ density: 0.12, speed: 3, rainbow: true })))
  }),
  libraryAnimation({
    id: "tormenta", label: "Tormenta", description: "Nubes eléctricas atravesadas por relámpagos", palette: ["#02040d", "#27346f", "#a8c7ff", "#ffffff"], tags: ["clima", "dramático"], category: "nature", durationMillis: 9_000,
    render: compose(plasma({ colors: ["#01030b", "#101938", "#293b70"], scale: 2, speed: 0.7 }), screen(mask(solid("#e9f3ff"), (context) => hash(Math.floor(context.timeSeconds * 3), context.seed) > 0.86 && Math.abs(context.xn - 0.5 - Math.sin(context.y * 1.7) * 0.18) < 0.08 ? 1 : 0)))
  }),
  libraryAnimation({
    id: "luciernagas", label: "Luciérnagas", description: "Luces doradas flotan en un bosque nocturno", palette: ["#010904", "#16421d", "#d8ff62"], tags: ["naturaleza", "calma"], category: "nature", durationMillis: 14_000,
    render: compose(gradient(["#010904", "#08200d"], { angle: 90 }), screen(mapShader(sparkles({ color: "#d8ff62", density: 0.07, speed: 2.2, size: 0.8 }), (pixel, context) => ({ ...pixel, a: (pixel.a ?? 1) * (0.5 + positiveSine(context.x * 0.43 + context.timeSeconds) * 0.5) }))))
  }),
  libraryAnimation({
    id: "cristales", label: "Cristales", description: "Facetas heladas reflejan luz de colores", palette: ["#061020", "#64d8ff", "#b78bff", "#ffffff"], tags: ["hielo", "geométrico"], durationMillis: 12_000,
    render: compose(kaleidoscope({ colors: ["#061020", "#1e70a1", "#64d8ff", "#b78bff", "#ffffff"], segments: 12, speed: 0.35 }), screen(sparkles({ density: 0.055, speed: 5 })))
  }),
  libraryAnimation({
    id: "neon-ribbons", label: "Cintas de neón", description: "Nuevas cintas luminosas se entrelazan sobre cristal negro", palette: ["#02030b", "#00f0ff", "#ff2bd6", "#8dff5a"], tags: ["nuevo", "neón", "fluido"], category: "energetic", durationMillis: 15_000, pressure: "glow",
    render: compose(dark("#050717"), screen(ribbons({ colors: ["#00f0ff", "#ff2bd6", "#8dff5a"], count: 7, speed: 0.8, bend: 0.24, width: 0.06 })), screen(ribbons({ colors: ["#ff2bd6", "#8dff5a", "#00f0ff"], count: 5, speed: -0.45, bend: 0.15, width: 0.09 })))
  }),
  libraryAnimation({
    id: "prism-tunnel", label: "Túnel prisma", description: "Un túnel caleidoscópico de profundidad infinita", palette: ["#020108", "#4a2fff", "#ff3dba", "#ffe85c", "#5cffda"], tags: ["nuevo", "prisma", "intenso"], category: "energetic", durationMillis: 11_000,
    render: compose(kaleidoscope({ colors: ["#09021c", "#4a2fff", "#ff3dba", "#ffe85c", "#5cffda", "#09021c"], segments: 14, speed: 1.4 }), multiply(rings({ colors: ["#17203d", "#ffffff"], frequency: 18, speed: 3, width: 0.07 })))
  }),
  libraryAnimation({
    id: "bioluminescence", label: "Bioluminiscencia", description: "Organismos marinos respiran luz turquesa y violeta", palette: ["#01070d", "#064f65", "#20f4d1", "#ae63ff"], tags: ["nuevo", "mar", "orgánico"], category: "nature", durationMillis: 18_000,
    render: compose(plasma({ colors: ["#01070d", "#042b3b", "#087c83", "#20f4d1"], scale: 2.2, speed: 0.45 }), screen(rings({ colors: ["#061024", "#ae63ff"], center: [0.25, 0.66], frequency: 5, speed: 0.7, width: 0.2 })), screen(sparkles({ color: "#a4fff0", density: 0.045, speed: 1.8 })))
  }),
  libraryAnimation({
    id: "disco-tiles", label: "Pista disco", description: "Baldosas de club cambian de color con un pulso elegante", palette: ["#090013", "#ff3196", "#7a5cff", "#25e6ff", "#ffe14d"], tags: ["nuevo", "baile", "retro"], category: "energetic", durationMillis: 8_000, pressure: "spark",
    render: mapShader(checker({ colors: ["#ff3196", "#25e6ff"], size: 2, speed: 2 }), (pixel, context) => {
      const hue = hash(Math.floor(context.x / 2), Math.floor(context.y / 2), Math.floor(context.timeSeconds * 2));
      const pulse = 0.45 + positiveSine(context.timeSeconds * 5 + context.x + context.y) * 0.55;
      return { ...mixRgb(pixel, hsv(hue, 0.82, pulse), 0.76), a: 1 };
    })
  }),
  libraryAnimation({
    id: "solar-flare", label: "Llamarada solar", description: "Filamentos de plasma dorado estallan desde el núcleo", palette: ["#130100", "#9d1900", "#ff6b00", "#fff08a"], tags: ["nuevo", "sol", "energía"], category: "energetic", durationMillis: 13_000, pressure: "spark",
    render: compose(plasma({ colors: ["#130100", "#6f0c00", "#ff5200", "#ffc92f"], scale: 4.5, speed: 1.1 }), add(rings({ colors: ["#ff5c00", "#fff08a"], center: [0.5, 0.5], frequency: 9, speed: 3, width: 0.09 })), screen(sparkles({ color: "#fff5ba", density: 0.06, speed: 8 })))
  }),
  libraryAnimation({
    id: "victory-pulse", label: "Victoria · Pulso", description: "Celebración radial con energía azul y dorada", palette: ["#061235", "#35d7ff", "#ffe176", "#ffffff"], tags: ["victoria", "celebración"], category: "celebration", durationMillis: 5_000, pressure: "spark",
    render: compose(dark("#081b49"), add(rings({ colors: ["#35d7ff", "#ffe176", "#ffffff"], frequency: 10, speed: 5, width: 0.09 })), screen(sparkles({ color: "#ffffff", density: 0.08, speed: 8 })))
  }),
  libraryAnimation({
    id: "victory-confetti", label: "Victoria · Confeti", description: "Confeti multicolor cae sobre la pista", palette: ["#110329", "#ff4278", "#ffd84a", "#57f7a6", "#4bd8ff"], tags: ["victoria", "confeti"], category: "celebration", durationMillis: 5_000, pressure: "spark",
    render: compose(dark("#110329"), screen(sparkles({ density: 0.28, speed: 10, rainbow: true, size: 0.8 })), add(wave({ colors: ["#ff4278", "#ffd84a", "#57f7a6", "#4bd8ff"], angle: 90, frequency: 12, speed: 5, softness: 0.12, alpha: 0.32 })))
  }),
  libraryAnimation({
    id: "victory-wave", label: "Victoria · Ola", description: "Olas luminosas bañan el suelo al ganar", palette: ["#031329", "#168bff", "#35d7ff", "#ffffff"], tags: ["victoria", "ola"], category: "celebration", durationMillis: 5_000,
    render: compose(dark("#031329"), screen(wave({ colors: ["#168bff", "#35d7ff", "#ffffff"], angle: 32, frequency: 6, speed: 4, softness: 0.18 })), screen(wave({ colors: ["#6437ff", "#ffffff"], angle: -25, frequency: 7, speed: -3, softness: 0.14, alpha: 0.55 })))
  }),
  libraryAnimation({
    id: "victory-spark", label: "Victoria · Destellos", description: "Fogonazos dorados celebran el resultado", palette: ["#150800", "#ff9d1f", "#fff28c", "#ffffff"], tags: ["victoria", "destellos"], category: "celebration", durationMillis: 5_000, pressure: "spark",
    render: compose(dark("#150800"), add(sparkles({ color: "#fff28c", density: 0.24, speed: 12, size: 1.2 })), screen(rings({ colors: ["#ff8a00", "#ffffff"], frequency: 9, speed: 4, width: 0.07 })))
  })
];

export const animationLibrary = Object.freeze([...definitions].sort((left, right) => left.label.localeCompare(right.label, "es")));
export const animationLibraryById = new Map(animationLibrary.map((animation) => [animation.id, animation] as const));

export function findAnimation(id: string | undefined): NativeAnimation {
  return animationLibraryById.get(String(id ?? "").trim().toLowerCase()) ?? animationLibraryById.get("aurora")!;
}

function positiveSine(value: number): number {
  return 0.5 + Math.sin(value) * 0.5;
}

function mixRgb(left: Rgb, right: Rgb, amount: number): Rgb {
  return { r: mix(left.r, right.r, amount), g: mix(left.g, right.g, amount), b: mix(left.b, right.b, amount) };
}
