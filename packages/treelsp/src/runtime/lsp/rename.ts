/**
 * Rename provider
 * Fully automatic from semantic layer
 */

import type { ASTNode, Position } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { Workspace } from '../scope/workspace.js';
import type { Declaration } from '../scope/scope.js';
import {
  findNodeAtPosition,
  findReferenceForNode,
  findDeclarationForNode,
  nodeToRange,
} from './context.js';

/**
 * Text edit for rename
 */
export interface RenameEdit {
  range: { start: Position; end: Position };
  newText: string;
}

/**
 * Rename result — workspace edit grouped by URI
 */
export interface RenameResult {
  changes: Record<string, RenameEdit[]>;
}

/**
 * Prepare rename result — range and placeholder text
 */
export interface PrepareRenameResult {
  range: { start: Position; end: Position };
  placeholder: string;
}

/**
 * Check if rename is possible at position and return the symbol range
 *
 * Returns the range of the symbol and its current name as placeholder,
 * or null if the position is not on a renameable symbol.
 */
export function prepareRename(
  document: DocumentState,
  position: Position,
  docScope: DocumentScope,
): PrepareRenameResult | null {
  const node = findNodeAtPosition(document.root, position);

  const ref = findReferenceForNode(node, docScope);
  if (ref?.resolved) {
    return {
      range: nodeToRange(node),
      placeholder: ref.name,
    };
  }

  const decl = findDeclarationForNode(node, docScope);
  if (decl) {
    return {
      range: nodeToRange(node),
      placeholder: decl.name,
    };
  }

  return null;
}

/**
 * Provide rename edits for symbol at position
 *
 * Strategy:
 * 1. Find declaration (directly or via reference resolution)
 * 2. Find all references across workspace
 * 3. Return edits for declaration + all references
 */
export function provideRename(
  document: DocumentState,
  position: Position,
  newName: string,
  docScope: DocumentScope,
  workspace?: Workspace
): RenameResult | null {
  const node = findNodeAtPosition(document.root, position);

  // Determine the target declaration
  let targetDecl: Declaration | null = null;

  const ref = findReferenceForNode(node, docScope);
  if (ref?.resolved) {
    targetDecl = ref.resolved;
  }

  if (!targetDecl) {
    targetDecl = findDeclarationForNode(node, docScope);
  }

  if (!targetDecl) {
    return null;
  }

  const changes: Record<string, RenameEdit[]> = {};

  function addEdit(uri: string, targetNode: ASTNode): void {
    const edits = changes[uri] ?? (changes[uri] = []);
    edits.push({
      range: nodeToRange(targetNode),
      newText: newName,
    });
  }

  // Collect edits from all documents
  if (workspace) {
    for (const wsDoc of workspace.getAllDocuments()) {
      const uri = wsDoc.document.uri;

      // Check declarations
      for (const decl of wsDoc.scope.declarations) {
        if (decl.name === targetDecl.name && decl.declaredBy === targetDecl.declaredBy) {
          addEdit(uri, decl.node);
        }
      }

      // Check references
      for (const r of wsDoc.scope.references) {
        if (
          r.resolved &&
          r.resolved.name === targetDecl.name &&
          r.resolved.declaredBy === targetDecl.declaredBy
        ) {
          addEdit(uri, r.node);
        }
      }
    }
  } else {
    // Single document mode
    addEdit(document.uri, targetDecl.node);

    // Add all references to this declaration
    for (const r of docScope.references) {
      if (
        r.resolved &&
        r.resolved.name === targetDecl.name &&
        r.resolved.declaredBy === targetDecl.declaredBy
      ) {
        addEdit(document.uri, r.node);
      }
    }
  }

  return { changes };
}
