/**
 * Hover provider
 * Shows information when hovering over nodes
 */

import type { Position } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { Workspace } from '../scope/workspace.js';
import type { SemanticDefinition } from '../../definition/semantic.js';
import type { LspDefinition } from '../../definition/lsp.js';
import {
  createLspContext,
  findNodeAtPosition,
  findReferenceForNode,
  findDeclarationForNode,
} from './context.js';

/**
 * Hover result
 */
export interface HoverResult {
  contents: string;
  range: { start: Position; end: Position };
}

/**
 * Provide hover information at position
 *
 * Strategy:
 * 1. Find node at position
 * 2. If node is a reference → resolve to declaration → use declaration's hover
 * 3. If node is a declaration → use its hover directly
 * 4. Fall back to default hover (type + name)
 */
export function provideHover(
  document: DocumentState,
  position: Position,
  docScope: DocumentScope,
  semantic: SemanticDefinition,
  lsp?: LspDefinition,
  workspace?: Workspace
): HoverResult | null {
  const node = findNodeAtPosition(document.root, position);

  // Skip whitespace/root nodes
  if (node.type === document.root.type) {
    return null;
  }

  const ctx = createLspContext(
    docScope,
    workspace ?? ({} as Workspace),
    document,
    semantic
  );

  // Check if it's a reference — resolve to declaration
  const ref = findReferenceForNode(node, docScope);
  if (ref) {
    if (!ref.resolved) {
      return null; // Unresolved reference — no hover
    }

    const declNode = ref.resolved.node;
    const declParent = declNode.parent;
    const declType = ref.resolved.declaredBy;

    // Try custom hover on the declaration's rule type
    const hoverHandler = lsp?.[declType]?.hover;
    if (hoverHandler && declParent) {
      const contents = hoverHandler(declParent, ctx);
      if (contents) {
        return {
          contents,
          range: { start: node.startPosition, end: node.endPosition },
        };
      }
    }

    // Default: show declaring rule type and name
    return {
      contents: `**${declType}** \`${ref.resolved.name}\``,
      range: { start: node.startPosition, end: node.endPosition },
    };
  }

  // Check if it's a declaration
  const decl = findDeclarationForNode(node, docScope);
  if (decl) {
    const declParent = node.parent;

    // Try custom hover
    const hoverHandler = lsp?.[decl.declaredBy]?.hover;
    if (hoverHandler && declParent) {
      const contents = hoverHandler(declParent, ctx);
      if (contents) {
        return {
          contents,
          range: { start: node.startPosition, end: node.endPosition },
        };
      }
    }

    // Default hover for declarations
    return {
      contents: `**${decl.declaredBy}** \`${decl.name}\``,
      range: { start: node.startPosition, end: node.endPosition },
    };
  }

  return null;
}
