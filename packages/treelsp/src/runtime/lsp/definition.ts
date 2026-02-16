/**
 * Go-to-definition provider
 * Fully automatic from semantic layer
 */

import type { Position } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { Workspace } from '../scope/workspace.js';
import {
  findNodeAtPosition,
  findReferenceForNode,
  nodeToRange,
} from './context.js';

/**
 * Definition result
 */
export interface DefinitionResult {
  uri: string;
  range: { start: Position; end: Position };
}

/**
 * Provide definition location for a reference
 *
 * Fully automatic: find reference at position → return declaration location
 */
export function provideDefinition(
  document: DocumentState,
  position: Position,
  docScope: DocumentScope,
  workspace?: Workspace
): DefinitionResult | null {
  const node = findNodeAtPosition(document.root, position);

  // Find the reference at this position
  const ref = findReferenceForNode(node, docScope);
  if (!ref?.resolved) {
    return null;
  }

  // Find the URI of the document that owns the declaration
  let uri = document.uri;
  if (workspace) {
    for (const wsDoc of workspace.getAllDocuments()) {
      const match = wsDoc.scope.declarations.some(
        d => d.node.id === ref.resolved!.node.id
      );
      if (match) {
        uri = wsDoc.document.uri;
        break;
      }
    }
  }

  return {
    uri,
    range: nodeToRange(ref.resolved.node),
  };
}
