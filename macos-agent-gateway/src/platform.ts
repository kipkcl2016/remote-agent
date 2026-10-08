import { homedir, platform } from "node:os";
import { join } from "node:path";

export function isWindows(): boolean {
  return platform() === "win32";
}

export function isMacOS(): boolean {
  return platform() === "darwin";
}

export function getDefaultHistoryDirs() {
  const home = homedir();
  
  if (isWindows()) {
    // Windows paths for Cursor, Claude, Codex
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    
    return {
      cursor: join(appData, "Cursor", "acp-sessions"),
      cursorChats: join(appData, "Cursor", "chats"),
      cursorComposerDb: join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      cursorTranscripts: join(appData, "Cursor", "projects"),
      claude: join(home, ".claude", "projects"),
      codex: join(home, ".codex", "sessions"),
    };
  }
  
  // macOS/Linux paths
  return {
    cursor: join(home, ".cursor", "acp-sessions"),
    cursorChats: join(home, ".cursor", "chats"),
    cursorComposerDb: join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
    cursorTranscripts: join(home, ".cursor", "projects"),
    claude: join(home, ".claude", "projects"),
    codex: join(home, ".codex", "sessions"),
  };
}
