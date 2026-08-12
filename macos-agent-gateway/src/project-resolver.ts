import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveAllowedWorkingDirectory } from "./security.js";

export type ProjectIdentity = {
  projectId: string;
  projectName: string;
};

export class ProjectResolver {
  readonly #cache = new Map<string, ProjectIdentity>();
  readonly #realRoots: string[];

  constructor(readonly allowedRoots: string[]) {
    this.#realRoots = allowedRoots.flatMap((root) => {
      try {
        return [realpathSync.native(resolve(root))];
      } catch {
        return [];
      }
    });
  }

  resolve(cwd: string): ProjectIdentity {
    const canonicalCwd = resolveAllowedWorkingDirectory(cwd, this.allowedRoots);
    const cached = this.#cache.get(canonicalCwd);
    if (cached) return cached;

    let projectRoot = canonicalCwd;
    let current = canonicalCwd;
    while (this.#isInsideAllowedRoot(current)) {
      if (existsSync(join(current, ".git"))) {
        projectRoot = current;
        break;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    const identity = projectIdentityFromRoot(projectRoot);
    if (this.#cache.size >= 1_000) this.#cache.clear();
    this.#cache.set(canonicalCwd, identity);
    return identity;
  }

  resolveStored(cwd: string): ProjectIdentity {
    try {
      return this.resolve(cwd);
    } catch {
      return projectIdentityFromRoot(resolve(cwd));
    }
  }

  #isInsideAllowedRoot(path: string): boolean {
    return this.#realRoots.some((root) => {
      const fromRoot = relative(root, path);
      return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
    });
  }
}

function projectIdentityFromRoot(projectRoot: string): ProjectIdentity {
  return {
    projectId: createHash("sha256").update(projectRoot).digest("hex"),
    projectName: basename(projectRoot) || projectRoot,
  };
}
