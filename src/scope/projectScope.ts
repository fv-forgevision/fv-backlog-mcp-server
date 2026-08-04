/**
 * Project scoping confines every tool to an explicit allow-list of Backlog
 * projects, so an agent cannot read or write across project boundaries.
 *
 * This is a guard against accidental cross-project work, not a security
 * boundary: the underlying credential still carries whatever permissions the
 * Backlog account has, space-wide. Anyone able to call the Backlog API directly
 * is unaffected by anything in this directory. For a real boundary, issue the
 * API key (or authorize OAuth) from an account that only belongs to the
 * intended projects, and treat this layer as defense in depth on top.
 */

/**
 * Thrown when a tool call would reach outside the allow-list. Surfaces to the
 * client as a tool error, so the wording is aimed at an LLM: say what was
 * refused, which project it belonged to, and what is actually allowed.
 */
export class ProjectScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectScopeError';
  }
}

export type ProjectScope = {
  /** Allowed project keys, upper-cased and de-duplicated. Never empty. */
  readonly keys: readonly string[];
};

/** Backlog project keys are upper-case, so accept any casing in config. */
export function normalizeProjectKey(key: string): string {
  return key.trim().toUpperCase();
}

/**
 * Parses `BACKLOG_ALLOWED_PROJECTS` / `--allowed-projects`. Accepts a comma- or
 * whitespace-separated list; `env-var`'s `asArray` already splits on commas, so
 * both a raw string and a pre-split array are handled.
 */
export function parseAllowedProjects(
  raw: string | readonly string[] | undefined | null
): string[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  const keys = parts
    .flatMap((part) => String(part).split(/[\s,]+/))
    .map(normalizeProjectKey)
    .filter(Boolean);
  return [...new Set(keys)];
}

/** Returns undefined when no allow-list is configured (unrestricted server). */
export function createProjectScope(
  raw: string | readonly string[] | undefined | null
): ProjectScope | undefined {
  const keys = parseAllowedProjects(raw);
  return keys.length > 0 ? { keys } : undefined;
}

export function formatAllowedProjects(scope: ProjectScope): string {
  return scope.keys.join(', ');
}
