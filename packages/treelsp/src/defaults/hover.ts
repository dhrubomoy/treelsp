/**
 * Default hover implementation
 * Provides generic hover text based on grammar shape
 */

import type { LspContext } from '../definition/lsp.js';

/**
 * Default hover handler
 * For references: resolves to declaration and shows its hover
 * For declarations: shows node type and name field
 */
export function hover(node: any, ctx: LspContext): string | null {
  // TODO: Implement in runtime
  return null;
}
