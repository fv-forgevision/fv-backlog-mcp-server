import type { ProjectResolver } from '../scope/projectResolver.js';

export type MCPOptions = {
  useFields: boolean;
  maxTokens: number;
  prefix: string;
  /**
   * Confines every tool to an allow-list of projects. Undefined leaves the
   * server unrestricted, matching upstream behaviour.
   */
  projectResolver?: ProjectResolver;
  /**
   * Whether tools take an `organization` parameter. Only true when more than one
   * Backlog space is configured; see `BacklogClientRegistry.isMultiOrganization`.
   */
  useOrganization: boolean;
};
