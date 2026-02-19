/**
 * Signature help provider
 * Shows parameter information for function calls
 */

import type { ASTNode, Position } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { Workspace } from '../scope/workspace.js';
import type { LspDefinition } from '../../definition/lsp.js';
import { findReferenceForNode } from './context.js';

/**
 * Signature help result
 */
export interface SignatureHelpResult {
  signatures: Array<{
    label: string;
    parameters: Array<{
      label: string;
      documentation?: string;
    }>;
  }>;
  activeSignature: number;
  activeParameter: number;
}

/**
 * Collect trigger characters from all signature descriptors in the LSP config
 */
export function getSignatureTriggerCharacters(lsp?: LspDefinition): string[] {
  if (!lsp) return [];
  const triggers = new Set<string>();
  const rules = lsp as Record<string, { signature?: { trigger: string[] } } | undefined>;
  for (const [key, rule] of Object.entries(rules)) {
    if (key.startsWith('$')) continue;
    if (rule?.signature) {
      for (const ch of rule.signature.trigger) {
        triggers.add(ch);
      }
    }
  }
  return [...triggers];
}

/**
 * Provide signature help at position
 *
 * Strategy:
 * 1. Walk up from cursor to find an ancestor containing a reference
 *    that resolves to a declaration with a signature descriptor
 * 2. Count commas before cursor position = argument index
 * 3. Call the signature descriptor functions with the declaration node
 */
export function provideSignatureHelp(
  document: DocumentState,
  position: Position,
  docScope: DocumentScope,
  lsp?: LspDefinition,
  _workspace?: Workspace
): SignatureHelpResult | null {
  if (!lsp) return null;

  const node = document.root.descendantForPosition(position);

  // Walk up the AST looking for a call context
  let current: ASTNode | null = node;
  while (current) {
    // Check children of this node for references to declarations with signatures
    for (const child of current.children) {
      const ref = findReferenceForNode(child, docScope);
      if (!ref?.resolved) continue;

      const declType = ref.resolved.declaredBy;
      const lspRule = lsp[declType];
      if (!lspRule?.signature) continue;

      const sig = lspRule.signature;

      // Get the full declaration node (ref.resolved.node is the name node)
      const declNode = ref.resolved.node.parent;
      if (!declNode) continue;

      // Count commas before cursor position to determine active parameter.
      // Commas may be direct children of `current` (flat grammar) or inside
      // a wrapper node like `argument_list` (nested grammar). Pick the
      // children list that actually contains comma tokens.
      let commaSource = current.children;
      const hasDirectComma = commaSource.some(c => !c.isNamed && c.text === ',');
      if (!hasDirectComma) {
        // Commas may be inside a wrapper child (e.g., argument_list).
        // Find the named child that contains comma tokens.
        for (const ch of current.children) {
          if (!ch.isNamed) continue;
          if (ch.children.some(gc => !gc.isNamed && gc.text === ',')) {
            commaSource = ch.children;
            break;
          }
        }
      }

      let commaCount = 0;
      for (const sibling of commaSource) {
        // Stop counting at cursor position
        if (sibling.startPosition.line > position.line ||
          (sibling.startPosition.line === position.line &&
            sibling.startPosition.character >= position.character)) {
          break;
        }
        if (!sibling.isNamed && sibling.text === ',') {
          commaCount++;
        }
      }

      const label = typeof sig.label === 'function' ? sig.label(declNode) : sig.label;
      const params = sig.params(declNode);
      const activeParam = sig.activeParam(declNode, commaCount);

      return {
        signatures: [{
          label,
          parameters: params,
        }],
        activeSignature: 0,
        activeParameter: activeParam,
      };
    }

    current = current.parent;
  }

  return null;
}
