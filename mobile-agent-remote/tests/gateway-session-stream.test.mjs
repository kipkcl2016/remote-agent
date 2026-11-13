import assert from "node:assert/strict";
import test from "node:test";
import { parseSseBuffer, openGatewaySessionEventStream } from "../src/gateway-session-stream.ts";

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

test("[STREAM-002] recover oversized events before delivering later events or advancing the cursor", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  const full = { seq: 7, type: "output", payload: { text: "中😀".repeat(10_000) } };
  const marker = { ...full, payload: { _truncated: true } };
  const next = { seq: 8, type: "completed", payload: {} };
  const calls = [];
  const received = [];
  let handle;
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, headers: init.headers });
      if (init.headers.Accept === "application/json") return Response.json({ data: [full, next] });
      return new Response(`id: 7\ndata: ${JSON.stringify(marker)}\n\nid: 8\ndata: ${JSON.stringify(next)}\n\n`);
    };
    await new Promise((resolve, reject) => {
      handle = openGatewaySessionEventStream({
        baseUrl: "http://fixture.test", sessionId: "synthetic", token: "synthetic-token", getAfterSeq: () => 6,
        shouldContinue: () => received.length < 2,
        callbacks: { onGatewayEvent: (event) => { received.push(event); if (received.length === 2) resolve(); }, onStreamError: reject, onStreamClosed: () => reject(new Error("unexpected fallback")) },
      });
    });
    assert.deepEqual(received, [full, next]);
    assert.match(calls[1].url, /events\?after=6$/);
    assert.equal(calls[1].headers.Authorization, "Bearer synthetic-token");
    assert.equal(calls[0].headers["Last-Event-ID"], "6");
  } finally {
    handle?.close(); globalThis.fetch = originalFetch; globalThis.window = originalWindow;
  }
});

test("[STREAM-002] failed recovery does not skip the missing event", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  const received = [];
  let handle;
  try {
    globalThis.fetch = async (_url, init) => init.headers.Accept === "application/json"
      ? Response.json({ error: { message: "unavailable" } }, { status: 503 })
      : new Response('data: {"seq":7,"payload":{"_truncated":true}}\n\ndata: {"seq":8,"payload":{}}\n\n');
    await new Promise((resolve) => {
      handle = openGatewaySessionEventStream({
        baseUrl: "http://fixture.test", sessionId: "synthetic", token: "synthetic-token", getAfterSeq: () => 6, shouldContinue: () => true,
        callbacks: { onGatewayEvent: (event) => received.push(event), onStreamError: () => { handle.close(); resolve(); }, onStreamClosed: () => {} },
      });
    });
    assert.deepEqual(received, []);
  } finally {
    handle?.close(); globalThis.fetch = originalFetch; globalThis.window = originalWindow;
  }
});
