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

/**
 * Rule builder extended with direct rule name access.
 * Enables `r.identifier` as an alternative to `r.rule('identifier')`.
 * Builder method names are excluded to avoid intersection conflicts.
 */
export type RuleBuilderWithRefs<T extends string> = RuleBuilder<T> & {
  readonly [K in Exclude<T, keyof RuleBuilder<T>>]: RuleDefinition<T>;
};

/**
 * Wrap a builder object in a Proxy that treats unknown property access as rule references.
 * Known builder methods/properties take priority; unknown string properties return `{ type: 'rule', name }`.
 * Also stores the proxy reference on `builder._proxy` for use in `normalize()`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBuilderProxy<T extends string>(builder: any): RuleBuilder<T> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const proxy = new Proxy(builder, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(target: any, prop: string | symbol, receiver: unknown): unknown {
      if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
      if (prop in target) return Reflect.get(target, prop, receiver);
      return { type: 'rule', name: prop };
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  builder._proxy = proxy as RuleBuilder<T>;
  return proxy as RuleBuilder<T>;
}
