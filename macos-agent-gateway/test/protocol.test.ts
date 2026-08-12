import assert from "node:assert/strict";
import test from "node:test";
import { parseCliLine } from "../src/adapters/protocol.js";

test("parses Codex thread and assistant events", () => {
  const started = parseCliLine(
    "codex",
    JSON.stringify({ type: "thread.started", thread_id: "019f-test-thread" }),
  );
  assert.equal(started[0]?.nativeId, "019f-test-thread");
  assert.equal(started[0]?.type, "status");

  const message = parseCliLine(
    "codex",
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Implemented the fix." },
    }),
  );
  assert.deepEqual(message, [
    { type: "output", payload: { stream: "assistant", text: "Implemented the fix." } },
  ]);
});

test("parses Claude session, text, and tool events", () => {
  const initialized = parseCliLine(
    "claude",
    JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-1" }),
  );
  assert.equal(initialized[0]?.nativeId, "claude-session-1");

  const events = parseCliLine(
    "claude",
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I found the issue." },
          { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } },
        ],
      },
    }),
  );
  assert.equal(events.length, 2);
  assert.equal(events[0]?.type, "output");
  assert.equal(events[1]?.type, "tool");

  const userEcho = parseCliLine(
    "claude",
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "Do the task" }] },
    }),
  );
  assert.deepEqual(userEcho, []);

  const result = parseCliLine(
    "claude",
    JSON.stringify({ type: "result", result: "I found the issue." }),
  );
  assert.deepEqual(result, [{ type: "completed", payload: { source: "cli" } }]);
});

test("parses Cursor partial output and preserves plain text", () => {
  const delta = parseCliLine(
    "cursor",
    JSON.stringify({
      type: "stream_event",
      event: { delta: { text: "Working" } },
    }),
  );
  assert.equal(delta[0]?.payload.text, "Working");

  const plain = parseCliLine("cursor", "non-json diagnostic");
  assert.deepEqual(plain, [
    { type: "output", payload: { stream: "stdout", text: "non-json diagnostic" } },
  ]);
});
