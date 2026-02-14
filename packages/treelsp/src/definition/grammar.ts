/**
 * Grammar definition layer
 * Provides type-safe builder API that maps 1:1 to Tree-sitter grammar primitives
 */

export type RuleDefinition<T extends string = string> =
  | string
  | RegExp
  | RuleBuilder<T>
  | RuleFn<T>;

export type RuleFn<T extends string = string> = (builder: RuleBuilder<T>) => RuleDefinition<T>;

/**
 * Grammar definition - maps rule names to rule functions
 */
export type GrammarDefinition<T extends string = string> = {
  [K in T]: RuleFn<T>;
};

/**
 * Rule builder - provides Tree-sitter grammar primitives
 * Method names match Tree-sitter exactly for familiarity
 */
export interface RuleBuilder<T extends string = string> {
  // Combinators
  seq(...rules: RuleDefinition<T>[]): RuleDefinition<T>;
  choice(...rules: RuleDefinition<T>[]): RuleDefinition<T>;
  optional(rule: RuleDefinition<T>): RuleDefinition<T>;
  repeat(rule: RuleDefinition<T>): RuleDefinition<T>;
  repeat1(rule: RuleDefinition<T>): RuleDefinition<T>;

  // Named fields
  field(name: string, rule: RuleDefinition<T>): RuleDefinition<T>;

  // Precedence
  prec: {
    (level: number, rule: RuleDefinition<T>): RuleDefinition<T>;
    left(level: number, rule: RuleDefinition<T>): RuleDefinition<T>;
    right(level: number, rule: RuleDefinition<T>): RuleDefinition<T>;
    dynamic(level: number, rule: RuleDefinition<T>): RuleDefinition<T>;
  };

  // Tokens
  token: {
    (pattern: string | RegExp): RuleDefinition<T>;
    immediate(rule: RuleDefinition<T>): RuleDefinition<T>;
  };

  // Aliasing
  alias(rule: RuleDefinition<T>, name: string): RuleDefinition<T>;

  // Rule references - type-safe forward references
  rule(name: T): RuleDefinition<T>;
}
