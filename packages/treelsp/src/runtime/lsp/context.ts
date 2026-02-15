/**
 * LSP context factory and shared helpers
 * Builds LspContext from DocumentScope + Workspace for use by all handlers
 */

import type { ASTNode, Position } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type { Scope, Declaration, Reference } from '../scope/scope.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { Workspace } from '../scope/workspace.js';
import type { SemanticDefinition } from '../../definition/semantic.js';
import type { LspContext } from '../../definition/lsp.js';

/**
 * Create LspContext for handler use
 */
export function createLspContext(
  docScope: DocumentScope,
  workspace: Workspace,
  document: DocumentState,
  _semantic: SemanticDefinition
): LspContext {
  return {
    resolve(node: ASTNode): ASTNode | null {
      const ref = findReferenceForNode(node, docScope);
      return ref?.resolved?.node ?? null;
    },

    typeOf(_node: ASTNode): any {
      return null; // V2
    },

    scopeOf(node: ASTNode): Scope {
      return findScopeForNode(node, docScope);
    },

    document,
    workspace,
  };
}

/**
 * Find the smallest named node at a position
 *
 * When the cursor is at the exclusive end of a token (e.g., right edge of an
 * identifier), tree-sitter returns the parent node because that position falls
 * in whitespace. In that case, look one character back to find the token the
 * user likely intended.
 */
export function findNodeAtPosition(root: ASTNode, position: Position): ASTNode {
  const node = root.descendantForPosition(position);
  if (node.namedChildCount > 0 && position.character > 0) {
    const prev = root.descendantForPosition({
      line: position.line,
      character: position.character - 1,
    });
    if (prev.namedChildCount === 0) {
      return prev;
    }
  }
  return node;
}

/**
 * Find the reference entry for a node (by position match)
 */
export function findReferenceForNode(node: ASTNode, docScope: DocumentScope): Reference | null {
  const startLine = node.startPosition.line;
  const startChar = node.startPosition.character;
  const endLine = node.endPosition.line;
  const endChar = node.endPosition.character;

  for (const ref of docScope.references) {
    const refStart = ref.node.startPosition;
    const refEnd = ref.node.endPosition;
    if (
      refStart.line === startLine &&
      refStart.character === startChar &&
      refEnd.line === endLine &&
      refEnd.character === endChar
    ) {
      return ref;
    }
  }
  return null;
}

/**
 * Find the declaration entry for a node (by position match)
 */
export function findDeclarationForNode(node: ASTNode, docScope: DocumentScope): Declaration | null {
  const startLine = node.startPosition.line;
  const startChar = node.startPosition.character;

  for (const decl of docScope.declarations) {
    const declStart = decl.node.startPosition;
    if (
      declStart.line === startLine &&
      declStart.character === startChar
    ) {
      return decl;
    }
  }
  return null;
}

/**
 * Find the scope that contains a node
 * Walks up the parent chain checking nodeScopes map
 */
export function findScopeForNode(node: ASTNode, docScope: DocumentScope): Scope {
  let current: ASTNode | null = node;
  while (current) {
    const scope = docScope.nodeScopes.get(current.id);
    if (scope) {
      return scope;
    }
    current = current.parent;
  }
  // Fallback to root scope
  return docScope.root;
}

/**
 * Convert an ASTNode to an LSP-style range
 */
export function nodeToRange(node: ASTNode): { start: Position; end: Position } {
  return {
    start: node.startPosition,
    end: node.endPosition,
  };
}

/**
 * Convert an ASTNode to an LSP-style location
 */
export function nodeToLocation(node: ASTNode, uri: string): { uri: string; range: { start: Position; end: Position } } {
  return {
    uri,
    range: nodeToRange(node),
  };
}
