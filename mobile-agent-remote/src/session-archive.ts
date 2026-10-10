export const SESSION_ARCHIVE_KEY = "remote-agent.session-archive.v1";

export type SessionArchiveIdentity = {
  agent: string;
  id: string;
  nativeId?: string;
};

export type SessionArchiveRecord = {
  version: 1;
  url: string;
  archivedAt: Record<string, string>;
};

export function sessionArchiveIdentity(session: SessionArchiveIdentity): string {
  return `${session.agent}:${session.nativeId ?? session.id}`;
}

export function sessionArchiveLookupKeys(session: SessionArchiveIdentity): string[] {
  const keys = new Set<string>([sessionArchiveIdentity(session)]);
  if (session.nativeId) {
    keys.add(`${session.agent}:${session.id}`);
  }
  return [...keys];
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

export function readSessionArchiveKeys(url: string): Set<string> {
  const record = readSessionArchiveRecord(url);
  if (!record) return new Set();
  return new Set(Object.keys(record.archivedAt));
}

export function archiveSession(url: string, session: SessionArchiveIdentity): boolean {
  if (!url) return false;
  const record = readSessionArchiveRecord(url) ?? {
    version: 1,
    url,
    archivedAt: {},
  };
  record.archivedAt[sessionArchiveIdentity(session)] = new Date().toISOString();
  writeSessionArchiveRecord(record);
  return true;
}

export function restoreSession(url: string, session: SessionArchiveIdentity): boolean {
  if (!url) return false;
  const record = readSessionArchiveRecord(url);
  if (!record) return false;
  const key = sessionArchiveIdentity(session);
  if (!(key in record.archivedAt)) return false;
  delete record.archivedAt[key];
  writeSessionArchiveRecord(record);
  return true;
}

export function isSessionArchived(
  url: string,
  session: SessionArchiveIdentity,
  archivedKeys?: ReadonlySet<string>,
): boolean {
  if (!url) return false;
  const keys = archivedKeys ?? readSessionArchiveKeys(url);
  return isArchivedInSet(session, keys);
}

function readSessionArchiveRecord(url: string): SessionArchiveRecord | null {
  if (!url) return null;
  try {
    const raw = localStorage.getItem(sessionArchiveStorageKey(url)) ?? localStorage.getItem(SESSION_ARCHIVE_KEY);
    const parsed = JSON.parse(raw ?? "null") as unknown;
    if (!isRecord(parsed)
      || parsed.version !== 1
      || parsed.url !== url
      || !isRecord(parsed.archivedAt)) return null;
    const archivedAt = Object.fromEntries(
      Object.entries(parsed.archivedAt)
        .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
        .slice(-2_000),
    );
    return { version: 1, url, archivedAt };
  } catch {
    return null;
  }
}

function writeSessionArchiveRecord(record: SessionArchiveRecord): void {
  try {
    const archivedAt = Object.fromEntries(Object.entries(record.archivedAt).slice(-2_000));
    localStorage.setItem(sessionArchiveStorageKey(record.url), JSON.stringify({ ...record, archivedAt }));
    localStorage.removeItem(SESSION_ARCHIVE_KEY);
  } catch {
    // Archive markers are local UI state and must never block live session rendering.
  }
}

function sessionArchiveStorageKey(url: string): string {
  return `${SESSION_ARCHIVE_KEY}.${localGatewayBucket(url)}`;
}

function localGatewayBucket(url: string): string {
  const normalized = url.replace(/\/+$/, "") || url;
  let hash = 2_166_136_261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
