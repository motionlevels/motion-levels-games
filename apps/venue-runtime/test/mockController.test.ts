import assert from "node:assert/strict";
import { test } from "node:test";
import { ControllerClient } from "../src/controllerClient.ts";
import { startMockControllerServer } from "../src/mockController.ts";

test("startMockControllerServer accepts connections and sends controller hello", async () => {
  const mock = startMockControllerServer({ port: 4299 });
  let connectedState = false;

  const client = new ControllerClient({
    address: "127.0.0.1:4299",
    sourceRevision: "test-rev",
    onPressure() {},
    onConnectionChange(connected) {
      connectedState = connected;
    }
  });

  client.start();

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (client.connected) {
        clearInterval(check);
        resolve();
      }
    }, 10);
  });

  assert.equal(connectedState, true);
  assert.equal(client.adapterRevision, "mock-controller-v2");

  client.stop();
  await mock.close();
});
