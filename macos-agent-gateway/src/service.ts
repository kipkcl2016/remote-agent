import { randomUUID } from "node:crypto";
import { EventHub } from "./event-hub.js";
import { AgentRegistry } from "./agent-registry.js";
import { resolveAllowedWorkingDirectory } from "./security.js";
import { GatewayStore } from "./store.js";
import { ProjectResolver } from "./project-resolver.js";
import type {
  AdapterEvent,
  AgentAvailability,
  AgentKind,
  GatewaySession,
  RunningAgent,
  SessionEvent,
  StartSessionInput,
  NativeHistorySession,
  PermissionMode,
} from "./types.js";

export class GatewayService {
  readonly #active = new Map<string, RunningAgent>();
  readonly #projects: ProjectResolver;

  constructor(
    readonly store: GatewayStore,
    readonly registry: AgentRegistry,
    readonly events: EventHub,
    readonly allowedRoots: string[],
  ) {
    this.#projects = new ProjectResolver(allowedRoots);
  }

  async listAgents(): Promise<AgentAvailability[]> {
    return this.registry.availability();
  }

  listSessions(options: { agent?: AgentKind; limit?: number } = {}): GatewaySession[] {
    return this.store.listSessions(options).map((session) => this.#withProject(session));
  }

  getSession(id: string): GatewaySession | undefined {
    const session = this.store.getSession(id);
    return session ? this.#withProject(session) : undefined;
  }

  listEvents(sessionId: string, afterSeq = 0): SessionEvent[] {
    return this.store.listEvents(sessionId, afterSeq);
  }

  async startSession(input: StartSessionInput): Promise<GatewaySession> {
    const adapter = this.registry.get(input.agent);
    if (!adapter) throw new Error(`Unsupported agent: ${input.agent}`);
    const cwd = resolveAllowedWorkingDirectory(input.cwd, this.allowedRoots);
    const now = new Date().toISOString();
    const session: GatewaySession = {
      id: randomUUID(),
      agent: input.agent,
      title: titleFromPrompt(input.prompt),
      cwd,
      permissionMode: input.permissionMode,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.store.createSession(session);
    this.record(session.id, { type: "status", payload: { status: "queued" } });
    this.record(session.id, { type: "output", payload: { stream: "user", text: input.prompt } });
    await this.launch(session, input.prompt);
    return this.getSession(session.id) ?? this.#withProject(session);
  }

  async resumeNativeSession(
    native: NativeHistorySession,
    prompt: string,
    permissionMode: PermissionMode,
  ): Promise<GatewaySession> {
    if (!native.resumable) throw new Error("This native session is browse-only");
    const cwd = resolveAllowedWorkingDirectory(native.cwd, this.allowedRoots);
    const now = new Date().toISOString();
    const session: GatewaySession = {
      id: randomUUID(),
      nativeId: native.id,
      agent: native.agent,
      title: native.title,
      cwd,
      permissionMode,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.store.createSession(session);
    this.record(session.id, {
      type: "status",
      payload: { status: "queued", importedFromNativeHistory: true },
    });
    this.record(session.id, { type: "output", payload: { stream: "user", text: prompt } });
    await this.launch(session, prompt);
    return this.getSession(session.id) ?? this.#withProject(session);
  }

  async continueSession(id: string, prompt: string): Promise<GatewaySession> {
    const session = this.store.getSession(id);
    if (!session) throw new Error("Session not found");
    if (this.#active.has(id)) throw new Error("Session is already running");
    if (!session.nativeId) throw new Error("The native agent session id is not available yet");
    this.store.updateSession(id, { status: "queued", error: null });
    this.record(id, { type: "status", payload: { status: "queued", continuation: true } });
    this.record(id, { type: "output", payload: { stream: "user", text: prompt } });
    await this.launch(session, prompt);
    return this.getSession(id) ?? this.#withProject(session);
  }

  cancelSession(id: string): GatewaySession {
    const session = this.store.getSession(id);
    if (!session) throw new Error("Session not found");
    const running = this.#active.get(id);
    if (!running) throw new Error("Session is not currently running");
    running.cancel();
    this.store.updateSession(id, { status: "cancelled", error: null });
    this.record(id, { type: "status", payload: { status: "cancelled" } });
    return this.getSession(id) ?? this.#withProject(session);
  }

  stop(): void {
    for (const running of this.#active.values()) running.cancel();
    this.#active.clear();
  }

  async launch(session: GatewaySession, prompt: string): Promise<void> {
    const adapter = this.registry.get(session.agent);
    if (!adapter) throw new Error(`Unsupported agent: ${session.agent}`);

    this.store.updateSession(session.id, { status: "running", error: null });
    this.record(session.id, { type: "status", payload: { status: "running" } });

    try {
      const running = await adapter.launch(
        {
          prompt,
          cwd: session.cwd,
          permissionMode: session.permissionMode,
          ...(session.nativeId ? { nativeId: session.nativeId } : {}),
        },
        (event) => this.record(session.id, event),
      );
      this.#active.set(session.id, running);
      void running.done.finally(() => this.#active.delete(session.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.record(session.id, { type: "error", payload: { message } });
      throw error;
    }
  }

  record(sessionId: string, event: AdapterEvent): SessionEvent {
    const current = this.store.getSession(sessionId);
    if (!current) throw new Error("Cannot record an event for an unknown session");

    const patch: { nativeId?: string; status?: GatewaySession["status"]; error?: string | null } = {};
    if (event.nativeId) patch.nativeId = event.nativeId;
    if (event.type === "approval") patch.status = "waiting_approval";
    else if (event.type === "completed") patch.status = "completed";
    else if (event.type === "error") {
      patch.status = "failed";
      patch.error = typeof event.payload.message === "string" ? event.payload.message : "Agent failed";
    } else if (event.type === "status") {
      const status = event.payload.status;
      if (status === "cancelled") patch.status = "cancelled";
      else if (status === "running" || status === "queued") patch.status = status;
    } else if (current.status === "queued") {
      patch.status = "running";
    }
    if (Object.keys(patch).length) this.store.updateSession(sessionId, patch);

    const saved = this.store.addEvent(sessionId, event.type, event.payload);
    this.events.publish(saved);
    return saved;
  }

  #withProject(session: GatewaySession): GatewaySession {
    return { ...session, ...this.#projects.resolveStored(session.cwd) };
  }
}

function titleFromPrompt(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (!collapsed) return "新会话";
  return collapsed.length > 60 ? `${collapsed.slice(0, 59)}…` : collapsed;
}
