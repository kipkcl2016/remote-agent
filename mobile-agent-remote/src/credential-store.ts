import { Capacitor, registerPlugin } from "@capacitor/core";

type SecureCredentialsPlugin = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

export type SavedGatewayConnection = {
  id: string;
  url: string;
  token: string;
  name: string;
  lastUsedAt: string;
};

export type GatewayConnectionStore = {
  version: 1;
  activeId: string;
  connections: SavedGatewayConnection[];
};

const SecureCredentials = registerPlugin<SecureCredentialsPlugin>("SecureCredentials");

export const GATEWAY_URL_KEY = "remote-agent.gateway.url";
export const GATEWAY_TOKEN_KEY = "remote-agent.gateway.token";
export const GATEWAY_CONNECTIONS_KEY = "remote-agent.gateway.connections.v1";
export const MAX_SAVED_CONNECTIONS = 8;

export function readWebGatewayCredentials(): { url: string; token: string } {
  if (Capacitor.isNativePlatform()) return { url: "", token: "" };
  const store = parseConnectionStore(localStorage.getItem(GATEWAY_CONNECTIONS_KEY));
  const active = activeConnection(store);
  if (active) return { url: active.url, token: active.token };
  return {
    url: localStorage.getItem(GATEWAY_URL_KEY) ?? import.meta.env.VITE_REMOTE_AGENT_URL ?? "",
    token: localStorage.getItem(GATEWAY_TOKEN_KEY) ?? "",
  };
}

export async function loadGatewayConnections(): Promise<GatewayConnectionStore> {
  const stored = Capacitor.isNativePlatform()
    ? parseConnectionStore((await SecureCredentials.get({ key: GATEWAY_CONNECTIONS_KEY })).value)
    : parseConnectionStore(localStorage.getItem(GATEWAY_CONNECTIONS_KEY));
  if (stored.connections.length) return stored;

  const legacy = await readLegacyCredentials();
  if (!legacy.url || !legacy.token) return emptyConnectionStore();
  const migrated = storeWithConnection(emptyConnectionStore(), legacy.url, legacy.token, "Mac");
  await persistConnectionStore(migrated);
  await removeLegacyCredentials();
  return migrated;
}

export async function saveGatewayConnection(
  url: string,
  token: string,
  name = "Mac",
): Promise<GatewayConnectionStore> {
  const current = await loadGatewayConnections();
  const next = storeWithConnection(current, url, token, name);
  await persistConnectionStore(next);
  return next;
}

export async function activateGatewayConnection(id: string): Promise<GatewayConnectionStore> {
  const current = await loadGatewayConnections();
  const selected = current.connections.find((connection) => connection.id === id);
  if (!selected) throw new Error("保存的 Mac 连接不存在");
  const updated = { ...selected, lastUsedAt: new Date().toISOString() };
  const next = {
    version: 1 as const,
    activeId: id,
    connections: [
      updated,
      ...current.connections.filter((connection) => connection.id !== id),
    ].slice(0, MAX_SAVED_CONNECTIONS),
  };
  await persistConnectionStore(next);
  return next;
}

export async function updateGatewayConnectionName(
  url: string,
  name: string,
): Promise<GatewayConnectionStore> {
  const current = await loadGatewayConnections();
  const normalizedUrl = normalizeUrl(url);
  const normalizedName = cleanName(name);
  const existing = current.connections.find((connection) => connection.url === normalizedUrl);
  if (!existing || !normalizedName || existing.name === normalizedName) return current;
  const next = {
    ...current,
    connections: current.connections.map((connection) => (
      connection.id === existing.id ? { ...connection, name: normalizedName } : connection
    )),
  };
  await persistConnectionStore(next);
  return next;
}

export async function removeGatewayConnection(id: string): Promise<GatewayConnectionStore> {
  const current = await loadGatewayConnections();
  const remaining = current.connections
    .filter((connection) => connection.id !== id)
    .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
  const activeId = current.activeId === id
    ? remaining[0]?.id ?? ""
    : current.activeId;
  const next = { version: 1 as const, activeId, connections: remaining };
  await persistConnectionStore(next);
  return next;
}

export async function clearGatewayCredentials(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    localStorage.removeItem(GATEWAY_CONNECTIONS_KEY);
    localStorage.removeItem(GATEWAY_URL_KEY);
    localStorage.removeItem(GATEWAY_TOKEN_KEY);
    return;
  }
  await Promise.all([
    SecureCredentials.remove({ key: GATEWAY_CONNECTIONS_KEY }),
    SecureCredentials.remove({ key: GATEWAY_URL_KEY }),
    SecureCredentials.remove({ key: GATEWAY_TOKEN_KEY }),
  ]);
}

