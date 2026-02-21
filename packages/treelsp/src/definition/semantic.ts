/**
 * Semantic definition layer
 * Describes declarations, references, and scopes
 */

/**
 * Scope kinds control how names are visible within a scope.
 *
 * - `'global'` — Names are visible everywhere (top-level module scope)
 * - `'lexical'` — Names are visible in this scope and nested scopes (function/block scope)
 * - `'isolated'` — Names are NOT visible to nested scopes (class body scope)
 */
export type ScopeKind = 'global' | 'lexical' | 'isolated';

/**
 * Where a declaration is registered in the scope tree.
 *
 * - `'local'` — Declared in the current scope (e.g., local variables)
 * - `'enclosing'` — Declared in the parent scope (e.g., function names visible outside their body)
 * - `'global'` — Declared at the top-level scope regardless of nesting
 */
export type ScopeTarget = 'local' | 'enclosing' | 'global';

/**
 * Visibility of declarations for cross-file resolution.
 *
 * - `'public'` — Visible to other files via workspace lookup
 * - `'private'` — Only visible within the declaring file
 */
export type Visibility = 'public' | 'private';

/**
 * Strategy when a rule both declares and references the same name.
 *
 * - `'if-not-declared'` — Only declare if no existing declaration is found (default)
 * - `'always'` — Always create a new declaration, shadowing any existing one
 */
export type DeclareStrategy = 'if-not-declared' | 'always';

/**
 * Order of operations when a rule both declares and references.
 *
 * - `'after-references'` — Process references first, then declare (default)
 * - `'before-references'` — Declare first, then process references
 */
export type DeclareOrder = 'after-references' | 'before-references';

/**
 * What to do when a reference cannot be resolved to a declaration.
 *
 * - `'error'` — Report a diagnostic error (default)
 * - `'warning'` — Report a diagnostic warning
 * - `'ignore'` — Silently skip unresolved references
 */
export type UnresolvedPolicy = 'error' | 'warning' | 'ignore';

/**
 * Describes how a grammar rule declares a name in scope.
 *
 * @example
 * ```ts
 * semantic: {
 *   variable_decl: {
 *     declares: { field: 'name', scope: 'local' },
 *   },
 *   function_def: {
 *     declares: { field: 'name', scope: 'enclosing', visibility: 'public' },
 *   },
 * }
 * ```
 */
export interface DeclarationDescriptor {
  /** Which field holds the declared name */
  field: string;

  /** Where to declare it */
  scope: ScopeTarget;

  /** Visibility (optional) */
  visibility?: Visibility | ((node: any) => Visibility);

  /** Strategy when both declaring and referencing (optional) */
  strategy?: DeclareStrategy;

  /** Order when both declaring and referencing (optional) */
  order?: DeclareOrder;

  /** Custom resolver (optional) */
  resolve?: (decl: any, ctx: any) => any;
}

/**
 * Describes how a grammar rule references a previously declared name.
 *
 * @example
 * ```ts
 * semantic: {
 *   identifier_ref: {
 *     references: { field: 'name', to: 'variable_decl' },
 *   },
 *   type_ref: {
 *     references: { field: 'name', to: ['class_def', 'type_alias'], onUnresolved: 'warning' },
 *   },
 * }
 * ```
 */
export interface ReferenceDescriptor {
  /** Which field holds the referenced name */
  field: string;

  /** Target declaration rule(s) */
  to: string | string[];

  /** Policy for unresolved references (default: 'error') */
  onUnresolved?: UnresolvedPolicy;

  /** Optional reference - ok if not resolved (for Python-style implicit declaration) */
  optional?: boolean;

  /** Custom resolver (optional) */
  resolve?: (ref: any, ctx: any) => any;
}

/**
 * Scope descriptor
 */
export interface ScopeDescriptor {
  scope: ScopeKind;
}

/**
 * Semantic behavior for a single grammar rule.
 * A rule can declare names, reference names, and/or open a new scope.
 */
export interface SemanticRule {
  declares?: DeclarationDescriptor;
  references?: ReferenceDescriptor;
  scope?: ScopeKind;
}

/**
 * Maps grammar rule names to their semantic behavior (declarations, references, scopes).
 * Only rules that participate in name resolution need entries here.
 */
export type SemanticDefinition<T extends string = string> = {
  [K in T]?: SemanticRule;
};
