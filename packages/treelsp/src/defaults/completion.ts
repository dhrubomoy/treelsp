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
  // TODO: Implement in runtime
  return [];
}

/**
 * Get keyword completions from grammar
 */
export function keywordCompletions(ctx: LspContext): CompletionItem[] {
  // TODO: Implement in runtime
  return [];
}

/**
 * Get scope-based completions
 */
export function scopeCompletions(node: any, ctx: LspContext): CompletionItem[] {
  // TODO: Implement in runtime
  return [];
}
