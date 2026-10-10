export const agentKinds = ["cursor", "claude", "codex", "workbuddy"] as const;
export type AgentKind = (typeof agentKinds)[number];

export const permissionModes = ["plan", "ask", "auto", "full"] as const;
export type PermissionMode = (typeof permissionModes)[number];

export const sessionStatuses = [
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const eventTypes = [
  "status",
  "output",
  "tool",
  "approval",
  "completed",
  "error",
] as const;
export type EventType = (typeof eventTypes)[number];

export type GatewaySession = {
  id: string;
  nativeId?: string;
  agent: AgentKind;
  title: string;
  cwd: string;
  projectId?: string;
  projectName?: string;
  permissionMode: PermissionMode;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type SessionEvent = {
  seq: number;
  sessionId: string;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type PairedDevice = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

export type AdapterEvent = {
  type: EventType;
  payload: Record<string, unknown>;
  nativeId?: string;
};

export type StartSessionInput = {
  agent: AgentKind;
  prompt: string;
  cwd: string;
  permissionMode: PermissionMode;
};

export type ContinueSessionInput = {
  prompt: string;
};

export type NativeHistorySession = {
  id: string;
  agent: AgentKind;
  title: string;
  cwd: string;
  projectId?: string;
  projectName?: string;
  createdAt?: string;
  updatedAt: string;
  status?: "running" | "completed" | "failed";
  resumable: boolean;
  archived?: boolean;
  source: "native";
};

export type NativeHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
};

export type AgentAvailability = {
  kind: AgentKind;
  label: string;
  command: string;
  installed: boolean;
  version?: string;
  supportsNativeHistory: boolean;
  permissionModes: PermissionMode[];
};

export type AgentUsageWindow = {
  label: string;
  remainingPercent: number;
  resetsAt?: string;
};

export type AgentUsage = {
  agent: AgentKind;
  state: "available" | "unavailable";
  windows: AgentUsageWindow[];
  message?: string;
  updatedAt: string;
};

export interface AgentUsageProvider {
  list(): Promise<AgentUsage[]>;
}

export type ApprovalDecision = "allow" | "deny" | { optionId: string };

export type RunningAgent = {
  done: Promise<void>;
  cancel: () => void;
  /** Resolve a pending ACP permission challenge from the phone. */
  resolveApproval?: (challengeId: string, decision: ApprovalDecision) => boolean;
};

export type AdapterLaunchRequest = {
  prompt: string;
  cwd: string;
  permissionMode: PermissionMode;
  nativeId?: string;
};

export interface AgentAdapter {
  readonly kind: AgentKind;
  readonly label: string;
  readonly command: string;
  readonly supportsNativeHistory: boolean;
  detect(): Promise<AgentAvailability>;
  launch(
    request: AdapterLaunchRequest,
    emit: (event: AdapterEvent) => void,
  ): Promise<RunningAgent>;
}

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && agentKinds.includes(value as AgentKind);
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && permissionModes.includes(value as PermissionMode);
}
