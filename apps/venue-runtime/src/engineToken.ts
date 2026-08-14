import { readFileSync } from "node:fs";

const maximumHeaderSecretLength = 8_192;

export function engineTokenFromEnvironment(environment: NodeJS.ProcessEnv = process.env): string {
  return cleanHeaderSecret(environment.MOTION_LEVELS_ENGINE_TOKEN)
    || tokenFromFile(environment.MOTION_LEVELS_ENGINE_TOKEN_FILE)
    || cleanHeaderSecret(environment.MOTION_LEVELS_CAMERA_RECORDER_TOKEN)
    || tokenFromFile(environment.MOTION_LEVELS_CAMERA_RECORDER_TOKEN_FILE);
}

export function cleanHeaderSecret(value: string | undefined): string {
  const candidate = value?.trim() ?? "";
  if (!candidate || candidate.startsWith("#") || candidate.length > maximumHeaderSecretLength
    || [...candidate].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })) return "";
  return candidate;
}

function tokenFromFile(path: string | undefined): string {
  const candidate = path?.trim();
  if (!candidate) return "";
  try {
    return cleanHeaderSecret(readFileSync(candidate, "utf8"));
  } catch {
    return "";
  }
}
