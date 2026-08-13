import assert from "node:assert/strict";
import test from "node:test";
import { SerializedCommandExecutor } from "../src/commandExecutor.ts";

test("commands are serialized and UUID retries return the original result", async () => {
  const executor = new SerializedCommandExecutor<{ revision: number }>();
  const order: string[] = [];
  let revision = 0;
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";
  const first = executor.execute(firstId, async () => {
    order.push("first:start");
    await Promise.resolve();
    order.push("first:end");
    return { revision: ++revision };
  });
  const second = executor.execute(secondId, () => {
    order.push("second");
    return { revision: ++revision };
  });
  assert.deepEqual(await first, { revision: 1 });
  assert.deepEqual(await second, { revision: 2 });
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
  assert.deepEqual(await executor.execute(firstId, () => ({ revision: ++revision })), { revision: 1 });
  assert.equal(revision, 2);
});

test("malformed command IDs fail before mutation", async () => {
  const executor = new SerializedCommandExecutor<number>();
  await assert.rejects(executor.execute("not-a-uuid", () => 1), /commandId must be a UUID/);
});
