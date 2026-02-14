/**
 * Grammar codegen
 * Emits grammar.js for Tree-sitter from language definition
 */

import type { LanguageDefinition } from '../definition/index.js';

/**
 * Generate Tree-sitter grammar.js from language definition
 */
export function generateGrammar<T extends string>(
  definition: LanguageDefinition<T>
): string {
  // TODO: Implement grammar codegen
  return '';
}
