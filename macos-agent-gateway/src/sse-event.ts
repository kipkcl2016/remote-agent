import type { SessionEvent } from "./types.js";

export const MAX_SSE_EVENT_BYTES = 16_384;

/** Keep the persisted event intact; clients recover large payloads over authenticated JSON. */
export function serializeSseEvent(event: SessionEvent): string {
  const json = JSON.stringify(event);
  if (Buffer.byteLength(json, "utf8") <= MAX_SSE_EVENT_BYTES) return json;
  return JSON.stringify({ ...event, payload: { _truncated: true } });
}
