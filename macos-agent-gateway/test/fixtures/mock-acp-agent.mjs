#!/usr/bin/env node
/**
 * Minimal ACP agent for gateway tests.
 * Speaks NDJSON JSON-RPC on stdio: initialize, session/new, session/prompt,
 * session/request_permission, session/update, session/cancel.
 */
import { createInterface } from "node:readline";

let nextId = 1;
const pending = new Map();
let currentSessionId = null;
let cancelled = false;

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function notify(method, params) {
  write({ jsonrpc: "2.0", method, params });
}

function respond(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function request(method, params) {
  const id = nextId++;
  write({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

async function handlePrompt(sessionId, promptText) {
  cancelled = false;
  notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `Echo: ${promptText}\n` },
    },
  });
  notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "call_demo_1",
      name: "execute",
      title: "Run demo command",
      kind: "execute",
      status: "pending",
      rawInput: { command: "echo demo" },
    },
  });

  const permission = await request("session/request_permission", {
    sessionId,
    toolCall: {
      toolCallId: "call_demo_1",
      title: "Run demo command",
      kind: "execute",
      name: "execute",
      status: "pending",
    },
    options: [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject-once", name: "Reject", kind: "reject_once" },
    ],
  });

  if (cancelled || permission?.outcome?.outcome === "cancelled") {
    return { stopReason: "cancelled" };
  }

  const selected = permission?.outcome?.optionId;
  if (selected === "reject-once") {
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_demo_1",
        status: "failed",
      },
    });
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Tool rejected by user.\n" },
      },
    });
    return { stopReason: "end_turn" };
  }

  notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_demo_1",
      status: "completed",
      rawOutput: { ok: true },
    },
  });
  notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Tool allowed and finished.\n" },
    },
  });
  return { stopReason: "end_turn" };
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (message.id != null && (message.result !== undefined || message.error !== undefined)) {
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "error"));
      else waiter.resolve(message.result);
    }
    return;
  }

  const { id, method, params } = message;
  if (method === "initialize") {
    respond(id, {
      protocolVersion: params?.protocolVersion ?? 1,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
      },
      agentInfo: { name: "mock-acp-agent", version: "0.0.1" },
    });
    return;
  }

  if (method === "session/new") {
    currentSessionId = `mock-session-${Date.now()}`;
    respond(id, { sessionId: currentSessionId });
    return;
  }

  if (method === "session/cancel") {
    cancelled = true;
    for (const [reqId, waiter] of pending) {
      pending.delete(reqId);
      // Cancel outstanding permission by resolving as cancelled via crafted result
      waiter.resolve({ outcome: { outcome: "cancelled" } });
    }
    respond(id, {});
    return;
  }

  if (method === "session/prompt") {
    const sessionId = params?.sessionId ?? currentSessionId;
    const blocks = params?.prompt ?? [];
    const text = blocks
      .map((block) => (block?.type === "text" ? block.text : ""))
      .join("")
      .trim() || "hi";
    try {
      const result = await handlePrompt(sessionId, text);
      respond(id, result);
    } catch (error) {
      write({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      });
    }
    return;
  }

  if (id != null) {
    write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
});
