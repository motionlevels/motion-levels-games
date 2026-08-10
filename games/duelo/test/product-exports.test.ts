import assert from "node:assert/strict";
import test from "node:test";
import * as product from "../src/index.ts";

test("product entrypoint exposes the semantic Jugar adapter but not test harness internals", () => {
  assert.equal(product.manifest.id, "duelo");
  assert.equal(typeof product.createGame, "function");
  assert.equal(typeof product.PlayerDisplay, "function");
  assert.equal(typeof product.createSessionController, "function");
  assert.equal("createDueloAgentHarness" in product, false);
  assert.equal("createDueloAgentDirector" in product, false);
});
