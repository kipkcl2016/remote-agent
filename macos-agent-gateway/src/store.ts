import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentKind,
  EventType,
  GatewaySession,
  PermissionMode,
  PairedDevice,
  SessionEvent,
  SessionStatus,
} from "./types.js";

type SessionRow = {
  id: string;
  native_id: string | null;
  agent: AgentKind;
  title: string;
  cwd: string;
  permission_mode: PermissionMode;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  error: string | null;
};

type EventRow = {
  seq: number;
  session_id: string;
  type: EventType;
  payload_json: string;
  created_at: string;
};

type DeviceRow = {
  id: string;
  name: string;
  created_at: string;
  last_seen_at: string;
};

export class GatewayStore {
  readonly database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        native_id TEXT,
        agent TEXT NOT NULL,
        title TEXT NOT NULL,
        cwd TEXT NOT NULL,
        permission_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions(updated_at DESC);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_session_seq_idx ON events(session_id, seq);
    `);
    chmodSync(databasePath, 0o600);
  }

  close(): void {
    try {
      // Truncate WAL file before closing to prevent bloat
      this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Best-effort checkpoint; continue closing
    }
    this.database.close();
  }

  addDevice(id: string, name: string, tokenHash: string, now = new Date().toISOString()): void {
    this.database
      .prepare(
        `INSERT INTO devices (id, name, token_hash, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, name, tokenHash, now, now);
  }

  authenticateDevice(tokenHash: string, now = new Date().toISOString()): string | undefined {
    const row = this.database
      .prepare("SELECT id FROM devices WHERE token_hash = ?")
      .get(tokenHash) as { id: string } | undefined;
    if (!row) return undefined;
    this.database.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, row.id);
    return row.id;
  }

  listDevices(currentDeviceId: string): PairedDevice[] {
    const rows = this.database
      .prepare("SELECT id, name, created_at, last_seen_at FROM devices ORDER BY last_seen_at DESC")
      .all() as unknown as DeviceRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      current: row.id === currentDeviceId,
    }));
  }

  revokeDevice(id: string): boolean {
    return this.database.prepare("DELETE FROM devices WHERE id = ?").run(id).changes > 0;
  }

  createSession(session: GatewaySession): void {
    this.database
      .prepare(
        `INSERT INTO sessions
         (id, native_id, agent, title, cwd, permission_mode, status, created_at, updated_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.nativeId ?? null,
        session.agent,
        session.title,
        session.cwd,
        session.permissionMode,
        session.status,
        session.createdAt,
        session.updatedAt,
        session.error ?? null,
      );
  }

  getSession(id: string): GatewaySession | undefined {
    const row = this.database.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | SessionRow
      | undefined;
    return row ? mapSession(row) : undefined;
  }

  listSessions(options: { agent?: AgentKind; limit?: number } = {}): GatewaySession[] {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 250);
    const rows = options.agent
      ? (this.database
          .prepare("SELECT * FROM sessions WHERE agent = ? ORDER BY updated_at DESC LIMIT ?")
          .all(options.agent, limit) as unknown as SessionRow[])
      : (this.database
          .prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?")
          .all(limit) as unknown as SessionRow[]);
    return rows.map(mapSession);
  }

  updateSession(
    id: string,
    patch: { nativeId?: string; status?: SessionStatus; error?: string | null },
    now = new Date().toISOString(),
  ): GatewaySession | undefined {
    const current = this.getSession(id);
    if (!current) return undefined;
    const nextNativeId = patch.nativeId ?? current.nativeId ?? null;
    const nextStatus = patch.status ?? current.status;
    const nextError = patch.error === undefined ? current.error ?? null : patch.error;
    this.database
      .prepare(
        "UPDATE sessions SET native_id = ?, status = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run(nextNativeId, nextStatus, nextError, now, id);
    return this.getSession(id);
  }

  addEvent(
    sessionId: string,
    type: EventType,
    payload: Record<string, unknown>,
    now = new Date().toISOString(),
  ): SessionEvent {
    const result = this.database
      .prepare(
        "INSERT INTO events (session_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(sessionId, type, JSON.stringify(payload), now);
    return {
      seq: Number(result.lastInsertRowid),
      sessionId,
      type,
      payload,
      createdAt: now,
    };
  }

  listEvents(sessionId: string, afterSeq = 0, limit = 500): SessionEvent[] {
    const rows = this.database
      .prepare(
        `SELECT seq, session_id, type, payload_json, created_at
         FROM events WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
      )
      .all(sessionId, afterSeq, Math.min(Math.max(limit, 1), 2_000)) as unknown as EventRow[];
    return rows.map((row) => ({
      seq: row.seq,
      sessionId: row.session_id,
      type: row.type,
      payload: safeParsePayload(row.payload_json),
      createdAt: row.created_at,
    }));
  }
}

function mapSession(row: SessionRow): GatewaySession {
  return {
    id: row.id,
    ...(row.native_id ? { nativeId: row.native_id } : {}),
    agent: row.agent,
    title: row.title,
    cwd: row.cwd,
    permissionMode: row.permission_mode,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.error ? { error: row.error } : {}),
  };
}

function safeParsePayload(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { raw: value };
  }
}
