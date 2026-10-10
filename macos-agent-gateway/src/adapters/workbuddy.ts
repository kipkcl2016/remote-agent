import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AdapterEvent,
  AdapterLaunchRequest,
  AgentAdapter,
  AgentAvailability,
  RunningAgent,
} from "../types.js";

export function createWorkbuddyAdapter(): AgentAdapter {
  return {
    kind: "workbuddy",
    label: "WorkBuddy",
    command: "WorkBuddy",
    supportsNativeHistory: true,
    async detect(): Promise<AgentAvailability> {
      const db = join(homedir(), ".workbuddy", "workbuddy.db");
      const app = "/Applications/WorkBuddy.app";
      const installed = existsSync(db) || existsSync(app);
      return {
        kind: "workbuddy",
        label: "WorkBuddy",
        command: "WorkBuddy",
        installed,
        supportsNativeHistory: true,
        permissionModes: ["ask"],
      };
    },
    async launch(
      _request: AdapterLaunchRequest,
      _emit: (event: AdapterEvent) => void,
    ): Promise<RunningAgent> {
      throw new Error("WorkBuddy 暂不支持从 Remote Agent 新建或续接，仅可浏览历史");
    },
  };
}
