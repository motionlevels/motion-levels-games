import path from "node:path";

export const PINNED_GLTF_TRANSFORM_CLI_VERSION = "4.4.2";
export const PINNED_SHARP_VERSION = "0.35.3";
export const CHARACTER_OPTIMIZATION_PIPELINE_VERSION = 1;

export type CharacterOptimizationOptions = Readonly<{
  input: string;
  output: string;
  force: boolean;
  dryRun: boolean;
  expectedInputSha256?: string;
}>;

export type CharacterOptimizationStage = Readonly<{
  name: "metalrough" | "resize" | "webp";
  input: string;
  output: string;
  args: readonly string[];
}>;

export function parseCharacterOptimizationArgs(args: readonly string[]): CharacterOptimizationOptions {
  if (args.includes("--help") || args.includes("-h")) throw new CharacterOptimizerHelp();
  const input = option(args, "--input");
  const output = option(args, "--output");
  if (!input || !output) throw new Error("Character optimization requires --input and --output");
  const expectedInputSha256 = option(args, "--expect-input-sha256");
  if (expectedInputSha256 && !/^[\da-f]{64}$/iu.test(expectedInputSha256)) {
    throw new Error("--expect-input-sha256 must be a 64-character SHA-256 digest");
  }
  const normalizedInput = path.resolve(input);
  const normalizedOutput = path.resolve(output);
  if (normalizedInput === normalizedOutput) {
    throw new Error("Refusing in-place character optimization; choose a distinct --output path");
  }
  if (path.extname(normalizedInput).toLowerCase() !== ".glb" || path.extname(normalizedOutput).toLowerCase() !== ".glb") {
    throw new Error("Character optimization input and output must both use the .glb extension");
  }
  return Object.freeze({
    input: normalizedInput,
    output: normalizedOutput,
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
    ...(expectedInputSha256 ? { expectedInputSha256: expectedInputSha256.toLowerCase() } : {})
  });
}

export function buildCharacterOptimizationStages(
  input: string,
  output: string,
  temporaryDirectory: string
): readonly CharacterOptimizationStage[] {
  const metalroughOutput = path.join(temporaryDirectory, "01-metalrough.glb");
  const resizedOutput = path.join(temporaryDirectory, "02-resized-512.glb");
  return Object.freeze([
    Object.freeze({
      name: "metalrough" as const,
      input,
      output: metalroughOutput,
      args: Object.freeze(["metalrough", input, metalroughOutput])
    }),
    Object.freeze({
      name: "resize" as const,
      input: metalroughOutput,
      output: resizedOutput,
      args: Object.freeze([
        "resize", metalroughOutput, resizedOutput,
        "--width", "512", "--height", "512", "--filter", "lanczos3"
      ])
    }),
    Object.freeze({
      name: "webp" as const,
      input: resizedOutput,
      output,
      args: Object.freeze([
        "webp", resizedOutput, output,
        "--quality", "85", "--effort", "6", "--formats", "*"
      ])
    })
  ]);
}

export function optimizerUsage(): string {
  return [
    "Usage:",
    "  npm run optimize:character-asset -- --input source.glb --output processed.glb [options]",
    "",
    "Options:",
    "  --expect-input-sha256 <digest>  Fail if the source is not the reviewed file.",
    "  --force                         Replace an existing output (never the input).",
    "  --dry-run                       Print the pinned pipeline without executing it.",
    "  --help                          Show this help.",
    "",
    `Pinned optimizer: @gltf-transform/cli ${PINNED_GLTF_TRANSFORM_CLI_VERSION}`,
    `Pinned image codec: sharp ${PINNED_SHARP_VERSION}`,
    "Pipeline: metalrough -> resize 512x512 -> WebP. Output and provenance sidecar are written atomically."
  ].join("\n");
}

export class CharacterOptimizerHelp extends Error {
  public constructor() {
    super("character-optimizer-help");
    this.name = "CharacterOptimizerHelp";
  }
}

function option(args: readonly string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
  return value;
}
