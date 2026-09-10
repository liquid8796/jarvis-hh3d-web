const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function identity(value: unknown): string | null {
  if (!record(value)) return null;
  if (typeof value.owner === "string" && typeof value.repo === "string") return `${value.owner}/${value.repo}`.toLowerCase();
  if (typeof value.repo === "string") return value.repo.toLowerCase();
  return typeof value.id === "string" ? value.id : null;
}

/** Apply only the caller's changes, retaining concurrent lifecycle/key observations. */
export function mergeGithubBranch(base: unknown, incoming: unknown, current: unknown): unknown {
  if (equal(base, incoming)) return current;
  if (Array.isArray(base) && Array.isArray(incoming) && Array.isArray(current) && [...base, ...incoming, ...current].every((v) => identity(v) !== null)) {
    const old = new Map(base.map((v) => [identity(v), v]));
    const next = new Map(incoming.map((v) => [identity(v), v]));
    const present = new Set(current.map(identity));
    const merged: unknown[] = [];
    for (const value of current) {
      const key = identity(value);
      if (old.has(key) && !next.has(key)) continue;
      merged.push(next.has(key) ? mergeGithubBranch(old.get(key), next.get(key), value) : value);
    }
    for (const value of incoming) if (!old.has(identity(value)) && !present.has(identity(value))) merged.push(value);
    return merged;
  }
  if (record(base) && record(incoming) && record(current)) {
    const result = { ...current };
    for (const key of new Set([...Object.keys(base), ...Object.keys(incoming)])) {
      if (equal(base[key], incoming[key])) continue;
      if (!(key in incoming)) delete result[key];
      else result[key] = mergeGithubBranch(base[key], incoming[key], current[key]);
    }
    return result;
  }
  return incoming;
}
