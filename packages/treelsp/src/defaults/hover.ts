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
  // Try to get a name from common field names
  const nameNode = node.field?.('name');
  if (nameNode) {
    return `**${node.type as string}** \`${nameNode.text as string}\``;
  }

  // Fallback to node type and text
  if (node.type && node.text) {
    const text = (node.text as string).length > 50
      ? (node.text as string).slice(0, 50) + '...'
      : node.text as string;
    return `**${node.type as string}** \`${text}\``;
  }

  return null;
}
