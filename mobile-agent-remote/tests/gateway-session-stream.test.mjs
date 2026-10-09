import assert from "node:assert/strict";
import test from "node:test";
import { parseSseBuffer } from "../src/gateway-session-stream.ts";

test("parseSseBuffer splits heartbeat comments and JSON event blocks", () => {
  const input = ": connected\n\nid: 2\nevent: output\ndata: {\"seq\":2}\n\n: heartbeat\n\n";
  const first = parseSseBuffer(input);
  assert.equal(first.messages.length, 1);
  assert.equal(first.messages[0]?.id, "2");
  assert.equal(first.messages[0]?.event, "output");
  assert.deepEqual(JSON.parse(first.messages[0]?.data ?? "{}"), { seq: 2 });
  assert.equal(first.remainder, "");

  const partial = "id: 3\nevent: status\ndata: {\"seq\":";
  const second = parseSseBuffer(partial);
  assert.equal(second.messages.length, 0);
  assert.equal(second.remainder, partial);

  const completed = parseSseBuffer(`${second.remainder}3,\"type\":\"status\"}\n\n`);
  assert.equal(completed.messages.length, 1);
  assert.equal(completed.messages[0]?.id, "3");
});
