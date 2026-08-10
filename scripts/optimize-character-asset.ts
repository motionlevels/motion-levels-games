import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { inspectCharacterGlb } from "./lib/character-asset-audit.ts";
import {
  CHARACTER_OPTIMIZATION_PIPELINE_VERSION,
  CharacterOptimizerHelp,
  PINNED_GLTF_TRANSFORM_CLI_VERSION,
  PINNED_SHARP_VERSION,
  buildCharacterOptimizationStages,
  optimizerUsage,
  parseCharacterOptimizationArgs
} from "./lib/character-asset-optimizer.ts";

const executeFile = promisify(execFile);

let options;
try {
  options = parseCharacterOptimizationArgs(process.argv.slice(2));
} catch (error) {
  if (error instanceof CharacterOptimizerHelp) {
    console.log(optimizerUsage());
    process.exit(0);
  }
  throw error;
}

const binary = path.resolve("node_modules", ".bin", process.platform === "win32" ? "gltf-transform.cmd" : "gltf-transform");
const installedVersion = await dependencyVersion("@gltf-transform/cli");
if (installedVersion !== PINNED_GLTF_TRANSFORM_CLI_VERSION) {
  throw new Error(
    `Expected @gltf-transform/cli ${PINNED_GLTF_TRANSFORM_CLI_VERSION}, found ${installedVersion}. Run npm ci.`
  );
}
const installedSharpVersion = await dependencyVersion("sharp");
if (installedSharpVersion !== PINNED_SHARP_VERSION) {
  throw new Error(`Expected sharp ${PINNED_SHARP_VERSION}, found ${installedSharpVersion}. Run npm ci.`);
}

await access(options.input);
const inputBytes = await readFile(options.input);
const inputSha256 = sha256(inputBytes);
if (options.expectedInputSha256 && options.expectedInputSha256 !== inputSha256) {
  throw new Error(`Input SHA-256 mismatch: expected ${options.expectedInputSha256}, found ${inputSha256}`);
}
const sidecarPath = `${options.output}.pipeline.json`;
if (!options.force && (await exists(options.output) || await exists(sidecarPath))) {
  throw new Error("Output or provenance sidecar already exists; choose another path or pass --force explicitly");
}

if (options.dryRun) {
  const placeholder = path.join(path.dirname(options.output), ".motion-levels-character-<temporary>");
  console.log(JSON.stringify({
    pipelineVersion: CHARACTER_OPTIMIZATION_PIPELINE_VERSION,
    optimizer: `@gltf-transform/cli@${installedVersion}`,
    imageCodec: `sharp@${installedSharpVersion}`,
    input: options.input,
    inputSha256,
    output: options.output,
    stages: buildCharacterOptimizationStages(options.input, options.output, placeholder).map((stage) => ({
      name: stage.name,
      args: stage.args
    }))
  }, null, 2));
  process.exit(0);
}

await mkdir(path.dirname(options.output), { recursive: true });
const temporaryDirectory = await mkdtemp(path.join(path.dirname(options.output), ".motion-levels-character-"));
const temporaryOutput = path.join(temporaryDirectory, "03-processed-webp.glb");
try {
  const stages = buildCharacterOptimizationStages(options.input, temporaryOutput, temporaryDirectory);
  for (const stage of stages) {
    console.log(`[character-asset] ${stage.name}`);
    await executeFile(binary, [...stage.args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LC_ALL: "C",
        SOURCE_DATE_EPOCH: "0",
        TZ: "UTC"
      },
      maxBuffer: 16 * 1024 * 1024
    });
  }

  const outputBytes = await readFile(temporaryOutput);
  const outputInspection = inspectCharacterGlb(outputBytes);
  const outputErrors = outputInspection.textures.flatMap((texture) => {
    const errors: string[] = [];
    if (texture.declaredMimeType && texture.detectedMimeType && texture.declaredMimeType !== texture.detectedMimeType) {
      errors.push(`${texture.name}:mime-mismatch:${texture.declaredMimeType}/${texture.detectedMimeType}`);
    }
    if (texture.mimeType !== "image/webp") errors.push(`${texture.name}:expected-webp:${texture.mimeType ?? "unknown"}`);
    if (texture.width === undefined || texture.height === undefined) errors.push(`${texture.name}:dimensions-uninspectable`);
    else if (texture.width > 512 || texture.height > 512) errors.push(`${texture.name}:dimensions:${texture.width}x${texture.height}`);
    if (!texture.embedded) errors.push(`${texture.name}:not-embedded`);
    return errors;
  });
  outputErrors.push(
    ...outputInspection.hierarchy.invalidChildReferences.map((issue) => `hierarchy-invalid-child:${issue}`),
    ...outputInspection.hierarchy.multipleParentNodes.map((issue) => `hierarchy-multiple-parent:${issue}`),
    ...outputInspection.hierarchy.cycles.map((issue) => `hierarchy-cycle:${issue}`)
  );
  if (outputInspection.textures.length === 0) outputErrors.push("processed-textures:missing");
  if (outputErrors.length > 0) throw new Error(`Optimized GLB failed post-processing audit: ${outputErrors.join(", ")}`);

  const outputSha256 = sha256(outputBytes);
  const provenance = {
    schemaVersion: 1,
    pipelineVersion: CHARACTER_OPTIMIZATION_PIPELINE_VERSION,
    optimizer: {
      package: "@gltf-transform/cli",
      version: installedVersion
    },
    imageCodec: {
      package: "sharp",
      version: installedSharpVersion
    },
    input: {
      file: path.basename(options.input),
      sha256: inputSha256
    },
    output: {
      file: path.basename(options.output),
      sha256: outputSha256,
      bytes: outputBytes.byteLength
    },
    operations: [
      { command: "metalrough" },
      { command: "resize", width: 512, height: 512, filter: "lanczos3" },
      { command: "webp", quality: 85, effort: 6, formats: "*" }
    ],
    inspection: {
      textures: outputInspection.textures,
      extensionsUsed: outputInspection.extensionsUsed,
      nonUnitScaleNodes: outputInspection.nonUnitScaleNodes,
      nonIdentitySceneRoots: outputInspection.nonIdentitySceneRoots
    }
  };
  const temporarySidecar = path.join(temporaryDirectory, "pipeline.json");
  await writeFile(temporarySidecar, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  if (options.force) {
    await rm(options.output, { force: true });
    await rm(sidecarPath, { force: true });
  }
  await rename(temporaryOutput, options.output);
  await rename(temporarySidecar, sidecarPath);
  console.log(JSON.stringify({ output: options.output, sidecar: sidecarPath, sha256: outputSha256 }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function dependencyVersion(packageName: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(
    path.resolve("node_modules", ...packageName.split("/"), "package.json"),
    "utf8"
  )) as { version?: unknown };
  if (typeof packageJson.version !== "string") throw new Error(`Could not read installed ${packageName} version`);
  return packageJson.version;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
