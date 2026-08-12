import assert from "node:assert/strict";
import test from "node:test";
import { AgentUsageService, parseCodexRateLimitWindows } from "../src/agent-usage.js";
import type { AgentKind, AgentUsage } from "../src/types.js";

test("Codex rate-limit snapshots map to remaining short and long windows", () => {
  assert.deepEqual(parseCodexRateLimitWindows({
    rateLimits: {
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1_786_424_400 },
      secondary: { usedPercent: 59, windowDurationMins: 10_080, resetsAt: 1_786_942_800 },
    },
  }), [
    { label: "5 小时", remainingPercent: 72, resetsAt: "2026-08-11T05:00:00.000Z" },
    { label: "每周", remainingPercent: 41, resetsAt: "2026-08-17T05:00:00.000Z" },
  ]);

  assert.deepEqual(parseCodexRateLimitWindows({
    rateLimits: { primary: { usedPercent: 99 } },
    rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 15, windowDurationMins: 60 } },
    },
  }), [{ label: "1 小时", remainingPercent: 85 }]);
  assert.deepEqual(parseCodexRateLimitWindows({ rateLimits: null }), []);
});

test("Agent usage probes are cached for 60 seconds and failures stay structured", async () => {
  let nowMs = Date.parse("2026-08-11T00:00:00.000Z");
  const calls: Record<AgentKind, number> = { cursor: 0, claude: 0, codex: 0 };
  const available = (agent: AgentKind, updatedAt: string): AgentUsage => ({
    agent,
    state: "available",
    windows: [{ label: "5 小时", remainingPercent: 80 }],
    updatedAt,
  });
  const service = new AgentUsageService({
    now: () => new Date(nowMs),
    probes: {
      cursor: async (updatedAt) => {
        calls.cursor += 1;
        return available("cursor", updatedAt);
      },
      claude: async () => {
        calls.claude += 1;
        throw new Error("private upstream details must not escape");
      },
      codex: async (updatedAt) => {
        calls.codex += 1;
        return available("codex", updatedAt);
      },
    },
  });

  const first = await service.list();
  const second = await service.list();
  assert.deepEqual(calls, { cursor: 1, claude: 1, codex: 1 });
  assert.equal(first[1]?.state, "unavailable");
  assert.match(first[1]?.message ?? "", /^无法获取额度信息/);
  assert.deepEqual(second, first);

  nowMs += 60_001;
  await service.list();
  assert.deepEqual(calls, { cursor: 2, claude: 2, codex: 2 });
});
