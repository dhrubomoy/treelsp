/**
 * Default symbol implementation
 * Provides document symbols from declarations
 */

import type { SymbolDescriptor } from '../definition/lsp.js';

/**
 * Default symbol descriptor
 * Uses name field if available, otherwise falls back to node type
 */
export function symbol(node: any): SymbolDescriptor | null {
  const nameNode = node.field?.('name');
  if (!nameNode) {
    return null;
  }

  return {
    kind: 'Variable',
    label: nameNode.text as string,
  };
}
