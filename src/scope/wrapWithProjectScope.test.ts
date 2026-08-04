import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Backlog } from 'backlog-js';
import { createProjectResolver } from './projectResolver.js';
import { createProjectScope } from './projectScope.js';
import { wrapWithProjectScope } from './wrapWithProjectScope.js';

const PROJECTS: Record<string, number> = { PBL: 100, INFRA: 200, OTHER: 999 };

function mockBacklog() {
  return {
    getProject: vi.fn(async (idOrKey: string | number) => {
      const key = String(idOrKey).toUpperCase();
      if (!(key in PROJECTS)) {
        throw new Error(`No such project: ${key}`);
      }
      return { id: PROJECTS[key], projectKey: key };
    }),
    getIssue: vi.fn(async (idOrKey: string | number) => {
      // 4001 lives in PBL, 4002 in OTHER.
      const projectId = String(idOrKey) === '4001' ? 100 : 999;
      return { id: Number(idOrKey), projectId };
    }),
    getWiki: vi.fn(async (wikiId: number) => ({
      id: wikiId,
      projectId: wikiId === 7001 ? 100 : 999,
    })),
    getDocument: vi.fn(async (documentId: string) => ({
      id: documentId,
      projectId: documentId === 'doc-in-scope' ? 100 : 999,
    })),
  };
}

type MockBacklog = ReturnType<typeof mockBacklog>;

/** Wraps a pass-through handler so tests can inspect the input it received. */
function scoped(toolName: string, backlog: MockBacklog, keys = 'PBL,INFRA') {
  const scope = createProjectScope(keys);
  if (!scope) throw new Error('test setup: scope required');
  const resolver = createProjectResolver(backlog as unknown as Backlog, scope);
  const handler = vi.fn(async (input: Record<string, unknown>) => input);
  return {
    handler,
    call: wrapWithProjectScope(toolName, handler, resolver),
  };
}

