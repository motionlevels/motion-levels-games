import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cleanHeaderSecret, engineTokenFromEnvironment } from "../src/engineToken.ts";

test("engine history token rejects placeholders and unsafe header values", () => {
  assert.equal(cleanHeaderSecret(undefined), "");
  assert.equal(cleanHeaderSecret("  # provision-me  "), "");
  assert.equal(cleanHeaderSecret(`valid\ninvalid`), "");
  assert.equal(cleanHeaderSecret("x".repeat(8_193)), "");
  assert.equal(cleanHeaderSecret("  exact-secret  "), "exact-secret");
});

test("engine token uses explicit env/file then the provisioned camera fallback", () => {
  const directory = mkdtempSync(join(tmpdir(), "motion-levels-engine-token-"));
  try {
    const engineFile = join(directory, "engine-token");
    const cameraFile = join(directory, "camera-token");
    writeFileSync(engineFile, "file-engine\n", { mode: 0o600 });
    writeFileSync(cameraFile, "file-camera\n", { mode: 0o600 });
    assert.equal(engineTokenFromEnvironment({
      MOTION_LEVELS_ENGINE_TOKEN: "direct-engine",
      MOTION_LEVELS_ENGINE_TOKEN_FILE: engineFile,
      MOTION_LEVELS_CAMERA_RECORDER_TOKEN: "direct-camera"
    }), "direct-engine");
    assert.equal(engineTokenFromEnvironment({
      MOTION_LEVELS_ENGINE_TOKEN: "# placeholder",
      MOTION_LEVELS_ENGINE_TOKEN_FILE: engineFile,
      MOTION_LEVELS_CAMERA_RECORDER_TOKEN: "direct-camera"
    }), "file-engine");
    assert.equal(engineTokenFromEnvironment({
      MOTION_LEVELS_CAMERA_RECORDER_TOKEN: "direct-camera",
      MOTION_LEVELS_CAMERA_RECORDER_TOKEN_FILE: cameraFile
    }), "direct-camera");
    assert.equal(engineTokenFromEnvironment({
      MOTION_LEVELS_CAMERA_RECORDER_TOKEN: "# placeholder",
      MOTION_LEVELS_CAMERA_RECORDER_TOKEN_FILE: cameraFile
    }), "file-camera");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
