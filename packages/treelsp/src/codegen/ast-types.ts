/**
 * AST types codegen
 * Generates typed AST node interfaces from grammar definition
 */

import type { LanguageDefinition } from '../definition/index.js';

/**
 * Generate TypeScript AST type definitions
 */
export function generateAstTypes<T extends string>(
  definition: LanguageDefinition<T>
): string {
  // TODO: Implement AST types codegen
  return '';
}
