import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import type {
  AdapterEvent,
  AdapterLaunchRequest,
  AgentAdapter,
  AgentAvailability,
  AgentKind,
  PermissionMode,
  RunningAgent,
} from "../types.js";
import { parseCliLine } from "./protocol.js";

type ProcessAdapterOptions = {
  kind: AgentKind;
  label: string;
  command: string;
  supportsNativeHistory: boolean;
  permissionModes: PermissionMode[];
  buildArgs: (request: AdapterLaunchRequest) => string[];
};

export class ProcessAgentAdapter implements AgentAdapter {
  readonly kind: AgentKind;
  readonly label: string;
  readonly command: string;
  readonly supportsNativeHistory: boolean;
  readonly #permissionModes: PermissionMode[];
  readonly #buildArgs: ProcessAdapterOptions["buildArgs"];

  constructor(options: ProcessAdapterOptions) {
    this.kind = options.kind;
    this.label = options.label;
    this.command = options.command;
    this.supportsNativeHistory = options.supportsNativeHistory;
    this.#permissionModes = options.permissionModes;
    this.#buildArgs = options.buildArgs;
  }

  async detect(): Promise<AgentAvailability> {
    const executable = await findExecutable(this.command);
    const version = executable ? await readVersion(executable) : undefined;
    return {
      kind: this.kind,
      label: this.label,
      command: this.command,
      installed: Boolean(executable),
      ...(version ? { version } : {}),
      supportsNativeHistory: this.supportsNativeHistory,
      permissionModes: [...this.#permissionModes],
    };
  }

  async launch(
    request: AdapterLaunchRequest,
    emit: (event: AdapterEvent) => void,
  ): Promise<RunningAgent> {
    const executable = await findExecutable(this.command);
    if (!executable) throw new Error(`${this.command} is not installed or not on PATH`);

    const child = spawn(executable, this.#buildArgs(request), {
      cwd: request.cwd,
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let cancelled = false;
    let terminalEventSeen = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const flushLines = (
      chunk: Buffer,
      buffer: string,
      onLine: (line: string) => void,
    ): string => {
      const combined = `${buffer}${chunk.toString("utf8")}`;
      const lines = combined.split(/\r?\n/);
      const remainder = lines.pop() ?? "";
      for (const line of lines) onLine(line);
      if (remainder.length > 1_048_576) {
        onLine(remainder.slice(0, 1_048_576));
        return "";
      }
      return remainder;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer = flushLines(chunk, stdoutBuffer, (line) => {
        for (const event of parseCliLine(this.kind, line)) emitTracked(event);
      });
    });

    const emitTracked = (event: AdapterEvent) => {
      if (event.type === "completed" || event.type === "error") terminalEventSeen = true;
      emit(event);
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer = flushLines(chunk, stderrBuffer, (line) => {
        if (line.trim()) emit({ type: "output", payload: { stream: "stderr", text: line } });
      });
    });

    const done = new Promise<void>((resolve) => {
      child.once("error", (error) => {
        emitTracked({ type: "error", payload: { message: error.message } });
        resolve();
      });
      child.once("close", (code, signal) => {
        if (stdoutBuffer.trim()) {
          for (const event of parseCliLine(this.kind, stdoutBuffer)) emitTracked(event);
        }
        if (stderrBuffer.trim()) {
          emit({ type: "output", payload: { stream: "stderr", text: stderrBuffer } });
        }
        if (cancelled) {
          emit({ type: "status", payload: { status: "cancelled" } });
        } else if (code === 0 && !terminalEventSeen) {
          emitTracked({ type: "completed", payload: { exitCode: code } });
        } else if (!terminalEventSeen) {
          emitTracked({
            type: "error",
            payload: {
              message: `${this.command} exited unsuccessfully`,
              exitCode: code,
              signal,
            },
          });
        }
        resolve();
      });
    });

    return {
      done,
      cancel: () => {
        if (child.exitCode !== null || cancelled) return;
        cancelled = true;
        child.kill("SIGTERM");
        const timer = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 5_000);
        timer.unref();
      },
    };
  }
}

async function findExecutable(command: string): Promise<string | undefined> {
  if (command.includes("/")) {
    try {
      await access(command, constants.X_OK);
      return command;
    } catch {
      return undefined;
    }
  }

  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}

async function readVersion(executable: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(executable, ["--version"], {
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 2_000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.length < 4_096) output += chunk.toString("utf8");
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.once("close", () => {
      clearTimeout(timer);
      const firstLine = output.trim().split(/\r?\n/)[0];
      resolve(firstLine || undefined);
    });
  });
}
