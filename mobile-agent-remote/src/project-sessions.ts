export type ProjectSessionIdentity = {
  projectId: string;
  project: string;
  cwd: string;
};

export type ProjectDisplay = {
  project: string;
  projectHint?: string;
};

export type ProjectSessionGroup<T extends ProjectSessionIdentity & ProjectDisplay> = {
  id: string;
  name: string;
  hint?: string;
  defaultCwd: string;
  sessions: T[];
};

export function projectDisplayGroupKey(projectName: string): string {
  return projectName.trim().toLocaleLowerCase();
}

export function projectGroupId(projectName: string): string {
  return `group:${projectDisplayGroupKey(projectName)}`;
}

export function groupSessionsByProjectDisplay<T extends ProjectSessionIdentity & ProjectDisplay>(
  sessions: T[],
): ProjectSessionGroup<T>[] {
  const grouped = new Map<string, ProjectSessionGroup<T>>();
  for (const session of sessions) {
    const key = projectDisplayGroupKey(session.project);
    const existing = grouped.get(key);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }
    grouped.set(key, {
      id: projectGroupId(session.project),
      name: session.project,
      sessions: [session],
      defaultCwd: session.cwd.trim(),
    });
  }

  for (const group of grouped.values()) {
    const cwds = [...new Set(
      group.sessions.map((session) => session.cwd.trim()).filter(Boolean),
    )];
    group.defaultCwd = group.sessions.find((session) => session.cwd.trim())?.cwd.trim() ?? group.defaultCwd;
    if (cwds.length === 1) {
      group.defaultCwd = cwds[0] ?? group.defaultCwd;
      const hints = [...new Set(
        group.sessions.map((session) => session.projectHint?.trim()).filter(Boolean),
      )];
      group.hint = hints.length === 1 ? hints[0] : undefined;
    } else {
      group.hint = undefined;
    }
  }

  return [...grouped.values()];
}

export function disambiguateProjectNames<T extends ProjectSessionIdentity>(
  sessions: T[],
): Array<T & ProjectDisplay> {
  const projectsByName = new Map<string, Map<string, { name: string; cwd: string }>>();
  for (const session of sessions) {
    const normalizedName = session.project.trim().toLocaleLowerCase();
    const projects = projectsByName.get(normalizedName) ?? new Map();
    const existing = projects.get(session.projectId);
    if (!existing || (!existing.cwd && session.cwd)) {
      projects.set(session.projectId, { name: session.project, cwd: session.cwd });
    }
    projectsByName.set(normalizedName, projects);
  }

  const labels = new Map<string, string>();
  for (const projects of projectsByName.values()) {
    const records = [...projects.entries()].map(([id, project]) => ({ id, ...project }));
    if (records.length < 2) continue;
    const contexts = records.map((record) => projectPathContext(record.cwd, record.name));
    const minimumDepth = Math.max(1, ...records.map((record) => projectPathMinimumDepth(
      record.cwd,
      record.name,
    )));
    const maximumDepth = Math.max(1, ...contexts.map((context) => context.length));
    let candidates: string[] = [];
    for (let depth = minimumDepth; depth <= Math.max(minimumDepth, maximumDepth); depth += 1) {
      candidates = records.map((record, index) => projectPathLabel(
        record.name,
        contexts[index] ?? [],
        depth,
      ));
      if (new Set(candidates.map((candidate) => candidate.toLocaleLowerCase())).size === records.length) break;
    }
    if (new Set(candidates.map((candidate) => candidate.toLocaleLowerCase())).size !== records.length) {
      candidates = records.map((record, index) => (
        `${candidates[index] || record.name} · ${record.id.slice(0, 6)}`
      ));
    }
    records.forEach((record, index) => labels.set(record.id, candidates[index] ?? record.name));
  }

  if (!labels.size) return sessions.map((session) => ({ ...session }));
  return sessions.map((session) => ({
    ...session,
    ...applyProjectDisambiguation(session.project, labels.get(session.projectId)),
  }));
}

export function applyProjectDisambiguation(
  canonicalName: string,
  disambiguationLabel?: string,
): ProjectDisplay {
  if (!disambiguationLabel || disambiguationLabel === canonicalName) {
    return { project: canonicalName };
  }
  if (isWorkspaceProjectName(canonicalName)) {
    return { project: disambiguationLabel };
  }
  const suffix = ` · ${canonicalName}`;
  if (disambiguationLabel.endsWith(suffix)) {
    const hint = disambiguationLabel.slice(0, -suffix.length).trim();
    return hint
      ? { project: canonicalName, projectHint: hint }
      : { project: canonicalName };
  }
  return {
    project: canonicalName,
    projectHint: disambiguationLabel,
  };
}

function isWorkspaceProjectName(projectName: string): boolean {
  return projectName.trim().toLocaleLowerCase() === "workspace";
}

function projectPathMinimumDepth(cwd: string, projectName: string): number {
  if (!isWorkspaceProjectName(projectName)) return 1;
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return /\/[^/]+-benchmark\/runs\/[^/]+\/[^/]+\/workspace$/i.test(normalized) ? 3 : 1;
}

function projectPathContext(cwd: string, projectName: string): string[] {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  const normalizedName = projectName.trim().toLocaleLowerCase();
  let projectIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.toLocaleLowerCase() === normalizedName) {
      projectIndex = index;
      break;
    }
  }
  if (projectIndex < 0) projectIndex = Math.max(0, parts.length - 1);
  return parts.slice(0, projectIndex).reverse().flatMap((part) => {
    const normalized = part.toLocaleLowerCase();
    if (normalized === "runs" || normalized === "tasks") return [];
    const cleaned = part
      .replace(/^\d{4}-\d{2}-\d{2}-/, "")
      .replace(/-benchmark$/i, "");
    return cleaned ? [cleaned] : [];
  });
}

function projectPathLabel(projectName: string, context: string[], depth: number): string {
  const isWorkspace = isWorkspaceProjectName(projectName);
  const parents = isWorkspace ? context.slice(0, depth) : context.slice(0, depth).reverse();
  if (!isWorkspace) parents.push(projectName);
  return parents.join(" · ") || projectName;
}
