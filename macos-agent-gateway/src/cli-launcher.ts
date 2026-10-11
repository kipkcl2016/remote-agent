import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";

export type CliLauncher = { executable: string; prefixArgs: string[] };

/** Resolve local CLI installations without invoking cmd.exe or a shell. */
export async function resolveCliLauncher(
  command: string,
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): Promise<CliLauncher | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const explicit = isAbsolute(command) || /[\\/]/.test(command);
  const directories = explicit ? [""] : (env.PATH ?? "").split(platform === "win32" ? ";" : delimiter).filter(Boolean);
  for (const directory of directories) {
    const base = explicit ? command : join(directory.replace(/^"|"$/g, ""), command);
    const candidates = platform === "win32"
      ? /\.(?:exe|com|cmd|bat)$/i.test(base) ? [base] : [`${base}.exe`, `${base}.com`, `${base}.cmd`]
      : [base];
    for (const candidate of candidates) {
      try {
        if (!(await stat(candidate)).isFile()) continue;
        if (platform === "win32" && /\.(?:cmd|bat)$/i.test(candidate)) {
          const launcher = await resolveNodeShim(candidate);
          if (launcher) return launcher;
          continue;
        }
        await access(candidate, constants.X_OK);
        return { executable: candidate, prefixArgs: [] };
      } catch {
        // Missing, unreadable, or unsupported candidates are not available CLIs.
      }
    }
  }
  return undefined;
}

async function resolveNodeShim(path: string): Promise<CliLauncher | undefined> {
  if ((await stat(path)).size > 16_384) return undefined;
  const content = await readFile(path, "utf8");
  // npm cmd-shim's literal Node entry point. Never execute or expand the batch file.
  const match = content.match(/(?:"%_prog%"|"node"|node)\s+"%dp0%[\\/]([^"\r\n%]+\.[cm]?js)"\s+%\*/i);
  if (!match?.[1]) return undefined;
  const root = resolve(dirname(path));
  const script = resolve(root, ...match[1].split(/[\\/]/));
  if (!script.startsWith(`${root}${sep}`) || !(await stat(script)).isFile()) return undefined;
  const localNode = join(root, "node.exe");
  let executable = process.execPath;
  try {
    if ((await stat(localNode)).isFile()) executable = localNode;
  } catch {
    // npm also uses the Node installation on PATH when no colocated node.exe exists.
  }
  return { executable, prefixArgs: [script] };
}
