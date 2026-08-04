import { backlogErrorHandler } from './backlog/backlogErrorHandler.js';
import { composeToolHandler } from './handlers/builders/composeToolHandler.js';
import type { ProjectResolver } from './scope/projectResolver.js';
import { isBlocked } from './scope/toolScopePolicy.js';
import { MCPOptions } from './types/mcp.js';
import { DynamicToolDefinition, ToolDefinition } from './types/tool.js';
import { DynamicToolsetGroup, ToolsetGroup } from './types/toolsets.js';
import { BacklogMCPServer } from './utils/wrapServerWithToolRegistry.js';

type ToolsetSource = ToolsetGroup | DynamicToolsetGroup;

type RegisterOptions = {
  server: BacklogMCPServer;
  toolsetGroup: ToolsetSource;
  prefix: string;
  /**
   * Produces what the tool is registered with. Returning the schema instead of
   * reading it back off the definition keeps the definition immutable, which is
   * required now that one toolset group is shared across per-request servers.
   */
  prepareTool: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: ToolDefinition<any, any> | DynamicToolDefinition<any>
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: ToolDefinition<any, any>['schema'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => any;
  };
  /** Registration filter; a tool it rejects is never exposed to the client. */
  shouldRegister?: (toolName: string) => boolean;
  describeTool?: (description: string) => string;
};

/**
 * Tells the model what the server can reach, so it stops proposing work in
 * projects that would only be refused.
 */
function scopeNotice(resolver: ProjectResolver): string {
  return (
    `Project scope: this server is restricted to the Backlog project(s) ${resolver.keys.join(', ')}. ` +
    `Requests referencing any other project are refused.`
  );
}

export function registerTools(
  server: BacklogMCPServer,
  toolsetGroup: ToolsetGroup,
  options: MCPOptions
) {
  const { useFields, maxTokens, prefix, useOrganization, projectResolver } =
    options;

  registerToolsets({
    server,
    toolsetGroup,
    prefix,
    // Deny by default: a tool the scope policy doesn't classify — including one
    // added upstream after this fork — is not registered at all.
    shouldRegister: projectResolver
      ? (toolName) => !isBlocked(toolName)
      : undefined,
    describeTool: projectResolver
      ? (description) => `${description}\n\n${scopeNotice(projectResolver)}`
      : undefined,
    prepareTool: (tool) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      composeToolHandler(tool as ToolDefinition<any, any>, {
        useFields,
        errorHandler: backlogErrorHandler,
        maxTokens,
        useOrganization,
        projectResolver,
      }),
  });
}

export function registerDynamicTools(
  server: BacklogMCPServer,
  dynamicToolsetGroup: DynamicToolsetGroup,
  prefix: string
) {
  registerToolsets({
    server,
    toolsetGroup: dynamicToolsetGroup,
    prefix,
    prepareTool: (tool) => ({ schema: tool.schema, handler: tool.handler }),
  });
}

function registerToolsets({
  server,
  toolsetGroup,
  prefix,
  prepareTool,
  shouldRegister,
  describeTool,
}: RegisterOptions) {
  for (const toolset of toolsetGroup.toolsets) {
    if (!toolset.enabled) {
      continue;
    }

    for (const tool of toolset.tools) {
      if (shouldRegister && !shouldRegister(tool.name)) {
        continue;
      }

      const toolNameWithPrefix = `${prefix}${tool.name}`;
      const { schema, handler } = prepareTool(tool);
      const description = describeTool
        ? describeTool(tool.description)
        : tool.description;

      server.registerOnce(toolNameWithPrefix, description, schema, handler);
    }
  }
}
