import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { ProjectResolver } from "../src/project-resolver.js";

test("[SESSION-007] groups Git subdirectories without merging same-name directories", () => {
  const root = mkdtempSync(join(tmpdir(), "remote-agent-projects-"));
  const outside = mkdtempSync(join(tmpdir(), "remote-agent-projects-outside-"));

  try {
    const repository = join(root, "remote-agent");
    const repositoryChild = join(repository, "packages", "mobile");
    const firstShared = join(root, "one", "shared");
    const secondShared = join(root, "two", "shared");
    mkdirSync(join(repository, ".git"), { recursive: true });
    mkdirSync(repositoryChild, { recursive: true });
    mkdirSync(firstShared, { recursive: true });
    mkdirSync(secondShared, { recursive: true });

    const resolver = new ProjectResolver([root]);
    const repositoryProject = resolver.resolve(repository);
    const childProject = resolver.resolve(repositoryChild);
    const firstProject = resolver.resolve(firstShared);
    const secondProject = resolver.resolve(secondShared);

    assert.deepEqual(childProject, repositoryProject);
    assert.equal(repositoryProject.projectName, "remote-agent");
    assert.equal(firstProject.projectName, "shared");
    assert.equal(secondProject.projectName, "shared");
    assert.notEqual(firstProject.projectId, secondProject.projectId);
    assert.throws(() => resolver.resolve(outside), /outside REMOTE_AGENT_ROOTS/);
    assert.equal(resolver.resolveStored(join(root, "removed-project")).projectName, "removed-project");
    assert.equal(basename(repository), repositoryProject.projectName);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
