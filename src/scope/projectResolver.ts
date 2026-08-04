import type { Backlog } from 'backlog-js';
import { getCurrentOrganization } from '../utils/backlogOrganizationContext.js';
import {
  formatAllowedProjects,
  normalizeProjectKey,
  ProjectScope,
  ProjectScopeError,
} from './projectScope.js';

/**
 * Entity-to-project mappings never change, so the caches only exist to keep the
 * rate limit down. Issues are unbounded over a long-lived process, so overflow
 * clears rather than evicting — cheap, and a cold cache only costs one lookup.
 */
const MAX_CACHE_ENTRIES = 5000;

type OrgCache = {
  /** Resolution of the whole allow-list; shared so concurrent calls fetch once. */
  allowedIds?: Promise<ReadonlySet<number>>;
  issue: Map<string, number>;
  wiki: Map<number, number>;
  document: Map<string, number>;
};

export interface ProjectResolver {
  readonly keys: readonly string[];
  /** The single allowed key, when exactly one project is configured. */
  readonly soleKey: string | undefined;
  isAllowedKey(key: string): boolean;
  allowedProjectIds(): Promise<ReadonlySet<number>>;
  assertProjectKey(key: string, label: string): void;
  assertProjectId(projectId: number, label: string): Promise<void>;
  assertProjectIdOrKey(value: string | number, label: string): Promise<void>;
  assertIssue(issueIdOrKey: string | number, label: string): Promise<void>;
  assertWiki(wikiId: number, label: string): Promise<void>;
  assertDocument(documentId: string, label: string): Promise<void>;
  isAllowedProjectId(projectId: number): Promise<boolean>;
}

/**
 * A Backlog issue key is `<PROJECT_KEY>-<number>`, and project keys cannot
 * contain a hyphen — so the prefix identifies the project without an API call.
 * Returns undefined for anything that is not shaped like an issue key.
 */
function projectKeyOfIssueKey(issueKey: string): string | undefined {
  const idx = issueKey.lastIndexOf('-');
  if (idx <= 0 || idx === issueKey.length - 1) {
    return undefined;
  }
  const suffix = issueKey.slice(idx + 1);
  if (!/^\d+$/.test(suffix)) {
    return undefined;
  }
  return normalizeProjectKey(issueKey.slice(0, idx));
}

/** True for values that address an entity by numeric id rather than by key. */
function asNumericId(value: string | number): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined;
}

function remember<K>(cache: Map<K, number>, key: K, projectId: number): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.clear();
  }
  cache.set(key, projectId);
}

export function createProjectResolver(
  backlog: Backlog,
  scope: ProjectScope
): ProjectResolver {
  const allowed = formatAllowedProjects(scope);
  const keySet = new Set(scope.keys);
  // Keyed by organization: with multiple Backlog spaces the same key or id can
  // mean different projects, and each space resolves through its own client.
  const caches = new Map<string, OrgCache>();

  function cache(): OrgCache {
    const org = getCurrentOrganization() ?? '';
    let entry = caches.get(org);
    if (!entry) {
      entry = { issue: new Map(), wiki: new Map(), document: new Map() };
      caches.set(org, entry);
    }
    return entry;
  }

  function deny(label: string, belongsTo: string): never {
    throw new ProjectScopeError(
      `${label} belongs to project ${belongsTo}, which is outside this server's allowed projects (${allowed}). ` +
        `This server can only work with: ${allowed}.`
    );
  }

  function allowedProjectIds(): Promise<ReadonlySet<number>> {
    const entry = cache();
    if (!entry.allowedIds) {
      entry.allowedIds = Promise.all(
        scope.keys.map(async (key) => {
          const project = await backlog.getProject(key);
          return project.id;
        })
      )
        .then((ids) => new Set(ids) as ReadonlySet<number>)
        .catch((err: unknown) => {
          // Don't cache the failure: a transient error or a not-yet-granted
          // permission would otherwise poison the process for good.
          entry.allowedIds = undefined;
          throw new ProjectScopeError(
            `Could not resolve the allowed projects (${allowed}) in Backlog. ` +
              `Check that every key in the allow-list exists and that the credential can access it. ` +
              `Cause: ${err instanceof Error ? err.message : String(err)}`
          );
        });
    }
    return entry.allowedIds;
  }

  async function isAllowedProjectId(projectId: number): Promise<boolean> {
    return (await allowedProjectIds()).has(projectId);
  }

  function assertProjectKey(key: string, label: string): void {
    const normalized = normalizeProjectKey(key);
    if (!keySet.has(normalized)) {
      deny(label, normalized);
    }
  }

  async function assertProjectId(
    projectId: number,
    label: string
  ): Promise<void> {
    if (!(await isAllowedProjectId(projectId))) {
      deny(label, `id ${projectId}`);
    }
  }

  async function assertProjectIdOrKey(
    value: string | number,
    label: string
  ): Promise<void> {
    const numeric = asNumericId(value);
    if (numeric !== undefined) {
      await assertProjectId(numeric, label);
      return;
    }
    assertProjectKey(String(value), label);
  }

  /** Resolves an entity to its project id, caching the mapping. */
  async function projectIdOf<K>(
    store: Map<K, number>,
    key: K,
    fetch: () => Promise<{ projectId: number }>
  ): Promise<number> {
    const cached = store.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const { projectId } = await fetch();
    remember(store, key, projectId);
    return projectId;
  }

  async function assertIssue(
    issueIdOrKey: string | number,
    label: string
  ): Promise<void> {
    if (typeof issueIdOrKey === 'string') {
      const projectKey = projectKeyOfIssueKey(issueIdOrKey);
      if (projectKey) {
        // Issue keys carry their project, so this costs no API call at all.
        if (!keySet.has(projectKey)) {
          deny(`${label} (${issueIdOrKey})`, projectKey);
        }
        return;
      }
    }
    const entry = cache();
    const cacheKey = String(issueIdOrKey);
    const projectId = await projectIdOf(entry.issue, cacheKey, () =>
      backlog.getIssue(issueIdOrKey)
    );
    if (!(await isAllowedProjectId(projectId))) {
      deny(`${label} (${issueIdOrKey})`, `id ${projectId}`);
    }
  }

  async function assertWiki(wikiId: number, label: string): Promise<void> {
    const entry = cache();
    const projectId = await projectIdOf(entry.wiki, wikiId, () =>
      backlog.getWiki(wikiId)
    );
    if (!(await isAllowedProjectId(projectId))) {
      deny(`${label} (${wikiId})`, `id ${projectId}`);
    }
  }

  async function assertDocument(
    documentId: string,
    label: string
  ): Promise<void> {
    const entry = cache();
    const projectId = await projectIdOf(entry.document, documentId, () =>
      backlog.getDocument(documentId)
    );
    if (!(await isAllowedProjectId(projectId))) {
      deny(`${label} (${documentId})`, `id ${projectId}`);
    }
  }

  return {
    keys: scope.keys,
    soleKey: scope.keys.length === 1 ? scope.keys[0] : undefined,
    isAllowedKey: (key) => keySet.has(normalizeProjectKey(key)),
    allowedProjectIds,
    isAllowedProjectId,
    assertProjectKey,
    assertProjectId,
    assertProjectIdOrKey,
    assertIssue,
    assertWiki,
    assertDocument,
  };
}
