/**
 * How each tool is confined to the allowed projects.
 *
 * The table is exhaustive on purpose and the lookup is deny-by-default: a tool
 * that isn't listed here is not registered at all. That way a tool added
 * upstream cannot silently reach across projects just because nobody updated
 * this file — it disappears until someone classifies it.
 */

export type ScopeRule =
  /** Not registered. Inherently space-wide, with no per-project variant. */
  | { kind: 'blocked'; reason: string }
  /** Space-level master data that names no project. Passes through untouched. */
  | { kind: 'unscoped' }
  /** The `projectId?: number` + `projectKey?: string` pair most tools take. */
  | { kind: 'projectPair' }
  /** A required numeric `projectId`. */
  | { kind: 'projectId'; field: string }
  /** An optional `number[]` project filter; defaults to the whole allow-list. */
  | { kind: 'projectIdList'; field: string }
  /** A required `projectIdOrKey` string. */
  | { kind: 'projectIdOrKey'; field: string }
  /** Addressed by issue; the project comes from the issue itself. */
  | {
      kind: 'issue';
      /** Reads the `issueId?: number` + `issueKey?: string` pair. */
      pair?: boolean;
      /** Fields holding a single id-or-key value, e.g. `issueIdOrKey`. */
      idOrKeyFields?: readonly string[];
      /** Further numeric issue ids that must also stay in scope. */
      extraIssueIdFields?: readonly string[];
    }
  | { kind: 'wiki'; field: string }
  | { kind: 'document'; field: string }
  /** Returns projects; the response is filtered down to the allow-list. */
  | { kind: 'projectList' };

const PROJECT_PAIR: ScopeRule = { kind: 'projectPair' };

const WATCHING_REASON =
  'watch lists are keyed by watch id and span every project the user watches';
const NOTIFICATION_REASON =
  'notifications are delivered space-wide and cannot be filtered by project at the API level';

export const TOOL_SCOPE_POLICY: Readonly<Record<string, ScopeRule>> = {
  // --- space -------------------------------------------------------------
  get_space: {
    kind: 'blocked',
    reason: 'returns space-level settings unrelated to any project',
  },
  get_space_activities: {
    kind: 'blocked',
    reason: 'streams activity from every project in the space',
  },
  get_users: {
    kind: 'blocked',
    reason: 'lists every user in the space; use get_project_users instead',
  },
  get_user_stars_count: {
    kind: 'blocked',
    reason: 'counts stars across every project',
  },
  get_user_recent_updates: {
    kind: 'blocked',
    reason: 'returns a user activity feed spanning every project',
  },
  get_myself: { kind: 'unscoped' },

  // --- project -----------------------------------------------------------
  get_project_list: { kind: 'projectList' },
  add_project: {
    kind: 'blocked',
    reason: 'creating a project necessarily falls outside the allow-list',
  },
  update_project: {
    kind: 'blocked',
    reason:
      'can rename a project key, which would invalidate the allow-list itself',
  },
  delete_project: {
    kind: 'blocked',
    reason: 'destroys an entire project; out of scope for a scoped server',
  },
  get_project: PROJECT_PAIR,
  get_project_users: PROJECT_PAIR,

  // --- issue -------------------------------------------------------------
  get_issue: { kind: 'issue', pair: true },
  get_issues: { kind: 'projectIdList', field: 'projectId' },
  count_issues: { kind: 'projectIdList', field: 'projectId' },
  add_issue: { kind: 'projectId', field: 'projectId' },
  update_issue: {
    kind: 'issue',
    pair: true,
    extraIssueIdFields: ['parentIssueId'],
  },
  delete_issue: { kind: 'issue', pair: true },
  get_issue_comments: { kind: 'issue', pair: true },
  add_issue_comment: { kind: 'issue', pair: true },
  update_issue_comment: { kind: 'issue', pair: true },
  get_related_issues: { kind: 'issue', pair: true },
  add_related_issue: {
    kind: 'issue',
    pair: true,
    extraIssueIdFields: ['targetIssueId'],
  },
  remove_related_issue: {
    kind: 'issue',
    pair: true,
    extraIssueIdFields: ['relatedIssueId'],
  },
  get_priorities: { kind: 'unscoped' },
  get_resolutions: { kind: 'unscoped' },
  get_categories: PROJECT_PAIR,
  get_custom_fields: PROJECT_PAIR,
  get_issue_types: PROJECT_PAIR,
  get_version_milestone_list: PROJECT_PAIR,
  add_version_milestone: PROJECT_PAIR,
  update_version_milestone: PROJECT_PAIR,
  delete_version: PROJECT_PAIR,
  get_watching_list_items: { kind: 'blocked', reason: WATCHING_REASON },
  get_watching_list_count: { kind: 'blocked', reason: WATCHING_REASON },
  add_watching: { kind: 'blocked', reason: WATCHING_REASON },
  update_watching: { kind: 'blocked', reason: WATCHING_REASON },
  delete_watching: { kind: 'blocked', reason: WATCHING_REASON },
  mark_watching_as_read: { kind: 'blocked', reason: WATCHING_REASON },

  // --- wiki --------------------------------------------------------------
  get_wiki_pages: PROJECT_PAIR,
  get_wikis_count: PROJECT_PAIR,
  get_wiki: { kind: 'wiki', field: 'wikiId' },
  add_wiki: { kind: 'projectId', field: 'projectId' },
  update_wiki: { kind: 'wiki', field: 'wikiId' },

  // --- git ---------------------------------------------------------------
  get_git_repositories: PROJECT_PAIR,
  get_git_repository: PROJECT_PAIR,
  get_pull_requests: PROJECT_PAIR,
  get_pull_requests_count: PROJECT_PAIR,
  get_pull_request: PROJECT_PAIR,
  add_pull_request: PROJECT_PAIR,
  update_pull_request: PROJECT_PAIR,
  get_pull_request_comments: PROJECT_PAIR,
  add_pull_request_comment: PROJECT_PAIR,
  update_pull_request_comment: PROJECT_PAIR,

  // --- document ----------------------------------------------------------
  get_documents: { kind: 'projectIdList', field: 'projectIds' },
  get_document_tree: { kind: 'projectIdOrKey', field: 'projectIdOrKey' },
  get_document: { kind: 'document', field: 'documentId' },
  // Upstream registers this one in camelCase, unlike every other tool.
  addDocument: { kind: 'projectId', field: 'projectId' },

  // --- notifications -----------------------------------------------------
  get_notifications: { kind: 'blocked', reason: NOTIFICATION_REASON },
  count_notifications: { kind: 'blocked', reason: NOTIFICATION_REASON },
  reset_unread_notification_count: {
    kind: 'blocked',
    reason: NOTIFICATION_REASON,
  },
  mark_notification_as_read: { kind: 'blocked', reason: NOTIFICATION_REASON },
};

const UNCLASSIFIED: ScopeRule = {
  kind: 'blocked',
  reason:
    'not classified in the project scope policy; unknown tools are blocked by default',
};

export function scopeRuleFor(toolName: string): ScopeRule {
  return TOOL_SCOPE_POLICY[toolName] ?? UNCLASSIFIED;
}

export function isBlocked(toolName: string): boolean {
  return scopeRuleFor(toolName).kind === 'blocked';
}

/** The explicitly blocked tools, for start-up logging. */
export function blockedToolNames(): string[] {
  return Object.entries(TOOL_SCOPE_POLICY)
    .filter(([, rule]) => rule.kind === 'blocked')
    .map(([name]) => name)
    .sort();
}
