import type { AdapterEvent, AgentKind } from "../types.js";

type JsonObject = Record<string, unknown>;

export function parseCliLine(kind: AgentKind, line: string): AdapterEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return [{ type: "output", payload: { stream: "stdout", text: line } }];
  }

  if (!isObject(value)) {
    return [{ type: "output", payload: { stream: "stdout", value } }];
  }

  const nativeId = findNativeId(value);
  const events = kind === "codex" ? parseCodex(value) : parseClaudeLike(value);
  if (nativeId) {
    if (events.length) {
      const [first, ...rest] = events;
      if (!first) return rest;
      return [{ ...first, nativeId }, ...rest];
    }
    return [{ type: "status", payload: { phase: "initialized" }, nativeId }];
  }
  return events;
}

function parseCodex(event: JsonObject): AdapterEvent[] {
  const type = stringValue(event.type);
  const item = isObject(event.item) ? event.item : undefined;

  if (type === "thread.started") return [];
  if (type === "turn.started") return [{ type: "status", payload: { status: "running" } }];
  if (type === "turn.completed") return [{ type: "completed", payload: { source: "codex" } }];
  if (type === "turn.failed" || type === "error") {
    return [{ type: "error", payload: { message: extractError(event) } }];
  }

  if (item) {
    const itemType = stringValue(item.type);
    const text = stringValue(item.text);
    if (itemType === "agent_message" && text) {
      return [{ type: "output", payload: { stream: "assistant", text } }];
    }
    if (itemType === "command_execution" || itemType === "mcp_tool_call") {
      return [
        {
          type: "tool",
          payload: {
            name: stringValue(item.name) ?? itemType,
            command: stringValue(item.command),
            status: stringValue(item.status),
          },
        },
      ];
    }
  }

  if (type?.includes("approval")) {
    return [{ type: "approval", payload: { raw: event } }];
  }
  return [];
}

function parseClaudeLike(event: JsonObject): AdapterEvent[] {
  const type = stringValue(event.type);
  if (type === "system") return [];
  if (type === "result") {
    return [{ type: "completed", payload: { source: "cli" } }];
  }
  if (type === "error") return [{ type: "error", payload: { message: extractError(event) } }];
  if (type?.includes("permission") || type?.includes("approval")) {
    return [{ type: "approval", payload: { raw: event } }];
  }

  if (type === "stream_event" && isObject(event.event)) {
    const inner = event.event;
    const delta = isObject(inner.delta) ? inner.delta : undefined;
    const text = delta ? stringValue(delta.text) : undefined;
    return text ? [{ type: "output", payload: { stream: "assistant_delta", text } }] : [];
  }

  const message = isObject(event.message) ? event.message : event;
  if (stringValue(message.role) === "user") return [];
  const content = Array.isArray(message.content) ? message.content : [];
  const results: AdapterEvent[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    const blockType = stringValue(block.type);
    if (blockType === "text" && stringValue(block.text)) {
      results.push({
        type: "output",
        payload: { stream: "assistant", text: stringValue(block.text) },
      });
    } else if (blockType === "tool_use") {
      results.push({
        type: "tool",
        payload: {
          id: stringValue(block.id),
          name: stringValue(block.name),
          input: isObject(block.input) ? block.input : { raw: block.input },
        },
      });
    }
  }
  return results;
}

function findNativeId(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || !isObject(value)) return undefined;
  for (const key of ["session_id", "sessionId", "thread_id", "threadId", "chat_id", "chatId"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length >= 6) return candidate;
  }
  for (const key of ["data", "message", "result", "thread", "session"]) {
    const nested = findNativeId(value[key], depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

function extractError(event: JsonObject): string {
  if (typeof event.message === "string") return event.message;
  if (isObject(event.error) && typeof event.error.message === "string") return event.error.message;
  if (typeof event.error === "string") return event.error;
  return "Agent reported an error";
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
