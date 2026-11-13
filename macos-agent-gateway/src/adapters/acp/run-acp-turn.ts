import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolveCliLauncher } from "../../cli-launcher.js";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { AdapterEvent, PermissionMode, RunningAgent } from "../../types.js";
import { mapAcpSessionUpdate } from "./map-session-update.js";
import {
  autoSelectPermissionOption,
  pickDecisionOptionId,
  summarizeToolParams,
  type AcpPermissionOption,
  type AcpToolCallSummary,
} from "./permission-policy.js";

export type AcpLaunchCommand = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
};

export type AcpTurnRequest = {
  prompt: string;
  cwd: string;
  permissionMode: PermissionMode;
  /** Load this existing session before prompting; never silently start fresh. */
  nativeId?: string;
  launch: AcpLaunchCommand;
  clientName?: string;
  approvalTimeoutMs?: number;
  startupTimeoutMs?: number;
};

type PendingApproval = {
  options: AcpPermissionOption[];
  resolve: (response: RequestPermissionResponse) => void;
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * Launch an ACP agent subprocess for one prompt turn, bridging
 * `session/request_permission` to gateway approval events the phone can resolve.
 */
export async function launchAcpTurn(
  request: AcpTurnRequest,
  emit: (event: AdapterEvent) => void,
): Promise<RunningAgent> {
  const launcher = await resolveCliLauncher(request.launch.command, { env: { ...process.env, ...request.launch.env } });
  if (!launcher) throw new Error("ACP executable is unavailable");
  const child = spawn(launcher.executable, [...launcher.prefixArgs, ...request.launch.args], {
    cwd: request.cwd,
    env: {
      ...process.env,
      ...request.launch.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let sessionId: string | undefined;
  let prompting = false;
  let initialized = false;
  let startupFailed = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stopChild = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    if (!killTimer) {
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 5_000);
      killTimer.unref();
    }
  };
  child.once("close", () => { if (killTimer) clearTimeout(killTimer); });
  let readyResolve!: () => void;
  let readyReject!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const startupTimer = setTimeout(() => {
    startupFailed = true;
    readyReject(new Error("ACP initialization timed out"));
    stopChild();
  }, request.startupTimeoutMs ?? 12_000);
  startupTimer.unref();
  const pending = new Map<string, PendingApproval>();
  let cancelled = false;
  let terminalEmitted = false;
  const approvalTimeoutMs = request.approvalTimeoutMs ?? 5 * 60_000;

  const emitTracked = (event: AdapterEvent) => {
    if (event.type === "completed" || event.type === "error") terminalEmitted = true;
    emit(event);
  };

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    if (text) emit({ type: "output", payload: { stream: "stderr", text } });
  });

  const input = Writable.toWeb(child.stdin);
  const output = Readable.toWeb(child.stdout);
  const stream = acp.ndJsonStream(input, output);

  const resolvePending = (
    challengeId: string,
    response: RequestPermissionResponse,
  ): boolean => {
    const entry = pending.get(challengeId);
    if (!entry) return false;
    pending.delete(challengeId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(response);
    emit({
      type: "status",
      payload: { status: "running", approvalResolved: challengeId },
    });
    return true;
  };

  const cancelPending = () => {
    for (const [challengeId, entry] of pending) {
      pending.delete(challengeId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve({ outcome: { outcome: "cancelled" } });
      emit({
        type: "approval",
        payload: {
          challengeId,
          resolvable: false,
          expired: true,
          source: "acp",
          reason: "cancelled",
        },
      });
    }
  };

  const done = (async () => {
    try {
      await acp
        .client({ name: request.clientName ?? "remote-agent-gateway" })
        .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
          if (cancelled) {
            return { outcome: { outcome: "cancelled" } };
          }

          const toolCall = ctx.params.toolCall ?? { toolCallId: "unknown" };
          const options: AcpPermissionOption[] = (ctx.params.options ?? []).map((option) => ({
            optionId: option.optionId,
            name: option.name,
            kind: option.kind,
          }));

          const locations = Array.isArray(toolCall.locations)
            ? toolCall.locations
              .map((loc) => {
                if (!loc || typeof loc !== "object") return undefined;
                const path = typeof (loc as { path?: unknown }).path === "string"
                  ? (loc as { path: string }).path
                  : undefined;
                return path ? { path } : undefined;
              })
              .filter((loc): loc is { path: string } => Boolean(loc?.path))
            : undefined;

          const summary: AcpToolCallSummary = {
            ...(typeof toolCall.toolCallId === "string" ? { toolCallId: toolCall.toolCallId } : {}),
            ...(typeof toolCall.title === "string" ? { title: toolCall.title } : {}),
            ...(typeof toolCall.name === "string" ? { name: toolCall.name } : {}),
            ...(typeof toolCall.kind === "string" ? { kind: toolCall.kind } : {}),
            ...(toolCall.rawInput !== undefined ? { rawInput: toolCall.rawInput } : {}),
            ...(locations?.length ? { locations } : {}),
          };
          const paramSummary = summarizeToolParams(summary);

          // Fail-closed: empty options never reach the phone.
          if (!options.length) {
            emit({
              type: "status",
              payload: {
                phase: "permission_rejected",
                reason: "empty_options",
                toolCallId: summary.toolCallId,
                title: summary.title,
                name: summary.name,
                kind: summary.kind,
                ...(paramSummary ? { summary: paramSummary } : {}),
              },
            });
            return { outcome: { outcome: "cancelled" } };
          }

          const autoOptionId = autoSelectPermissionOption(
            request.permissionMode,
            summary,
            options,
          );
          if (autoOptionId) {
            const selected = options.find((option) => option.optionId === autoOptionId);
            // Non-actionable audit/record for auto/full auto-allow.
            emit({
              type: "approval",
              payload: {
                resolvable: false,
                auto: true,
                source: "acp",
                toolCallId: summary.toolCallId,
                title: summary.title,
                name: summary.name,
                kind: summary.kind,
                ...(paramSummary ? { summary: paramSummary } : {}),
                selectedOptionId: autoOptionId,
                selectedOptionKind: selected?.kind ?? "allow_once",
              },
            });
            return {
              outcome: { outcome: "selected", optionId: autoOptionId },
            };
          }

          const challengeId = randomUUID();
          emitTracked({
            type: "approval",
            payload: {
              challengeId,
              resolvable: true,
              source: "acp",
              toolCallId: summary.toolCallId,
              title: summary.title,
              name: summary.name,
              kind: summary.kind,
              ...(paramSummary ? { summary: paramSummary } : {}),
              options,
            },
          });

          return await new Promise<RequestPermissionResponse>((resolve) => {
            const timer = setTimeout(() => {
              if (!pending.has(challengeId)) return;
              pending.delete(challengeId);
              resolve({ outcome: { outcome: "cancelled" } });
              // Mark phone card expired so taps don't hit a misleading 404.
              emit({
                type: "approval",
                payload: {
                  challengeId,
                  resolvable: false,
                  expired: true,
                  source: "acp",
                  reason: "timeout",
                },
              });
              emit({
                type: "output",
                payload: {
                  stream: "stderr",
                  text: `Approval timed out for challenge ${challengeId}`,
                },
              });
            }, approvalTimeoutMs);
            pending.set(challengeId, { options, resolve, timer });
          });
        })
        .onNotification(acp.methods.client.session.update, (ctx) => {
          // session/load can replay history; it is already present in the gateway.
          if (!prompting || ctx.params.sessionId !== sessionId) return;
          for (const event of mapAcpSessionUpdate(ctx.params.update)) emitTracked(event);
        })
        .connectWith(stream, async (ctx) => {
          const initialization = await ctx.request(acp.methods.agent.initialize, {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
            },
            clientInfo: {
              name: request.clientName ?? "remote-agent-gateway",
              version: "0.6.0",
            },
          });

          if (startupFailed) throw new Error("ACP initialization timed out");
          if (request.nativeId) {
            if (!initialization.agentCapabilities?.loadSession) {
              throw new Error("ACP agent does not support loading existing sessions");
            }
            sessionId = request.nativeId;
            await ctx.request(acp.methods.agent.session.load, {
              sessionId, cwd: request.cwd, mcpServers: [],
            });
          } else {
            const session = await ctx.request(acp.methods.agent.session.new, {
              cwd: request.cwd, mcpServers: [],
            });
            sessionId = session.sessionId;
          }
          if (startupFailed) throw new Error("ACP initialization timed out");
          emit({ type: "status", payload: { phase: "initialized", transport: "acp" }, nativeId: sessionId });
          initialized = true;
          clearTimeout(startupTimer);
          readyResolve();
          prompting = true;
          const result = await ctx.request(acp.methods.agent.session.prompt, {
            sessionId, prompt: [{ type: "text", text: request.prompt }],
          });
          if (result.stopReason === "cancelled" || cancelled) {
            emit({ type: "status", payload: { status: "cancelled" } });
          } else if (result.stopReason === "refusal") {
            emitTracked({ type: "error", payload: { message: "Agent refused the prompt", stopReason: result.stopReason } });
          } else {
            emitTracked({ type: "completed", payload: { source: "acp", stopReason: result.stopReason } });
          }
        });
    } catch (error) {
      cancelPending();
      if (!initialized) readyReject(error);
      else if (!cancelled && !terminalEmitted) {
        const message = error instanceof Error ? error.message : String(error);
        emitTracked({ type: "error", payload: { message } });
      }
    } finally {
      clearTimeout(startupTimer);
      cancelPending();
      stopChild();
    }
  })();

  child.once("error", (error) => {
    if (!initialized) readyReject(error);
    else if (!terminalEmitted) emitTracked({ type: "error", payload: { message: error.message } });
  });

  await ready;
  return {
    done: done.then(() => undefined),
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      cancelPending();
      stopChild();
    },
    resolveApproval: (challengeId, decision) => {
      const entry = pending.get(challengeId);
      if (!entry) return false;
      if (decision === "allow" || decision === "deny") {
        const optionId = pickDecisionOptionId(decision, entry.options);
        if (!optionId) {
          // Allow without allow_once (or deny without reject*): refuse the HTTP
          // resolve. Do NOT silently remap allow→deny under 200 — that made the
          // phone show "已批准" while the agent was denied. Phone hides 批准 when
          // options lack allow_once; Deny remains available.
          return false;
        }
        return resolvePending(challengeId, {
          outcome: { outcome: "selected", optionId },
        });
      }
      if (decision && typeof decision === "object" && "optionId" in decision) {
        const optionId = String((decision as { optionId: string }).optionId);
        if (!entry.options.some((option) => option.optionId === optionId)) return false;
        return resolvePending(challengeId, {
          outcome: { outcome: "selected", optionId },
        });
      }
      return false;
    },
  };
}
