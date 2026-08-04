# Project Scope

This fork confines the MCP server to an explicit allow-list of Backlog projects. Upstream (nulab/backlog-mcp-server) lets an agent read and write across every project in the space; with a scope configured, anything referencing a project outside the list is refused.

日本語版: [project-scope.ja.md](project-scope.ja.md)

## This is not a security boundary

State the premise first.

**This guards against accidental cross-project work; it is not a security boundary.** Whether you authenticate with an API key or OAuth, the credential carries whatever permissions the Backlog account has — space-wide. Anyone able to call the Backlog API directly (with `curl`, say) is unaffected by any of this.

If you need a technical boundary, **create a Backlog account that only belongs to the intended projects and use that account's API key (or OAuth authorization).** Treat this layer as defense in depth on top of that.

## Configuration

Pass a comma-separated list of project keys, by environment variable or CLI flag.

| Form | Example |
|---|---|
| Environment variable | `BACKLOG_ALLOWED_PROJECTS=PBL,INFRA` |
| CLI flag | `--allowed-projects "PBL,INFRA"` |

- Case-insensitive; keys are normalized to upper case internally.
- Unset or empty means no restriction — identical to upstream.
- These are project *keys*, not names or ids (the `PBL` in `PBL-123`).

```json
{
  "mcpServers": {
    "backlog": {
      "command": "npx",
      "args": ["-y", "backlog-mcp-server"],
      "env": {
        "BACKLOG_DOMAIN": "your-space.backlog.com",
        "BACKLOG_API_KEY": "your-api-key",
        "BACKLOG_ALLOWED_PROJECTS": "PBL,INFRA"
      }
    }
  }
}
```

## Behaviour when scoped

### 1. Tools taking a project argument

`projectId` / `projectKey` / `projectIdOrKey` is checked against the allow-list before the tool runs. A value outside it is refused without reaching Backlog.

When exactly one project is allowed and the argument is missing, it is filled in. With several allowed projects, the call is refused with an error telling the model to name one.

### 2. Tools whose project filter is optional

The `projectId` of `get_issues` / `count_issues` and the `projectIds` of `get_documents` are optional filters — omitting them targets the whole space. In that case **the allow-list is injected**. When the caller does supply values, every one of them is validated.

### 3. Tools addressed by issue, wiki, or document id

Tools like `get_issue` and `update_wiki` take no project argument, so the owning project is resolved first and then checked.

An issue key (`PBL-123`) carries its project in the prefix, so it is decided **without any API call**. Only a numeric id costs one lookup, and the result is cached.

A second issue in the same call — `parentIssueId` on `update_issue`, `targetIssueId` on `add_related_issue` — is checked the same way.

### 4. Response filtering

`get_project_list` takes no project argument, so out-of-scope projects are removed from its response instead.

### 5. Tools that are not registered (18)

Tools the Backlog API offers no way to narrow to a project are not registered at all; the agent never sees them.

| Group | Tools |
|---|---|
| Notifications | `get_notifications`, `count_notifications`, `mark_notification_as_read`, `reset_unread_notification_count` |
| Watching | `get_watching_list_items`, `get_watching_list_count`, `add_watching`, `update_watching`, `delete_watching`, `mark_watching_as_read` |
| Space | `get_space`, `get_space_activities`, `get_users`, `get_user_stars_count`, `get_user_recent_updates` |
| Project administration | `add_project`, `update_project`, `delete_project` |

`update_project` is on the list because **it can rename a project key, which would invalidate the allow-list itself**.

With every toolset enabled, this takes the tool count from 62 to 44.

### 6. Unclassified tools are blocked

A tool name absent from the table in `src/scope/toolScopePolicy.ts` is blocked by default. If upstream adds a tool, it stays unregistered until someone classifies it — fail-safe rather than fail-open.

`src/scope/toolScopePolicy.test.ts` cross-checks the table against the actual tool list in both directions, so any tool added or removed upstream breaks the test rather than slipping through.

## Implementation layout

```
src/scope/
  projectScope.ts         config parsing, ProjectScopeError
  projectResolver.ts      project key/id resolution; issue, wiki and document
                          to project resolution, with caching
  toolScopePolicy.ts      tool name to rule table (deny by default)
  wrapWithProjectScope.ts applies a rule to a tool's input and output
```

The guard is injected once, in `src/handlers/builders/composeToolHandler.ts`, which every tool passes through. **No individual tool implementation was modified**, which keeps the fork easy to rebase onto upstream.

The wrapper sits inside the organization context so that resolution goes through the right Backlog client under a multi-space configuration.

## Limitations

- **Caching**: entity-to-project mappings are cached in-process (5000 entries, cleared wholesale on overflow). The mapping never changes, so staleness is not a concern, but a long-lived process holds some memory.
- **Existence oracle**: refusing an out-of-scope issue id reveals that the issue exists. No content is ever returned.
- **Attachments**: attachment ids are not validated per project. The only tools taking them (`add_issue`, `add_issue_comment`) act on issues that are already inside the allow-list.
