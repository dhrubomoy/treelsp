import type { RuleBuilder } from './definition/grammar.js';
import type { SemanticDefinition } from './definition/semantic.js';
import type { ValidationDefinition } from './definition/validation.js';
import type { LspDefinition } from './definition/lsp.js';
import type { LanguageDefinition } from './definition/index.js';

/**
 * Define a language with grammar, semantic, validation, and LSP layers.
 * This is the main entry point for defining a treelsp language.
 *
 * The grammar functions use RuleBuilder<string> to allow forward references
 * while maintaining type safety. Rule names are inferred from grammar keys
 * and enforced in semantic, validation, and LSP layers.
 */
export function defineLanguage<
  const Grammar extends Record<string, (r: RuleBuilder<string>) => unknown>
>(
  definition: {
    name: string;
    fileExtensions: string[];
    entry: Extract<keyof Grammar, string>;
    word?: Extract<keyof Grammar, string>;
    conflicts?: (r: RuleBuilder<Extract<keyof Grammar, string>>) => unknown[][];
    grammar: Grammar;
    semantic?: SemanticDefinition<Extract<keyof Grammar, string>>;
    validation?: ValidationDefinition<Extract<keyof Grammar, string>>;
    lsp?: LspDefinition<Extract<keyof Grammar, string>>;
  }
): LanguageDefinition<Extract<keyof Grammar, string>> {
  return definition as LanguageDefinition<Extract<keyof Grammar, string>>;
}
