/**
 * Find references provider
 * Fully automatic from semantic layer
 */

import type { Position } from '../parser/ast-node.js';
import type { DocumentState } from '../parser/document-state.js';
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
 * Reference location
 */
export interface ReferenceLocation {
  uri: string;
  range: { start: Position; end: Position };
}

/**
 * Find all references to the symbol at position
 *
 * Strategy:
 * 1. Find node at position
 * 2. If reference → resolve to declaration
 * 3. If declaration → use directly
 * 4. Scan all documents in workspace for references to that declaration
 */
export function provideReferences(
  document: DocumentState,
  position: Position,
  docScope: DocumentScope,
  workspace?: Workspace
): ReferenceLocation[] {
  const node = findNodeAtPosition(document.root, position);

  // Determine the target declaration
  let targetDecl: Declaration | null = null;

  // Check if it's a reference
  const ref = findReferenceForNode(node, docScope);
  if (ref?.resolved) {
    targetDecl = ref.resolved;
  }

  // Check if it's a declaration
  if (!targetDecl) {
    targetDecl = findDeclarationForNode(node, docScope);
  }

  if (!targetDecl) {
    return [];
  }

  const locations: ReferenceLocation[] = [];

  // Collect from all documents in workspace
  if (workspace) {
    for (const wsDoc of workspace.getAllDocuments()) {
      collectReferencesInDocument(
        wsDoc.document.uri,
        wsDoc.scope,
        targetDecl,
        locations
      );
    }
  } else {
    // Single document mode
    collectReferencesInDocument(document.uri, docScope, targetDecl, locations);
  }

  return locations;
}

/**
 * Collect all references to a declaration within a single document
 */
function collectReferencesInDocument(
  uri: string,
  docScope: DocumentScope,
  targetDecl: Declaration,
  locations: ReferenceLocation[]
): void {
  for (const ref of docScope.references) {
    if (!ref.resolved) {
      continue;
    }

    // Match by name and declaredBy (since Declaration identity may differ across documents)
    if (
      ref.resolved.name === targetDecl.name &&
      ref.resolved.declaredBy === targetDecl.declaredBy
    ) {
      locations.push({
        uri,
        range: nodeToRange(ref.node),
      });
    }
  }
}