export function activeConnection(
  store: GatewayConnectionStore,
): SavedGatewayConnection | undefined {
  return store.connections.find((connection) => connection.id === store.activeId)
    ?? store.connections[0];
}

function emptyConnectionStore(): GatewayConnectionStore {
  return { version: 1, activeId: "", connections: [] };
}

function storeWithConnection(
  current: GatewayConnectionStore,
  url: string,
  token: string,
  name: string,
): GatewayConnectionStore {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl || !token) throw new Error("Mac 连接凭据无效");
  const existing = current.connections.find((connection) => connection.url === normalizedUrl);
  const now = new Date().toISOString();
  const connection: SavedGatewayConnection = {
    id: existing?.id ?? connectionId(normalizedUrl),
    url: normalizedUrl,
    token,
    name: cleanName(name) || existing?.name || hostLabel(normalizedUrl),
    lastUsedAt: now,
  };
  return {
    version: 1,
    activeId: connection.id,
    connections: [
      connection,
      ...current.connections.filter((candidate) => candidate.id !== connection.id),
    ].slice(0, MAX_SAVED_CONNECTIONS),
  };
}

function parseConnectionStore(raw: string | null): GatewayConnectionStore {
  if (!raw) return emptyConnectionStore();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.connections)) {
      return emptyConnectionStore();
    }
    const connections = parsed.connections.slice(0, MAX_SAVED_CONNECTIONS).flatMap((value) => {
      if (!isRecord(value)) return [];
      const url = typeof value.url === "string" ? normalizeUrl(value.url) : "";
      if (!url || typeof value.token !== "string" || !value.token) return [];
      return [{
        id: typeof value.id === "string" && value.id ? value.id : connectionId(url),
        url,
        token: value.token,
        name: typeof value.name === "string" ? cleanName(value.name) || hostLabel(url) : hostLabel(url),
        lastUsedAt: typeof value.lastUsedAt === "string" ? value.lastUsedAt : new Date(0).toISOString(),
      } satisfies SavedGatewayConnection];
    });
    const requestedActiveId = typeof parsed.activeId === "string" ? parsed.activeId : "";
    return {
      version: 1,
      activeId: connections.some((connection) => connection.id === requestedActiveId)
        ? requestedActiveId
        : connections[0]?.id ?? "",
      connections,
    };
  } catch {
    return emptyConnectionStore();
  }
}

async function persistConnectionStore(store: GatewayConnectionStore): Promise<void> {
  const value = JSON.stringify(store);
  if (!Capacitor.isNativePlatform()) {
    if (store.connections.length) localStorage.setItem(GATEWAY_CONNECTIONS_KEY, value);
    else localStorage.removeItem(GATEWAY_CONNECTIONS_KEY);
    localStorage.removeItem(GATEWAY_URL_KEY);
    localStorage.removeItem(GATEWAY_TOKEN_KEY);
    return;
  }
  if (store.connections.length) {
    await SecureCredentials.set({ key: GATEWAY_CONNECTIONS_KEY, value });
  } else {
    await SecureCredentials.remove({ key: GATEWAY_CONNECTIONS_KEY });
  }
}

async function readLegacyCredentials(): Promise<{ url: string; token: string }> {
  if (!Capacitor.isNativePlatform()) {
    return {
      url: localStorage.getItem(GATEWAY_URL_KEY) ?? import.meta.env.VITE_REMOTE_AGENT_URL ?? "",
      token: localStorage.getItem(GATEWAY_TOKEN_KEY) ?? "",
    };
  }
  const [url, token] = await Promise.all([
    SecureCredentials.get({ key: GATEWAY_URL_KEY }),
    SecureCredentials.get({ key: GATEWAY_TOKEN_KEY }),
  ]);
  return { url: url.value ?? "", token: token.value ?? "" };
}

async function removeLegacyCredentials(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    localStorage.removeItem(GATEWAY_URL_KEY);
    localStorage.removeItem(GATEWAY_TOKEN_KEY);
    return;
  }
  await Promise.all([
    SecureCredentials.remove({ key: GATEWAY_URL_KEY }),
    SecureCredentials.remove({ key: GATEWAY_TOKEN_KEY }),
  ]);
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname || "Mac";
  } catch {
    return "Mac";
  }
}

function connectionId(url: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `gateway-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
