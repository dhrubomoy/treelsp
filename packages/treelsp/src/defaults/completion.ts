/**
 * Default completion implementation
 * Provides scope-based and keyword completions
 */

import type { CompletionItem, LspContext } from '../definition/lsp.js';

/**
 * Default completion handler
 * Returns scope-based completions + keyword completions
 */
export function complete(node: any, ctx: LspContext): CompletionItem[] {
  return [
    ...scopeCompletions(node, ctx),
    ...keywordCompletions(ctx),
  ];
}

/**
 * Get keyword completions from grammar
 */
export function keywordCompletions(_ctx: LspContext): CompletionItem[] {
  // Delegate to runtime — defaults don't have access to LSP config directly
  // This is a fallback; the runtime completion handler provides keyword completions
  return [];
}

/**
 * Get scope-based completions
 */
export function scopeCompletions(node: any, ctx: LspContext): CompletionItem[] {
  const scope = ctx.scopeOf(node);
  if (!scope) {
    return [];
  }

  const items: CompletionItem[] = [];
  const declarations = scope.allDeclarations?.() ?? [];

  for (const decl of declarations) {
    items.push({
      label: decl.name as string,
      detail: decl.declaredBy as string,
    });
  }

  return items;
}
