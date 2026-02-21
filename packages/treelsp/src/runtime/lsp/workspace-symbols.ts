/**
 * Workspace symbols provider
 * Searches across all open documents for matching symbols
 */

import type { Position } from '../parser/ast-node.js';
import type { LspDefinition, SymbolKind } from '../../definition/lsp.js';
import type { DocumentManager } from './documents.js';
import { SYMBOL_KIND_MAP } from './symbols.js';

/**
 * A workspace symbol with location info
 */
export interface WorkspaceSymbol {
  name: string;
  kind: SymbolKind;
  kindNumber: number;
  location: { uri: string; range: { start: Position; end: Position } };
}

/**
 * Provide workspace symbols matching a query
 *
 * Iterates all open documents, collects declarations with symbol descriptors,
 * and filters by query (case-insensitive substring match).
 */
export function provideWorkspaceSymbols(
  query: string,
  documents: DocumentManager,
  lsp?: LspDefinition,
): WorkspaceSymbol[] {
  if (!lsp) return [];

  const symbols: WorkspaceSymbol[] = [];
  const lowerQuery = query.toLowerCase();

  for (const wsDoc of documents.getAllDocuments()) {
    for (const decl of wsDoc.scope.declarations) {
      const rule = lsp[decl.declaredBy];
      if (!rule?.symbol) continue;

      // Filter by query
      if (lowerQuery && !decl.name.toLowerCase().includes(lowerQuery)) continue;

      const descriptor = rule.symbol;
      const declParent = decl.node.parent;

      // Get label
      let name: string;
      if (typeof descriptor.label === 'function') {
        name = declParent ? descriptor.label(declParent) : decl.name;
      } else {
        name = descriptor.label;
      }

      const rangeNode = declParent ?? decl.node;

      symbols.push({
        name,
        kind: descriptor.kind,
        kindNumber: SYMBOL_KIND_MAP[descriptor.kind] ?? 13,
        location: {
          uri: wsDoc.document.uri,
          range: {
            start: rangeNode.startPosition,
            end: rangeNode.endPosition,
          },
        },
      });
    }
  }

  return symbols;
}
