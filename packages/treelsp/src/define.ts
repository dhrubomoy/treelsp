import type { RuleBuilder } from './definition/grammar.js';
import type { SemanticDefinition } from './definition/semantic.js';
import type { ValidationDefinition } from './definition/validation.js';
import type { LspDefinition } from './definition/lsp.js';
import type { LanguageDefinition } from './definition/index.js';

/**
 * Define a language with grammar, semantic, validation, and LSP layers.
 *
 * This is the main entry point for creating a treelsp language. Returns a
 * `LanguageDefinition` that can be passed to the CLI (`treelsp generate` /
 * `treelsp build`) to produce a parser and LSP server.
 *
 * @param definition.name - Language display name (e.g., `"MiniLang"`)
 * @param definition.fileExtensions - File extensions to associate (e.g., `[".mini"]`)
 * @param definition.entry - Name of the top-level grammar rule
 * @param definition.word - Token rule for keyword extraction; prevents keywords from matching as identifiers
 * @param definition.conflicts - GLR conflict declarations for ambiguous grammars
 * @param definition.extras - Tokens that can appear anywhere (whitespace, comments)
 * @param definition.externals - External scanner tokens (e.g., indent/dedent for Python-style languages)
 * @param definition.grammar - Grammar rules: maps rule names to builder functions
 * @param definition.semantic - Declarations, references, and scopes for name resolution
 * @param definition.validation - Custom diagnostic validators per rule
 * @param definition.lsp - Editor features: hover, completion, symbols, signature help
 *
 * @example
 * ```ts
 * export default defineLanguage({
 *   name: 'MiniLang',
 *   fileExtensions: ['.mini'],
 *   entry: 'program',
 *   word: 'identifier',
 *   grammar: {
 *     program: r => r.repeat(r.rule('statement')),
 *     statement: r => r.choice(r.rule('variable_decl')),
 *     variable_decl: r => r.seq('let', r.field('name', r.rule('identifier')), '=', r.field('value', r.rule('expression')), ';'),
 *     expression: r => r.choice(r.rule('identifier'), r.rule('number')),
 *     identifier: r => r.token(/[a-zA-Z_]\w{@literal *}/),
 *     number: r => r.token(/[0-9]+/),
 *   },
 * });
 * ```
 */
export function defineLanguage<
  const Grammar extends Record<string, (r: RuleBuilder<string>) => unknown>
>(
  definition: {
    name: string;
    fileExtensions: string[];
    entry: Extract<keyof Grammar, string>;
    word?: Extract<keyof Grammar, string>;
    conflicts?: (r: RuleBuilder<string>) => unknown[][];
    extras?: (r: RuleBuilder<string>) => unknown[];
    externals?: (r: RuleBuilder<string>) => unknown[];
    grammar: Grammar;
    semantic?: SemanticDefinition<Extract<keyof Grammar, string>>;
    validation?: ValidationDefinition<Extract<keyof Grammar, string>>;
    lsp?: LspDefinition<Extract<keyof Grammar, string>>;
  }
): LanguageDefinition<Extract<keyof Grammar, string>> {
  return definition as LanguageDefinition<Extract<keyof Grammar, string>>;
}
