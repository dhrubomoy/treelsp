/**
 * Semantic definition layer
 * Describes declarations, references, and scopes
 */

/**
 * Scope kinds
 */
export type ScopeKind = 'global' | 'lexical' | 'isolated';

/**
 * Scope target for declarations
 */
export type ScopeTarget = 'local' | 'enclosing' | 'global';

/**
 * Visibility of declarations
 */
export type Visibility = 'public' | 'private';

/**
 * Strategy for declare + reference on same node
 */
export type DeclareStrategy = 'if-not-declared' | 'always';

/**
 * Order for declare + reference on same node
 */
export type DeclareOrder = 'after-references' | 'before-references';

/**
 * Policy for unresolved references
 */
export type UnresolvedPolicy = 'error' | 'warning' | 'ignore';

/**
 * Declaration descriptor
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
 * Reference descriptor
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
 * Semantic rule definition
 */
export interface SemanticRule {
  declares?: DeclarationDescriptor;
  references?: ReferenceDescriptor;
  scope?: ScopeKind;
}

/**
 * Semantic definition - maps rule names to semantic descriptors
 */
export type SemanticDefinition<T extends string = string> = {
  [K in T]?: SemanticRule;
};
