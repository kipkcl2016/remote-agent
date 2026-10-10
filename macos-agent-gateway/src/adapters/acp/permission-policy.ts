import type { PermissionMode } from "../../types.js";

export type AcpPermissionOption = {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
};

export type AcpToolCallSummary = {
  toolCallId?: string;
  title?: string;
  name?: string;
  kind?: string;
};

/**
 * Decide whether the gateway should auto-answer an ACP permission request
 * without waiting for the phone. Returns an optionId when auto-answered.
 *
 * Hard rule: never invent allow_always; only single-shot allow/reject.
 */
export function autoSelectPermissionOption(
  permissionMode: PermissionMode,
  tool: AcpToolCallSummary,
  options: AcpPermissionOption[],
): string | undefined {
  if (!options.length) return undefined;

  const allowOnce = options.find((option) => option.kind === "allow_once")
    ?? options.find((option) => option.kind === "allow_always");
  const rejectOnce = options.find((option) => option.kind === "reject_once")
    ?? options.find((option) => option.kind === "reject_always");

  if (permissionMode === "full") {
    return allowOnce?.optionId ?? options[0]?.optionId;
  }

  if (permissionMode === "auto" && isLowRiskToolKind(tool.kind)) {
    return allowOnce?.optionId;
  }

  if (permissionMode === "plan" || permissionMode === "ask") {
    // Phone must decide; do not auto-allow. Auto-reject only when no UI path
    // exists would break the closed loop — leave unresolved for the phone.
    return undefined;
  }

  return undefined;
}

export function pickDecisionOptionId(
  decision: "allow" | "deny",
  options: AcpPermissionOption[],
): string | undefined {
  if (decision === "allow") {
    return options.find((option) => option.kind === "allow_once")?.optionId
      ?? options.find((option) => option.kind === "allow_always")?.optionId
      ?? options[0]?.optionId;
  }
  return options.find((option) => option.kind === "reject_once")?.optionId
    ?? options.find((option) => option.kind === "reject_always")?.optionId
    ?? options.find((option) => option.kind.startsWith("reject"))?.optionId
    ?? options.at(-1)?.optionId;
}

function isLowRiskToolKind(kind: string | undefined): boolean {
  if (!kind) return false;
  return kind === "read" || kind === "search" || kind === "think";
}
