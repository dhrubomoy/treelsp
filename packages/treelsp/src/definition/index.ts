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
 * Complete language definition — the output of `defineLanguage()`.
 *
 * Contains four layers:
 * 1. **Grammar** — Parsing rules that define the language syntax
 * 2. **Semantic** — Name resolution (declarations, references, scopes)
 * 3. **Validation** — Custom diagnostics per grammar rule
 * 4. **LSP** — Editor features (hover, completion, outline, signature help)
 *
 * Only `grammar` is required. The other layers are optional and build on top
 * of the grammar to provide progressively richer editor support.
 */
export interface LanguageDefinition<T extends string = string> {
  /** Language display name (e.g., `"MiniLang"`) — used in LSP and generated artifacts */
  name: string;

  /** File extensions to associate with this language (e.g., `[".mini"]`) */
  fileExtensions: string[];

  /** Name of the top-level grammar rule (the parser starts here) */
  entry: T;

  /**
   * Token rule used for keyword extraction. When set, string literals in the
   * grammar (like `"let"`, `"if"`) are treated as keywords and won't match
   * as identifiers. Should point to your identifier token rule.
   */
  word?: T;

  /**
   * GLR conflict declarations for ambiguous grammars. Use when the parser
   * cannot decide between two rules without lookahead.
   *
   * @example
   * ```ts
   * conflicts: r => [[r.expression, r.type_expression]],
   * ```
   */
  conflicts?: (r: any) => any[][];

  /**
   * Tokens that can appear anywhere in the input (typically whitespace and comments).
   * Defaults to `[/\s/]` if not specified.
   *
   * @example
   * ```ts
   * extras: r => [/\s/, r.comment],
   * ```
   */
  extras?: (r: any) => any[];

  /**
   * External scanner tokens for context-sensitive lexing (e.g., indent/dedent
   * for Python-style languages). These tokens are provided by a custom scanner
   * rather than the generated lexer.
   */
  externals?: (r: any) => any[];

  /** Grammar layer — maps rule names to builder functions that define the syntax */
  grammar: GrammarDefinition<T>;

  /** Semantic layer — declarations, references, and scopes for name resolution */
  semantic?: SemanticDefinition<T>;

  /** Validation layer — custom diagnostic validators per grammar rule */
  validation?: ValidationDefinition<T>;

  /** LSP layer — editor features: hover, completion, symbols, signature help */
  lsp?: LspDefinition<T>;
}
