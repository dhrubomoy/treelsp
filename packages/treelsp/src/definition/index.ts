// Public API for definition layer

export * from './grammar.js';
export * from './semantic.js';
export * from './validation.js';
export * from './lsp.js';

import type { GrammarDefinition } from './grammar.js';
import type { SemanticDefinition } from './semantic.js';
import type { ValidationDefinition } from './validation.js';
import type { LspDefinition } from './lsp.js';

/**
 * Complete language definition
 */
export interface LanguageDefinition<T extends string = string> {
  /** Language name */
  name: string;

  /** File extensions (e.g., ['.mylang']) */
  fileExtensions: string[];

  /** Entry rule name */
  entry: T;

  /** Word token for keyword extraction (prevents keywords matching as identifiers) */
  word?: T;

  /** Explicit GLR conflict declarations */
  conflicts?: (r: any) => any[][];

  /** Extra tokens that can appear anywhere (e.g., whitespace, comments) */
  extras?: (r: any) => any[];

  /** External scanner token names (e.g., indent/dedent for Python-style languages) */
  externals?: (r: any) => any[];

  /** Grammar layer - rule definitions */
  grammar: GrammarDefinition<T>;

  /** Semantic layer - declarations, references, scopes (optional) */
  semantic?: SemanticDefinition<T>;

  /** Validation layer - custom validators (optional) */
  validation?: ValidationDefinition<T>;

  /** LSP layer - hover, completion, symbols (optional) */
  lsp?: LspDefinition<T>;
}
