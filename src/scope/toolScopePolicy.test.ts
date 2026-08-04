import { describe, it, expect, vi } from 'vitest';
import type { Backlog } from 'backlog-js';
import type { TranslationHelper } from '../createTranslationHelper.js';
import { allTools } from '../tools/tools.js';
import {
  blockedToolNames,
  isBlocked,
  scopeRuleFor,
  TOOL_SCOPE_POLICY,
} from './toolScopePolicy.js';

const mockBacklog = {} as Backlog;
const mockHelper = {
  t: vi.fn((_key: string, fallback: string) => fallback),
} as unknown as TranslationHelper;

const registeredToolNames = allTools(mockBacklog, mockHelper)
  .toolsets.flatMap((toolset) => toolset.tools)
  .map((tool) => tool.name);

describe('toolScopePolicy', () => {
  // The policy is the only thing standing between the agent and the rest of the
  // space. A tool missing from it is silently dropped; a stale entry means a
  // rule nobody applies. Both are caught here rather than at runtime.
  it('classifies every tool the server can register', () => {
    const missing = registeredToolNames.filter(
      (name) => !(name in TOOL_SCOPE_POLICY)
    );
    expect(missing).toEqual([]);
  });

  it('has no entries for tools that no longer exist', () => {
    const known = new Set(registeredToolNames);
    const stale = Object.keys(TOOL_SCOPE_POLICY).filter(
      (name) => !known.has(name)
    );
    expect(stale).toEqual([]);
  });

  it('blocks unknown tools by default', () => {
    expect(isBlocked('some_tool_added_upstream')).toBe(true);
    expect(scopeRuleFor('some_tool_added_upstream')).toMatchObject({
      kind: 'blocked',
    });
  });

  it('blocks the space-wide tools', () => {
    const blocked = blockedToolNames();
    for (const name of [
      'get_notifications',
      'count_notifications',
      'mark_notification_as_read',
      'reset_unread_notification_count',
      'get_watching_list_items',
      'add_watching',
      'get_space_activities',
      'get_users',
      'get_user_recent_updates',
      'add_project',
      'update_project',
      'delete_project',
    ]) {
      expect(blocked).toContain(name);
    }
  });

  it('keeps the project-scoped tools available', () => {
    for (const name of [
      'get_issue',
      'get_issues',
      'add_issue',
      'update_issue',
      'get_wiki',
      'get_wiki_pages',
      'get_pull_requests',
      'get_document',
      'get_custom_fields',
      'get_project_list',
    ]) {
      expect(isBlocked(name)).toBe(false);
    }
  });

  it('leaves space-level master data unscoped', () => {
    for (const name of ['get_priorities', 'get_resolutions', 'get_myself']) {
      expect(scopeRuleFor(name)).toEqual({ kind: 'unscoped' });
    }
  });
});
