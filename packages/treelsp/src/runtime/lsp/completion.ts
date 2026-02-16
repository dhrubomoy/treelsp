/**
 * Completion provider
 * Scope-based + keyword + custom completions
 */

import type { Position } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { Workspace } from '../scope/workspace.js';
import type { SemanticDefinition } from '../../definition/semantic.js';
import type { LspDefinition, LspContext, CompletionItem, CompletionKind } from '../../definition/lsp.js';
import type { ASTNode } from '../parser/node.js';
import { createLspContext, findNodeAtPosition, findScopeForNode } from './context.js';

/**
 * LSP CompletionItemKind mapping
 */
const COMPLETION_KIND_MAP: Record<CompletionKind, number> = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  Constant: 21,
};

// Re-export for external use
export { COMPLETION_KIND_MAP };

/**
 * Provide completions at position
 *
 * Sources:
 * 1. Scope-based: all declarations visible from current scope
 * 2. Keywords: from $keywords config
 * 3. Custom: from per-rule complete() handlers
 */
export function provideCompletion(
  document: DocumentState,
  position: Position,
  docScope: DocumentScope,
  semantic: SemanticDefinition,
  lsp?: LspDefinition,
  workspace?: Workspace
): CompletionItem[] {
  const node = findNodeAtPosition(document.root, position);

  const ctx = createLspContext(
    docScope,
    workspace ?? ({} as Workspace),
    document,
    semantic
  );

  // 1. Scope-based completions (local + workspace public)
  const scopeItems = getScopeCompletions(node, docScope, lsp, workspace);

  // 2. Keyword completions
  const keywordItems = getKeywordCompletions(lsp);

  // 3. Custom completions
  const customResult = getCustomCompletions(node, ctx, lsp);

  if (customResult?.replace) {
    return customResult.items;
  }

  // Merge all sources
  const allItems = [...scopeItems, ...keywordItems];
  if (customResult) {
    allItems.push(...customResult.items);
  }

  return deduplicateCompletions(allItems);
}

/**
 * Get completions from all declarations visible in scope
 */
function getScopeCompletions(
  node: ASTNode,
  docScope: DocumentScope,
  lsp?: LspDefinition,
  workspace?: Workspace
): CompletionItem[] {
  const scope = findScopeForNode(node, docScope);
  const items: CompletionItem[] = [];
  const seen = new Set<string>();

  // Collect declarations from scope chain
  let currentScope: typeof scope | null = scope;
  while (currentScope) {
    for (const decl of currentScope.allDeclarations()) {
      if (seen.has(decl.name)) {
        continue;
      }
      seen.add(decl.name);

      const lspRule = lsp?.[decl.declaredBy];
      const kind = lspRule?.completionKind;

      const item: CompletionItem = {
        label: decl.name,
        detail: decl.declaredBy,
      };
      if (kind) {
        item.kind = kind;
      }
      items.push(item);
    }

    // Walk up scope chain (respecting isolation)
    if (currentScope.kind === 'isolated') {
      break;
    }
    currentScope = currentScope.parent;
  }

  // Include public declarations from other files
  if (workspace) {
    for (const decl of workspace.getAllPublicDeclarations()) {
      if (seen.has(decl.name)) {
        continue;
      }
      seen.add(decl.name);

      const lspRule = lsp?.[decl.declaredBy];
      const kind = lspRule?.completionKind;

      const item: CompletionItem = {
        label: decl.name,
        detail: decl.declaredBy,
      };
      if (kind) {
        item.kind = kind;
      }
      items.push(item);
    }
  }

  return items;
}

/**
 * Get keyword completions from $keywords config
 */
function getKeywordCompletions(lsp?: LspDefinition): CompletionItem[] {
  const keywords = lsp?.$keywords;
  if (!keywords) {
    return [];
  }

  return Object.entries(keywords).map(([keyword, descriptor]) => {
    const item: CompletionItem = {
      label: keyword,
      kind: 'Keyword' as CompletionKind,
    };
    if (descriptor.detail) {
      item.detail = descriptor.detail;
    }
    if (descriptor.documentation) {
      item.documentation = descriptor.documentation;
    }
    return item;
  });
}

/**
 * Get custom completions from per-rule complete() handler
 */
function getCustomCompletions(
  node: ASTNode,
  ctx: LspContext,
  lsp?: LspDefinition
): { items: CompletionItem[]; replace?: boolean } | null {
  if (!lsp) {
    return null;
  }

  // Find applicable handler by walking up the node tree
  let current: ASTNode | null = node;
  while (current) {
    const handler = lsp[current.type]?.complete;
    if (handler) {
      const result = handler(current, ctx);
      if (Array.isArray(result)) {
        return { items: result };
      }
      return result;
    }
    current = current.parent;
  }

  return null;
}

/**
 * Remove duplicate completion items (by label)
 */
function deduplicateCompletions(items: CompletionItem[]): CompletionItem[] {
  const seen = new Set<string>();
  const result: CompletionItem[] = [];

  for (const item of items) {
    if (!seen.has(item.label)) {
      seen.add(item.label);
      result.push(item);
    }
  }

  return result;
}
