export type GatewayStreamEvent = {
  id?: string;
  event?: string;
  data?: string;
};

export type GatewaySessionStreamHandle = {
  close: () => void;
};

type StreamCallbacks = {
  onGatewayEvent: (payload: unknown) => void;
  onStreamError: (error: Error) => void;
  onStreamClosed: () => void;
};

const SSE_RECONNECT_MS = 2_000;
const MAX_SSE_FAILURES = 3;

export function parseSseBuffer(buffer: string): { messages: GatewayStreamEvent[]; remainder: string } {
  const messages: GatewayStreamEvent[] = [];
  let working = buffer.replace(/\r\n/g, "\n");
  let splitAt = working.indexOf("\n\n");
  while (splitAt >= 0) {
    const block = working.slice(0, splitAt);
    working = working.slice(splitAt + 2);
    splitAt = working.indexOf("\n\n");
    if (!block.trim() || block.trimStart().startsWith(":")) continue;
    const message: GatewayStreamEvent = {};
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator >= 0 ? line.slice(0, separator) : line;
      const value = separator >= 0 ? line.slice(separator + 1).replace(/^\s/, "") : "";
      if (field === "id") message.id = value;
      else if (field === "event") message.event = value;
      else if (field === "data") message.data = message.data ? `${message.data}\n${value}` : value;
    }
    if (message.data !== undefined) messages.push(message);
  }
  return { messages, remainder: working };
}

export function openGatewaySessionEventStream(options: {
  baseUrl: string;
  sessionId: string;
  token: string;
  getAfterSeq: () => number;
  shouldContinue: () => boolean;
  callbacks: StreamCallbacks;
}): GatewaySessionStreamHandle {
  let closed = false;
  let failureCount = 0;
  let reconnectTimer: number | undefined;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const abortController = new AbortController();

  const scheduleReconnect = () => {
    if (closed || !options.shouldContinue()) return;
    failureCount += 1;
    if (failureCount >= MAX_SSE_FAILURES) {
      options.callbacks.onStreamClosed();
      return;
    }
    reconnectTimer = window.setTimeout(() => void connect(), SSE_RECONNECT_MS);
  };

  const connect = async () => {
    if (closed || !options.shouldContinue()) return;
    const after = options.getAfterSeq();
    const url = `${options.baseUrl}/v1/sessions/${encodeURIComponent(options.sessionId)}/events?after=${after}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${options.token}`,
          ...(after > 0 ? { "Last-Event-ID": String(after) } : {}),
        },
        signal: abortController.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? `Mac 网关返回 ${response.status}`);
      }
      if (!response.body) throw new Error("Mac 网关 SSE 响应无效");
      failureCount = 0;
      activeReader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!closed && options.shouldContinue()) {
        const { done, value } = await activeReader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseBuffer(buffer);
        buffer = parsed.remainder;
        for (const message of parsed.messages) {
          try {
            options.callbacks.onGatewayEvent(JSON.parse(message.data ?? "{}"));
          } catch (error) {
            options.callbacks.onStreamError(error instanceof Error ? error : new Error("无法解析 SSE 事件"));
          }
        }
      }
      activeReader.releaseLock();
      activeReader = null;
      scheduleReconnect();
    } catch (error) {
      if (closed || (error instanceof DOMException && error.name === "AbortError")) return;
      options.callbacks.onStreamError(error instanceof Error ? error : new Error("SSE 连接失败"));
      scheduleReconnect();
    }
  };

  void connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      abortController.abort();
      void activeReader?.cancel().catch(() => undefined);
    },
  };
}
