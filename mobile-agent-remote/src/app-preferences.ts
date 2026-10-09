import { Capacitor, registerPlugin } from "@capacitor/core";

type SecureCredentialsPlugin = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

export type AppPreferences = {
  version: 1;
  defaultRestrictedExecution: boolean;
  agentStatusNotifications: boolean;
};

const SecureCredentials = registerPlugin<SecureCredentialsPlugin>("SecureCredentials");

export const APP_PREFERENCES_KEY = "remote-agent.app.preferences.v1";

const defaultPreferences = (): AppPreferences => ({
  version: 1,
  defaultRestrictedExecution: true,
  agentStatusNotifications: true,
});

export async function loadAppPreferences(): Promise<AppPreferences> {
  const raw = Capacitor.isNativePlatform()
    ? (await SecureCredentials.get({ key: APP_PREFERENCES_KEY })).value
    : localStorage.getItem(APP_PREFERENCES_KEY);
  return parseAppPreferences(raw);
}

export async function saveAppPreferences(preferences: AppPreferences): Promise<void> {
  const value = JSON.stringify(preferences);
  if (!Capacitor.isNativePlatform()) {
    localStorage.setItem(APP_PREFERENCES_KEY, value);
    return;
  }
  await SecureCredentials.set({ key: APP_PREFERENCES_KEY, value });
}

function parseAppPreferences(raw: string | null): AppPreferences {
  if (!raw) return defaultPreferences();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultPreferences();
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) return defaultPreferences();
    return {
      version: 1,
      defaultRestrictedExecution: record.defaultRestrictedExecution !== false,
      agentStatusNotifications: record.agentStatusNotifications !== false,
    };
  } catch {
    return defaultPreferences();
  }
}
