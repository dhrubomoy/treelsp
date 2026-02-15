/**
 * Document symbols provider
 * Lists declarations with symbol descriptors for outline view
 */

import type { Position } from '../parser/node.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { LspDefinition, SymbolKind } from '../../definition/lsp.js';

/**
 * LSP SymbolKind mapping
 */
const SYMBOL_KIND_MAP: Record<SymbolKind, number> = {
  File: 1,
  Module: 2,
  Namespace: 3,
  Package: 4,
  Class: 5,
  Method: 6,
  Property: 7,
  Field: 8,
  Constructor: 9,
  Enum: 10,
  Interface: 11,
  Function: 12,
  Variable: 13,
  Constant: 14,
  String: 15,
  Number: 16,
  Boolean: 17,
  Array: 18,
};

// Re-export for external use
export { SYMBOL_KIND_MAP };

/**
 * Document symbol entry
 */
export interface DocumentSymbol {
  name: string;
  kind: SymbolKind;
  kindNumber: number;
  detail?: string;
  range: { start: Position; end: Position };
  selectionRange: { start: Position; end: Position };
}

/**
 * Provide document symbols
 *
 * Walks all declarations and builds symbol entries for those
 * with a symbol descriptor defined in the LSP config
 */
export function provideSymbols(
  docScope: DocumentScope,
  lsp?: LspDefinition
): DocumentSymbol[] {
  if (!lsp) {
    return [];
  }

  const symbols: DocumentSymbol[] = [];

  for (const decl of docScope.declarations) {
    const lspRule = lsp[decl.declaredBy];
    if (!lspRule?.symbol) {
      continue;
    }

    const descriptor = lspRule.symbol;
    const declParent = decl.node.parent;

    // Get label
    let name: string;
    if (typeof descriptor.label === 'function') {
      name = declParent ? descriptor.label(declParent) : decl.name;
    } else {
      name = descriptor.label;
    }

    // Get detail
    let detail: string | undefined;
    if (typeof descriptor.detail === 'function') {
      detail = declParent ? descriptor.detail(declParent) : undefined;
    } else {
      detail = descriptor.detail;
    }

    // Range: use parent node (the full declaration) if available
    const rangeNode = declParent ?? decl.node;

    const sym: DocumentSymbol = {
      name,
      kind: descriptor.kind,
      kindNumber: SYMBOL_KIND_MAP[descriptor.kind] ?? 13, // Variable as fallback
      range: {
        start: rangeNode.startPosition,
        end: rangeNode.endPosition,
      },
      selectionRange: {
        start: decl.node.startPosition,
        end: decl.node.endPosition,
      },
    };
    if (detail) {
      sym.detail = detail;
    }
    symbols.push(sym);
  }

  return symbols;
}
