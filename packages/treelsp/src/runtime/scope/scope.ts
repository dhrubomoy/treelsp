/**
 * Scope implementation
 * Manages declarations and provides name resolution
 */

import type { ASTNode } from '../parser/ast-node.js';
import type { ScopeKind, Visibility } from '../../definition/semantic.js';

/**
 * Declaration entry in a scope
 */
export interface Declaration {
  /** The AST node that declares this name */
  node: ASTNode;

  /** Declared name */
  name: string;

  /** Visibility (public or private) */
  visibility: Visibility;

  /** The rule type that declared this (e.g., 'variable_decl', 'function_decl') */
  declaredBy: string;
}

/**
 * Reference entry
 */
export interface Reference {
  /** The AST node that references this name */
  node: ASTNode;

  /** Referenced name */
  name: string;

  /** Expected declaration types */
  to: string[];

  /** Resolved declaration (null if unresolved) */
  resolved: Declaration | null;
}

/**
 * Scope - manages declarations and name resolution
 *
 * Supports three scope kinds:
 * - 'global': Root scope, one per document
 * - 'lexical': Standard block scope, inherits from parent
 * - 'isolated': No access to parent scope (module boundaries)
 *
 * Visibility:
 * - 'public': Visible to parent and cross-file
 * - 'private': Visible only within this scope
 */
export class Scope {
  /**
   * Scope kind
   */
  readonly kind: ScopeKind;

  /**
   * AST node that owns this scope (null for global scope)
   */
  readonly node: ASTNode | null;

  /**
   * Parent scope (null for global scope)
   */
  readonly parent: Scope | null;

  /**
   * Declarations in this scope
   * Maps name → array of declarations (for declaration merging in v2)
   */
  private declarations = new Map<string, Declaration[]>();

  /**
   * Child scopes
   */
  private children: Scope[] = [];

  constructor(kind: ScopeKind, node: ASTNode | null, parent: Scope | null) {
    this.kind = kind;
    this.node = node;
    this.parent = parent;

    // Register with parent
    if (parent) {
      parent.children.push(this);
    }
  }

  /**
   * Add a declaration to this scope
   *
   * V1: Single declarations per name (declaration merging in v2)
   * If name already exists, adds to array (for future merging support)
   */
  declare(name: string, node: ASTNode, declaredBy: string, visibility: Visibility): Declaration {
    const decl: Declaration = {
      node,
      name,
      visibility,
      declaredBy,
    };

    const existing = this.declarations.get(name);
    if (existing) {
      existing.push(decl);
    } else {
      this.declarations.set(name, [decl]);
    }

    return decl;
  }

  /**
   * Look up a name in this scope only (does not search parent)
   *
   * @param name Name to look up
   * @param declaredBy Optional filter by declaration type(s)
   * @param visibility Optional filter by visibility
   * @returns First matching declaration or null
   */
  lookupLocal(
    name: string,
    declaredBy?: string | string[],
    visibility?: Visibility
  ): Declaration | null {
    const declarations = this.declarations.get(name);
    if (!declarations) {
      return null;
    }

    // Filter by declaredBy
    let filtered = declarations;
    if (declaredBy) {
      const types = Array.isArray(declaredBy) ? declaredBy : [declaredBy];
      filtered = declarations.filter(d => types.includes(d.declaredBy));
    }

    // Filter by visibility
    if (visibility) {
      filtered = filtered.filter(d => d.visibility === visibility);
    }

    // V1: Return first match (declaration merging in v2)
    return filtered[0] ?? null;
  }

  /**
   * Look up a name in this scope and parent scopes
   *
   * Respects scope kinds:
   * - 'global': No parent to search
   * - 'lexical': Searches parent recursively
   * - 'isolated': Does not search parent
   *
   * @param name Name to look up
   * @param declaredBy Optional filter by declaration type(s)
   * @returns First matching declaration or null
   */
  lookup(name: string, declaredBy?: string | string[]): Declaration | null {
    // Try local first
    const local = this.lookupLocal(name, declaredBy);
    if (local) {
      return local;
    }

    // If isolated scope, don't search parent
    if (this.kind === 'isolated') {
      return null;
    }

    // Search parent
    if (this.parent) {
      return this.parent.lookup(name, declaredBy);
    }

    return null;
  }

  /**
   * Get all declarations in this scope
   *
   * @param options Filtering options
   * @returns Array of declarations
   */
  allDeclarations(options?: {
    visibility?: Visibility;
    declaredBy?: string | string[];
  }): Declaration[] {
    const all: Declaration[] = [];

    for (const declarations of this.declarations.values()) {
      all.push(...declarations);
    }

    // Filter
    let filtered = all;

    if (options?.visibility) {
      filtered = filtered.filter(d => d.visibility === options.visibility);
    }

    if (options?.declaredBy) {
      const types = Array.isArray(options.declaredBy)
        ? options.declaredBy
        : [options.declaredBy];
      filtered = filtered.filter(d => types.includes(d.declaredBy));
    }

    return filtered;
  }

  /**
   * Check if a name is declared in this scope (local only)
   */
  isDeclared(name: string, declaredBy?: string | string[]): boolean {
    return this.lookupLocal(name, declaredBy) !== null;
  }

  /**
   * Get the global scope (root of scope tree)
   */
  global(): Scope {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let scope: Scope = this;
    while (scope.parent) {
      scope = scope.parent;
    }
    return scope;
  }

  /**
   * Get all child scopes
   */
  getChildren(): Scope[] {
    return [...this.children];
  }

  /**
   * Get all descendant scopes (recursive)
   */
  descendants(): Scope[] {
    const result: Scope[] = [];
    for (const child of this.children) {
      result.push(child);
      result.push(...child.descendants());
    }
    return result;
  }

  /**
   * Debug string representation
   */
  toString(): string {
    const nodeType = this.node?.type ?? 'document';
    const declCount = Array.from(this.declarations.values()).flat().length;
    return `Scope(${this.kind}, ${nodeType}, ${declCount} decls)`;
  }
}