describe('wrapWithProjectScope', () => {
  let backlog: MockBacklog;

  beforeEach(() => {
    backlog = mockBacklog();
  });

  describe('projectId/projectKey pair', () => {
    it('allows an in-scope project key', async () => {
      const { call, handler } = scoped('get_categories', backlog);
      await call({ projectKey: 'PBL' });
      expect(handler).toHaveBeenCalledWith({ projectKey: 'PBL' });
    });

    it('accepts a key in any casing', async () => {
      const { call } = scoped('get_categories', backlog);
      await expect(call({ projectKey: 'pbl' })).resolves.toBeDefined();
    });

    it('refuses an out-of-scope project key without calling Backlog', async () => {
      const { call, handler } = scoped('get_categories', backlog);
      await expect(call({ projectKey: 'OTHER' })).rejects.toThrow(
        /outside this server's allowed projects \(PBL, INFRA\)/
      );
      expect(handler).not.toHaveBeenCalled();
      expect(backlog.getProject).not.toHaveBeenCalled();
    });

    it('allows an in-scope numeric project id', async () => {
      const { call, handler } = scoped('get_categories', backlog);
      await call({ projectId: 100 });
      expect(handler).toHaveBeenCalledWith({ projectId: 100 });
    });

    it('refuses an out-of-scope numeric project id', async () => {
      const { call, handler } = scoped('get_categories', backlog);
      await expect(call({ projectId: 999 })).rejects.toThrow(/id 999/);
      expect(handler).not.toHaveBeenCalled();
    });

    it('fills in the project when exactly one is allowed', async () => {
      const { call, handler } = scoped('get_categories', backlog, 'PBL');
      await call({});
      expect(handler).toHaveBeenCalledWith({ projectKey: 'PBL' });
    });

    it('refuses to guess when several projects are allowed', async () => {
      const { call } = scoped('get_categories', backlog);
      await expect(call({})).rejects.toThrow(/requires a project/);
    });
  });

  describe('project id list', () => {
    it('injects the whole allow-list when no filter is given', async () => {
      const { call, handler } = scoped('get_issues', backlog);
      await call({ keyword: 'bug' });
      expect(handler).toHaveBeenCalledWith({
        keyword: 'bug',
        projectId: [100, 200],
      });
    });

    it('keeps an in-scope filter as-is', async () => {
      const { call, handler } = scoped('get_issues', backlog);
      await call({ projectId: [100] });
      expect(handler).toHaveBeenCalledWith({ projectId: [100] });
    });

    it('refuses when any project in the filter is out of scope', async () => {
      const { call, handler } = scoped('get_issues', backlog);
      await expect(call({ projectId: [100, 999] })).rejects.toThrow(/id 999/);
      expect(handler).not.toHaveBeenCalled();
    });

    it('applies to documents via projectIds', async () => {
      const { call, handler } = scoped('get_documents', backlog);
      await call({});
      expect(handler).toHaveBeenCalledWith({ projectIds: [100, 200] });
    });
  });

  describe('issue-addressed tools', () => {
    it('accepts an in-scope issue key without hitting the API', async () => {
      const { call, handler } = scoped('get_issue', backlog);
      await call({ issueKey: 'PBL-123' });
      expect(handler).toHaveBeenCalled();
      expect(backlog.getIssue).not.toHaveBeenCalled();
    });

    it('refuses an out-of-scope issue key without hitting the API', async () => {
      const { call, handler } = scoped('get_issue', backlog);
      await expect(call({ issueKey: 'OTHER-1' })).rejects.toThrow(
        /belongs to project OTHER/
      );
      expect(handler).not.toHaveBeenCalled();
      expect(backlog.getIssue).not.toHaveBeenCalled();
    });

    it('resolves a numeric issue id through the API', async () => {
      const { call, handler } = scoped('get_issue', backlog);
      await call({ issueId: 4001 });
      expect(backlog.getIssue).toHaveBeenCalledWith(4001);
      expect(handler).toHaveBeenCalled();
    });

    it('refuses a numeric issue id from another project', async () => {
      const { call, handler } = scoped('delete_issue', backlog);
      await expect(call({ issueId: 4002 })).rejects.toThrow(/id 999/);
      expect(handler).not.toHaveBeenCalled();
    });

    it('caches the issue-to-project lookup', async () => {
      const { call } = scoped('get_issue', backlog);
      await call({ issueId: 4001 });
      await call({ issueId: 4001 });
      expect(backlog.getIssue).toHaveBeenCalledTimes(1);
    });

    it('checks the second issue of a relation too', async () => {
      const { call, handler } = scoped('add_related_issue', backlog);
      await expect(
        call({ issueKey: 'PBL-1', targetIssueId: 4002 })
      ).rejects.toThrow(/targetIssueId/);
      expect(handler).not.toHaveBeenCalled();
    });

    it('checks a parent issue in another project', async () => {
      const { call } = scoped('update_issue', backlog);
      await expect(
        call({ issueKey: 'PBL-1', parentIssueId: 4002 })
      ).rejects.toThrow(/parentIssueId/);
    });
  });

  describe('wiki and document', () => {
    it('allows an in-scope wiki page', async () => {
      const { call, handler } = scoped('update_wiki', backlog);
      await call({ wikiId: 7001, name: 'x' });
      expect(handler).toHaveBeenCalled();
    });

    it('refuses an out-of-scope wiki page', async () => {
      const { call, handler } = scoped('update_wiki', backlog);
      await expect(call({ wikiId: 7999 })).rejects.toThrow(/id 999/);
      expect(handler).not.toHaveBeenCalled();
    });

    it('refuses an out-of-scope document', async () => {
      const { call, handler } = scoped('get_document', backlog);
      await expect(call({ documentId: 'doc-elsewhere' })).rejects.toThrow(
        /id 999/
      );
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('project list', () => {
    it('drops out-of-scope projects from the response', async () => {
      const scope = createProjectScope('PBL,INFRA');
      const resolver = createProjectResolver(
        backlog as unknown as Backlog,
        scope!
      );
      const call = wrapWithProjectScope(
        'get_project_list',
        async () => [
          { id: 100, projectKey: 'PBL' },
          { id: 999, projectKey: 'OTHER' },
          { id: 200, projectKey: 'INFRA' },
        ],
        resolver
      );
      await expect(call({})).resolves.toEqual([
        { id: 100, projectKey: 'PBL' },
        { id: 200, projectKey: 'INFRA' },
      ]);
    });
  });

  it('passes space-level master data through untouched', async () => {
    const { call, handler } = scoped('get_priorities', backlog);
    await call({});
    expect(handler).toHaveBeenCalledWith({});
    expect(backlog.getProject).not.toHaveBeenCalled();
  });

  it('reports a failure to resolve the allow-list without caching it', async () => {
    const { call } = scoped('get_issues', backlog, 'NOPE');
    await expect(call({})).rejects.toThrow(/Could not resolve the allowed/);
    await expect(call({})).rejects.toThrow(/Could not resolve the allowed/);
    expect(backlog.getProject).toHaveBeenCalledTimes(2);
  });
});
