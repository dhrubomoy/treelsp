/**
 * Scope resolution runtime
 * Public API for scope chain, resolver, and workspace
 */

export { Scope, type Declaration, type Reference } from './scope.js';
export {
  buildScopes,
  type ResolutionContext,
  type DocumentScope,
} from './resolver.js';
export { Workspace, type WorkspaceDocument } from './workspace.js';
