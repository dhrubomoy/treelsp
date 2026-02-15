/**
 * Go-to-definition provider
 * Fully automatic from semantic layer
 */

import type { Position } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type { DocumentScope } from '../scope/resolver.js';
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
  docScope: DocumentScope
): DefinitionResult | null {
  const node = findNodeAtPosition(document.root, position);

  // Find the reference at this position
  const ref = findReferenceForNode(node, docScope);
  if (!ref?.resolved) {
    return null;
  }

  return {
    uri: document.uri, // V1: same document only
    range: nodeToRange(ref.resolved.node),
  };
}
