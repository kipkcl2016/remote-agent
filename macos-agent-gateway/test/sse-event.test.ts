import assert from "node:assert/strict";
import test from "node:test";
import { serializeSseEvent, MAX_SSE_EVENT_BYTES } from "../src/sse-event.js";
import type { SessionEvent } from "../src/types.js";

test("[STREAM-002] SSE preserves small events and replaces oversized UTF-8 payloads with recoverable markers", () => {
  const base: SessionEvent = { seq: 12, sessionId: "synthetic", type: "output", createdAt: "2026-10-11T00:00:00Z", payload: { text: "hello" } };
  assert.deepEqual(JSON.parse(serializeSseEvent(base)), base);
  for (const text of ["a".repeat(20_000), "中😀\"\\\n".repeat(4_000)]) {
    const event = { ...base, payload: { stream: "assistant", text } };
    const json = serializeSseEvent(event);
    assert.ok(Buffer.byteLength(json, "utf8") <= MAX_SSE_EVENT_BYTES);
    assert.deepEqual(JSON.parse(json), { ...base, payload: { _truncated: true } });
    assert.equal(event.payload.text, text, "stored event must remain unchanged");
  }
});
