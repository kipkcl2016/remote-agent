import type { SessionEvent } from "./types.js";

type Listener = (event: SessionEvent) => void;

export class EventHub {
  readonly #listeners = new Map<string, Set<Listener>>();

  publish(event: SessionEvent): void {
    for (const listener of this.#listeners.get(event.sessionId) ?? []) listener(event);
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    const listeners = this.#listeners.get(sessionId) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.#listeners.delete(sessionId);
    };
  }
}
