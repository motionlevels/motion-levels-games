import assert from "node:assert/strict";
import test from "node:test";
import { authorizeEngineRequest, engineTokenHeader } from "../src/httpServer.ts";

test("loopback peers can use the engine adapter directly", () => {
  assert.equal(authorizeEngineRequest("127.0.0.1", "", undefined), true);
  assert.equal(authorizeEngineRequest("::1", "", undefined), true);
  assert.equal(authorizeEngineRequest("::ffff:127.0.0.1", "", undefined), true);
});

test("container peers require the exact shared engine token", () => {
  assert.equal(engineTokenHeader, "x-motion-levels-engine-token");
  assert.equal(authorizeEngineRequest("172.20.0.8", "secret", undefined), false);
  assert.equal(authorizeEngineRequest("172.20.0.8", "secret", "wrong"), false);
  assert.equal(authorizeEngineRequest("172.20.0.8", "secret", "secret"), true);
  assert.equal(authorizeEngineRequest("172.20.0.8", "", ""), false);
});
