import type { AdapterEvent } from "../../types.js";

type JsonObject = Record<string, unknown>;

/**
 * Map one ACP `session/update` payload into gateway AdapterEvent(s).
 * Unknown update kinds are ignored (PoC).
 */
export function mapAcpSessionUpdate(update: unknown): AdapterEvent[] {
  if (!isObject(update)) return [];
  const kind = stringValue(update.sessionUpdate);
  if (!kind) return [];

  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    const content = isObject(update.content) ? update.content : undefined;
    const text = content ? stringValue(content.text) : undefined;
    if (!text) return [];
    const stream = kind === "agent_thought_chunk" ? "reasoning" : "assistant_delta";
    return [{ type: "output", payload: { stream, text } }];
  }

  if (kind === "tool_call") {
    return [
      {
        type: "tool",
        payload: {
          id: stringValue(update.toolCallId),
          name: stringValue(update.name) ?? stringValue(update.title) ?? "tool",
          kind: stringValue(update.kind),
          status: stringValue(update.status) ?? "pending",
          input: update.rawInput,
        },
      },
    ];
  }

  if (kind === "tool_call_update") {
    return [
      {
        type: "tool",
        payload: {
          id: stringValue(update.toolCallId),
          name: stringValue(update.name) ?? stringValue(update.title),
          kind: stringValue(update.kind),
          status: stringValue(update.status),
          input: update.rawInput,
          output: update.rawOutput,
        },
      },
    ];
  }

  if (kind === "plan") {
    return [{ type: "output", payload: { stream: "plan", entries: update.entries } }];
  }

  if (kind === "current_mode_update") {
    return [{ type: "status", payload: { phase: "mode", modeId: update.modeId } }];
  }

  return [];
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
