import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

type PairingRecord = {
  codeDigest: Buffer;
  expiresAt: number;
};

export class PairingManager {
  #active: PairingRecord | null = null;

  constructor(private readonly ttlMs: number) {}

  begin(now = Date.now()): { code: string; expiresAt: string } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.#active = {
      codeDigest: digest(code),
      expiresAt: now + this.ttlMs,
    };
    return { code, expiresAt: new Date(now + this.ttlMs).toISOString() };
  }

  consume(code: string, now = Date.now()): boolean {
    const record = this.#active;
    this.#active = null;
    if (!record || record.expiresAt < now || !/^\d{6}$/.test(code)) return false;
    const candidate = digest(code);
    return timingSafeEqual(record.codeDigest, candidate);
  }
}

export function createDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function resolveAllowedWorkingDirectory(input: string, roots: string[]): string {
  if (!input || !isAbsolute(input)) {
    throw new Error("cwd must be an absolute path");
  }

  let candidate: string;
  try {
    candidate = realpathSync.native(resolve(input));
  } catch {
    throw new Error("cwd does not exist or cannot be resolved");
  }

  const allowed = roots.some((root) => {
    let realRoot: string;
    try {
      realRoot = realpathSync.native(resolve(root));
    } catch {
      return false;
    }
    const pathFromRoot = relative(realRoot, candidate);
    return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
  });

  if (!allowed) throw new Error("cwd is outside REMOTE_AGENT_ROOTS");
  return candidate;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
