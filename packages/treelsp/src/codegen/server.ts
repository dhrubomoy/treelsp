/**
 * LSP server codegen
 * Generates LSP server entry point from language definition
 */

import type { LanguageDefinition } from '../definition/index.js';

/**
 * Generate LSP server entry point
 */
export function generateServer<T extends string>(
  definition: LanguageDefinition<T>
): string {
  // TODO: Implement server codegen
  return '';
}
