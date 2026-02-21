/**
 * Folding ranges provider
 * Auto-detects foldable regions from the AST and respects `foldable` annotations on LspRule
 */

import type { ASTNode } from '../parser/ast-node.js';
import type { DocumentState } from '../parser/document-state.js';
import type { LspDefinition } from '../../definition/lsp.js';

/**
 * A folding range in the document
 */
export interface FoldingRange {
  startLine: number;
  endLine: number;
  kind?: 'comment' | 'imports' | 'region';
}

/**
 * Provide folding ranges for a document
 *
 * Walks the AST and creates fold regions for nodes that:
 * 1. Span 2+ lines
 * 2. Have an LspRule with `foldable` set, OR
 * 3. Have any LspRule defined (symbol, hover, etc.)
 */
export function provideFoldingRanges(
  document: DocumentState,
  lsp?: LspDefinition,
): FoldingRange[] {
  if (!lsp) return [];

  const ranges: FoldingRange[] = [];
  walkForFoldingRanges(document.root, lsp, ranges);
  return ranges;
}

function walkForFoldingRanges(
  node: ASTNode,
  lsp: LspDefinition,
  ranges: FoldingRange[],
): void {
  // Only consider named nodes (grammar rules, not punctuation)
  if (node.isNamed) {
    const rule = lsp[node.type];
    if (rule) {
      const startLine = node.startPosition.line;
      const endLine = node.endPosition.line;

      // Only fold multi-line nodes
      if (endLine > startLine) {
        const range: FoldingRange = { startLine, endLine };
        if (typeof rule.foldable === 'string') {
          range.kind = rule.foldable;
        }
        ranges.push(range);
      }
    }
  }

  // Recurse into children
  for (const child of node.namedChildren) {
    walkForFoldingRanges(child, lsp, ranges);
  }
}
