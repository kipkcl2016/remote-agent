export type SessionArchiveIdentity = {
  agent: string;
  id: string;
  nativeId?: string;
};

export type SessionArchiveEntry = {
  agent: string;
  sessionKey: string;
  archivedAt: string;
};

function agentArchivePrefix(agent: string): string {
  return agent.toLowerCase();
}

export function sessionArchiveIdentity(session: SessionArchiveIdentity): string {
  const primary = session.nativeId ?? session.id;
  return `${agentArchivePrefix(session.agent)}:${primary}`;
}

export function sessionArchiveLookupKeys(session: SessionArchiveIdentity): string[] {
  const prefix = agentArchivePrefix(session.agent);
  const keys = new Set<string>([`${prefix}:${session.nativeId ?? session.id}`]);
  if (session.nativeId) {
    keys.add(`${prefix}:${session.id}`);
  }
  return [...keys];
}

export function archiveLookupKeysFromEntries(entries: SessionArchiveEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    keys.add(`${entry.agent}:${entry.sessionKey}`);
  }
  return keys;
}

function isArchivedInSet(session: SessionArchiveIdentity, archivedKeys: ReadonlySet<string>): boolean {
  return sessionArchiveLookupKeys(session).some((key) => archivedKeys.has(key));
}

export function canArchiveSession(status: string): boolean {
  return status !== "running" && status !== "attention";
}

export function filterSessionsByArchive<T extends SessionArchiveIdentity>(
  sessions: T[],
  archivedKeys: ReadonlySet<string>,
  mode: "active" | "archived",
): T[] {
  return sessions.filter((session) => {
    const archived = isArchivedInSet(session, archivedKeys);
    return mode === "archived" ? archived : !archived;
  });
}

export function isSessionArchived(
  session: SessionArchiveIdentity,
  archivedKeys: ReadonlySet<string>,
): boolean {
  return isArchivedInSet(session, archivedKeys);
}
