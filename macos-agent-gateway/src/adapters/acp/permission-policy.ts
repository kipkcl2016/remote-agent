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
  rawInput?: unknown;
  locations?: Array<{ path?: string }>;
};

/**
 * Known low-risk tool names. Prefer this whitelist over trusting the
 * agent-reported `kind` string (which prompt injection can spoof).
 */
const LOW_RISK_TOOL_NAMES = new Set([
  "read",
  "read_file",
  "readfile",
  "read_text_file",
  "search",
  "grep",
  "glob",
  "glob_file_search",
  "list_dir",
  "listdir",
  "ls",
  "find",
  "think",
  "thinking",
  "web_search",
  "websearch",
]);

export function findAllowOnceOption(
  options: AcpPermissionOption[],
): AcpPermissionOption | undefined {
  return options.find((option) => option.kind === "allow_once");
}

export function findRejectOption(
  options: AcpPermissionOption[],
): AcpPermissionOption | undefined {
  return (
    options.find((option) => option.kind === "reject_once")
    ?? options.find((option) => option.kind === "reject_always")
    ?? options.find((option) => option.kind.startsWith("reject"))
  );
}

/**
 * Decide whether the gateway should auto-answer an ACP permission request
 * without waiting for the phone. Returns an optionId when auto-answered.
 *
 * Hard rules:
 * - Never select `allow_always` (phone "批准" / auto must be single-shot).
 * - Never blind-pick `options[0]`; only explicitly understood `allow_once`.
 * - Empty options → undefined (caller fail-closes locally).
 */
export function autoSelectPermissionOption(
  permissionMode: PermissionMode,
  tool: AcpToolCallSummary,
  options: AcpPermissionOption[],
): string | undefined {
  if (!options.length) return undefined;

  const allowOnce = findAllowOnceOption(options);
  if (!allowOnce) return undefined;

  if (permissionMode === "full") {
    // Only auto-select when we understand the option kind; else phone.
    return allowOnce.optionId;
  }

  if (permissionMode === "auto" && isLowRiskTool(tool)) {
    return allowOnce.optionId;
  }

  // ask / plan: phone must decide.
  return undefined;
}

/**
 * Map a phone decision to an ACP optionId.
 *
 * Phone "批准" maps ONLY to `allow_once`. Never fall back to `allow_always`
 * or a blind `options[0]` — if no once-option exists, return undefined
 * (caller treats as error/deny).
 */
export function pickDecisionOptionId(
  decision: "allow" | "deny",
  options: AcpPermissionOption[],
): string | undefined {
  if (decision === "allow") {
    return findAllowOnceOption(options)?.optionId;
  }
  return findRejectOption(options)?.optionId;
}

/**
 * Truncated tool param / command / path summary for the phone approval card.
 */
export function summarizeToolParams(
  tool: AcpToolCallSummary,
  maxLen = 240,
): string | undefined {
  const parts: string[] = [];

  const input = tool.rawInput;
  if (typeof input === "string" && input.trim()) {
    parts.push(input.trim());
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    const preferredKeys = [
      "command",
      "cmd",
      "path",
      "file_path",
      "filePath",
      "filepath",
      "filename",
      "query",
      "pattern",
      "url",
      "uri",
      "content",
    ];
    for (const key of preferredKeys) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) {
        parts.push(`${key}: ${value.trim()}`);
      }
    }
    if (!parts.length) {
      try {
        const json = JSON.stringify(input);
        if (json && json !== "{}" && json !== "null") parts.push(json);
      } catch {
        // ignore
      }
    }
  }

  if (Array.isArray(tool.locations)) {
    for (const loc of tool.locations) {
      if (typeof loc?.path === "string" && loc.path.trim()) {
        parts.push(`path: ${loc.path.trim()}`);
      }
    }
  }

  if (!parts.length) return undefined;
  const text = parts.join(" · ");
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

/**
 * Low-risk auto-allow: prefer tool-name whitelist. Do not trust agent-reported
 * `kind` alone (prompt injection can label a write as "read").
 */
function isLowRiskTool(tool: AcpToolCallSummary): boolean {
  const name = tool.name?.trim().toLowerCase();
  if (name && LOW_RISK_TOOL_NAMES.has(name)) return true;
  return false;
}
