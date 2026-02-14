import type { LanguageDefinition } from './definition/index.js';

/**
 * Define a language with grammar, semantic, validation, and LSP layers.
 * This is the main entry point for defining a treelsp language.
 */
export function defineLanguage<T extends string>(
  definition: LanguageDefinition<T>
): LanguageDefinition<T> {
  return definition;
}
