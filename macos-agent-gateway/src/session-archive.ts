import type { AgentKind, SessionStatus } from "./types.js";

export type SessionArchiveRecord = {
  agent: AgentKind;
  sessionKey: string;
  archivedAt: string;
};

const BLOCKED_ARCHIVE_STATUSES = new Set<SessionStatus>([
  "running",
  "queued",
  "waiting_approval",
]);

export function sessionArchiveKeys(agent: AgentKind, id: string, nativeId?: string): string[] {
  const primary = nativeId ?? id;
  const keys = new Set<string>([primary]);
  if (nativeId && nativeId !== id) keys.add(id);
  return [...keys];
}

export function sessionArchiveLookupKey(agent: AgentKind, sessionKey: string): string {
  return `${agent}:${sessionKey}`;
}

export function buildSessionArchiveLookupSet(records: SessionArchiveRecord[]): Set<string> {
  const keys = new Set<string>();
  for (const record of records) {
    keys.add(sessionArchiveLookupKey(record.agent, record.sessionKey));
  }
  return keys;
}

export function isArchiveBlockedStatus(status: SessionStatus | "running" | undefined): boolean {
  if (!status) return false;
  if (status === "running") return true;
  return BLOCKED_ARCHIVE_STATUSES.has(status as SessionStatus);
}

export function filterByArchiveVisibility<
  T extends { agent: AgentKind; id: string; nativeId?: string },
>(
  items: T[],
  archivedKeys: Set<string>,
  visibility: "active" | "archived",
): T[] {
  return items.filter((item) => {
    const archived = sessionArchiveKeys(item.agent, item.id, item.nativeId).some((key) => (
      archivedKeys.has(sessionArchiveLookupKey(item.agent, key))
    ));
    return visibility === "archived" ? archived : !archived;
  });
}
