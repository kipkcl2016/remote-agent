import type { AgentAdapter, AgentAvailability, AgentKind } from "./types.js";
import { createClaudeAcpAdapter } from "./adapters/claude-acp.js";
import { createCodexAdapter } from "./adapters/codex.js";
import { createCursorAdapter } from "./adapters/cursor.js";
import { createWorkbuddyAdapter } from "./adapters/workbuddy.js";

export class AgentRegistry {
  readonly #adapters = new Map<AgentKind, AgentAdapter>();

  constructor(adapters: AgentAdapter[] = defaultAdapters()) {
    for (const adapter of adapters) this.#adapters.set(adapter.kind, adapter);
  }

  get(kind: AgentKind): AgentAdapter | undefined {
    return this.#adapters.get(kind);
  }

  async availability(): Promise<AgentAvailability[]> {
    return Promise.all([...this.#adapters.values()].map((adapter) => adapter.detect()));
  }
}

function defaultAdapters(): AgentAdapter[] {
  return [createCursorAdapter(), createClaudeAcpAdapter(), createCodexAdapter(), createWorkbuddyAdapter()];
}
