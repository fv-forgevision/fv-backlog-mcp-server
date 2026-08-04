import type { ProjectResolver } from './projectResolver.js';
import { ProjectScopeError } from './projectScope.js';
import { scopeRuleFor, type ScopeRule } from './toolScopePolicy.js';

type Input = Record<string, unknown>;

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Applies a rule to a tool's input, returning the input the tool should
 * actually run with. Throws {@link ProjectScopeError} when the call reaches
 * outside the allow-list.
 */
async function enforce(
  rule: ScopeRule,
  toolName: string,
  input: Input,
  resolver: ProjectResolver
): Promise<Input> {
  const allowed = resolver.keys.join(', ');

  switch (rule.kind) {
    case 'unscoped':
    case 'projectList':
    case 'blocked':
      // `blocked` tools are never registered, so this is unreachable in
      // practice; treating it as a pass-through keeps the switch total.
      return input;

    case 'projectPair': {
      const projectId = asNumber(input.projectId);
      const projectKey = input.projectKey;

      if (projectId !== undefined) {
        await resolver.assertProjectId(projectId, `${toolName}: projectId`);
      }
      if (isPresent(projectKey)) {
        resolver.assertProjectKey(
          String(projectKey),
          `${toolName}: projectKey`
        );
      }
      if (projectId === undefined && !isPresent(projectKey)) {
        // No project named. With a single allowed project we can fill it in;
        // otherwise the caller has to choose, or the tool would run space-wide.
        if (resolver.soleKey) {
          return { ...input, projectKey: resolver.soleKey };
        }
        throw new ProjectScopeError(
          `${toolName} requires a project. This server is restricted to: ${allowed}. ` +
            `Pass one of them as projectKey.`
        );
      }
      return input;
    }

    case 'projectId': {
      const value = asNumber(input[rule.field]);
      if (value === undefined) {
        throw new ProjectScopeError(
          `${toolName} requires ${rule.field}. This server is restricted to: ${allowed}. ` +
            `Look the id up with get_project.`
        );
      }
      await resolver.assertProjectId(value, `${toolName}: ${rule.field}`);
      return input;
    }

    case 'projectIdList': {
      const raw = input[rule.field];
      const values = Array.isArray(raw)
        ? raw.map(asNumber).filter((v): v is number => v !== undefined)
        : [];

      if (values.length === 0) {
        // An absent project filter means "every project in the space", so the
        // allow-list is injected rather than left to the caller.
        const ids = await resolver.allowedProjectIds();
        return { ...input, [rule.field]: [...ids] };
      }

      for (const value of values) {
        await resolver.assertProjectId(value, `${toolName}: ${rule.field}`);
      }
      return input;
    }

    case 'projectIdOrKey': {
      const raw = input[rule.field];
      if (!isPresent(raw)) {
        if (resolver.soleKey) {
          return { ...input, [rule.field]: resolver.soleKey };
        }
        throw new ProjectScopeError(
          `${toolName} requires ${rule.field}. This server is restricted to: ${allowed}.`
        );
      }
      await resolver.assertProjectIdOrKey(
        raw as string | number,
        `${toolName}: ${rule.field}`
      );
      return input;
    }

    case 'issue': {
      if (rule.pair) {
        const issueKey = input.issueKey;
        const issueId = asNumber(input.issueId);
        // Mirrors resolveIdOrKey: a positive id wins, key is the fallback.
        if (issueId !== undefined && issueId > 0) {
          await resolver.assertIssue(issueId, `${toolName}: issue`);
        } else if (isPresent(issueKey)) {
          await resolver.assertIssue(String(issueKey), `${toolName}: issue`);
        }
        // Neither present: let the tool raise its own "id or key required".
      }

      for (const field of rule.idOrKeyFields ?? []) {
        const raw = input[field];
        if (isPresent(raw)) {
          await resolver.assertIssue(
            (asNumber(raw) ?? String(raw)) as string | number,
            `${toolName}: ${field}`
          );
        }
      }

      for (const field of rule.extraIssueIdFields ?? []) {
        const value = asNumber(input[field]);
        if (value !== undefined && value > 0) {
          await resolver.assertIssue(value, `${toolName}: ${field}`);
        }
      }
      return input;
    }

    case 'wiki': {
      const value = asNumber(input[rule.field]);
      if (value !== undefined) {
        await resolver.assertWiki(value, `${toolName}: ${rule.field}`);
      }
      return input;
    }

    case 'document': {
      const raw = input[rule.field];
      if (isPresent(raw)) {
        await resolver.assertDocument(
          String(raw),
          `${toolName}: ${rule.field}`
        );
      }
      return input;
    }
  }
}

/**
 * Drops out-of-scope entries from a response. Only `get_project_list` needs
 * this: it takes no project argument, so the allow-list can only be applied
 * after the fact.
 */
function filterOutput(
  rule: ScopeRule,
  result: unknown,
  resolver: ProjectResolver
): unknown {
  if (rule.kind !== 'projectList' || !Array.isArray(result)) {
    return result;
  }
  return result.filter((project) => {
    const key = (project as { projectKey?: unknown }).projectKey;
    return typeof key === 'string' && resolver.isAllowedKey(key);
  });
}

/**
 * Confines one tool handler to the allowed projects. Sits inside the
 * organization context so that resolution goes through the right Backlog
 * client, and outside the tool itself so no tool can bypass it.
 */
export function wrapWithProjectScope<I extends Input, O>(
  toolName: string,
  handler: (input: I) => Promise<O>,
  resolver: ProjectResolver
): (input: I) => Promise<O> {
  const rule = scopeRuleFor(toolName);
  return async (input: I): Promise<O> => {
    const scoped = await enforce(rule, toolName, input, resolver);
    const result = await handler(scoped as I);
    return filterOutput(rule, result, resolver) as O;
  };
}
