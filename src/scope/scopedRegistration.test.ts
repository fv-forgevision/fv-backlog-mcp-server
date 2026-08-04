import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Backlog } from 'backlog-js';
import { McpServer } from '@modelcontextprotocol/server';
import type { TranslationHelper } from '../createTranslationHelper.js';
import { registerTools } from '../registerTools.js';
import { buildToolsetGroup } from '../utils/toolsetUtils.js';
import { wrapServerWithToolRegistry } from '../utils/wrapServerWithToolRegistry.js';
import { createProjectResolver } from './projectResolver.js';
import { createProjectScope } from './projectScope.js';

vi.mock('../handlers/builders/composeToolHandler.js', () => ({
  composeToolHandler: vi.fn((tool) => ({
    schema: tool.schema,
    handler: vi.fn(),
  })),
}));

const mockBacklog = {} as Backlog;
const mockHelper = {
  t: vi.fn((_key: string, fallback: string) => fallback),
} as unknown as TranslationHelper;

function register(withScope: boolean) {
  const registerTool = vi.fn();
  const server = wrapServerWithToolRegistry({
    registerTool,
  } as unknown as McpServer);
  const scope = createProjectScope('PBL');

  registerTools(server, buildToolsetGroup(mockBacklog, mockHelper, ['all']), {
    useFields: false,
    prefix: '',
    maxTokens: 5000,
    useOrganization: false,
    projectResolver:
      withScope && scope
        ? createProjectResolver(mockBacklog, scope)
        : undefined,
  });

  const calls = (registerTool as Mock).mock.calls;
  return {
    names: calls.map((call) => call[0] as string),
    // registerOnce forwards to registerTool(name, { description, inputSchema }, handler)
    descriptionOf: (name: string) =>
      (calls.find((call) => call[0] === name)?.[1] as { description?: string })
        ?.description,
  };
}

describe('scoped tool registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose space-wide tools when a scope is configured', () => {
    const { names } = register(true);
    for (const blocked of [
      'get_notifications',
      'get_watching_list_items',
      'get_space_activities',
      'get_users',
      'add_project',
      'delete_project',
    ]) {
      expect(names).not.toContain(blocked);
    }
  });

  it('still exposes the project-scoped tools', () => {
    const { names } = register(true);
    for (const allowed of [
      'get_issue',
      'get_issues',
      'add_issue',
      'get_wiki',
      'get_pull_requests',
      'get_project_list',
      'get_priorities',
    ]) {
      expect(names).toContain(allowed);
    }
  });

  it('tells the model which projects it may touch', () => {
    const { descriptionOf } = register(true);
    expect(descriptionOf('get_issues')).toContain(
      'Project scope: this server is restricted to the Backlog project(s) PBL'
    );
  });

  it('registers everything and adds no notice when unscoped', () => {
    const { names, descriptionOf } = register(false);
    expect(names).toContain('get_notifications');
    expect(names).toContain('add_project');
    expect(descriptionOf('get_issues')).not.toContain('Project scope:');
  });
});
