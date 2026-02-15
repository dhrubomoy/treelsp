/**
 * Reference resolver
 * Builds scope tree and resolves references to declarations
 */

import type { ASTNode } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type {
  SemanticDefinition,
  SemanticRule,
  DeclarationDescriptor,
  ScopeTarget,
  Visibility,
} from '../../definition/semantic.js';
import { Scope, type Declaration, type Reference } from './scope.js';

/**
 * Resolution context - passed to custom resolver functions
 */
export interface ResolutionContext {
  /** Look up the scope for a node */
  scopeOf(node: ASTNode): Scope | null;

  /** Resolve a module path (for cross-file resolution) */
  resolveModule(path: string): ASTNode | null;

  /** Get all references in the document */
  getReferences(): Reference[];

  /** Get all declarations in the document */
  getDeclarations(): Declaration[];
}

/**
 * Document scope state
 * Result of running the resolver on a document
 */
export interface DocumentScope {
  /** Root (global) scope */
  root: Scope;

  /** Map from AST node to its scope */
  nodeScopes: Map<ASTNode, Scope>;

  /** All references in the document */
  references: Reference[];

  /** All declarations (flattened from all scopes) */
  declarations: Declaration[];
}

/**
 * Build scope tree for a document
 *
 * V1 strategy: Full rebuild on every document change
 * - Walk AST to create scope tree
 * - Register all declarations
 * - Register all references
 * - Resolve references to declarations
 *
 * @param document The document to analyze
 * @param semantic Semantic definition from defineLanguage()
 * @returns DocumentScope with scope tree and resolution data
 */
export function buildScopes(
  document: DocumentState,
  semantic: SemanticDefinition
): DocumentScope {
  const root = document.root;

  // Map from node to its scope
  const nodeScopes = new Map<ASTNode, Scope>();

  // All references (for resolution)
  const references: Reference[] = [];

  // Context for custom resolvers
  const context: ResolutionContext = {
    scopeOf: (node) => nodeScopes.get(node) ?? null,
    resolveModule: () => null, // V1: Cross-file not yet implemented in resolver
    getReferences: () => references,
    getDeclarations: () => {
      const all: Declaration[] = [];
      for (const scope of nodeScopes.values()) {
        all.push(...scope.allDeclarations());
      }
      return all;
    },
  };

  // Create root (global) scope
  const globalScope = new Scope('global', root, null);
  nodeScopes.set(root, globalScope);

  // Walk tree to build scopes and register declarations
  walkTree(root, globalScope, semantic, nodeScopes, references, context);

  // Resolve all references
  for (const ref of references) {
    ref.resolved = resolveReference(ref, context);
  }

  // Get all declarations
  const declarations = context.getDeclarations();

  return {
    root: globalScope,
    nodeScopes,
    references,
    declarations,
  };
}

/**
 * Walk AST tree to build scopes and register declarations/references
 */
function walkTree(
  node: ASTNode,
  currentScope: Scope,
  semantic: SemanticDefinition,
  nodeScopes: Map<ASTNode, Scope>,
  references: Reference[],
  context: ResolutionContext
): void {
  const rule = semantic[node.type];

  // Check if this node creates a new scope
  let nodeScope = currentScope;
  if (rule?.scope) {
    nodeScope = new Scope(rule.scope, node, currentScope);
    nodeScopes.set(node, nodeScope);
  }

  // Process declarations and references
  if (rule) {
    processDeclarations(node, rule, nodeScope, semantic, nodeScopes, context);
    processReferences(node, rule, nodeScope, references, context);
  }

  // Recursively walk children
  for (const child of node.namedChildren) {
    walkTree(child, nodeScope, semantic, nodeScopes, references, context);
  }
}

/**
 * Process declarations for a node
 */
function processDeclarations(
  node: ASTNode,
  rule: SemanticRule,
  _scope: Scope,
  _semantic: SemanticDefinition,
  nodeScopes: Map<ASTNode, Scope>,
  context: ResolutionContext
): void {
  if (!rule.declares) {
    return;
  }

  const descriptor = rule.declares;

  // Get the name field
  const nameNode = node.field(descriptor.field);
  if (!nameNode) {
    return;
  }

  const name = nameNode.text;

  // Determine visibility
  const visibility = getVisibility(node, descriptor);

  // Determine target scope
  const targetScope = getTargetScope(node, descriptor.scope, nodeScopes);
  if (!targetScope) {
    return;
  }

  // Check if already declared (for 'if-not-declared' strategy)
  const strategy = descriptor.strategy ?? 'if-not-declared';
  if (strategy === 'if-not-declared') {
    if (targetScope.isDeclared(name)) {
      return; // Already declared, skip
    }
  }

  // Use custom resolver if provided
  if (descriptor.resolve) {
    const resolved = descriptor.resolve(
      { node, name, text: name },
      context
    );
    if (!resolved) {
      return;
    }
    // Custom resolver returns the target to declare
    // For now, we just proceed with standard declaration
  }

  // Register declaration
  targetScope.declare(name, nameNode, node.type, visibility);
}

/**
 * Process references for a node
 */
function processReferences(
  node: ASTNode,
  rule: SemanticRule,
  _scope: Scope,
  references: Reference[],
  context: ResolutionContext
): void {
  if (!rule.references) {
    return;
  }

  const descriptor = rule.references;

  // Get the name field
  const nameNode = node.field(descriptor.field);
  if (!nameNode) {
    return;
  }

  const name = nameNode.text;
  const to = Array.isArray(descriptor.to) ? descriptor.to : [descriptor.to];

  // Create reference entry
  const ref: Reference = {
    node: nameNode,
    name,
    to,
    resolved: null,
  };

  // Use custom resolver if provided
  if (descriptor.resolve) {
    const resolved = descriptor.resolve(
      { node: nameNode, name, text: name },
      context
    );
    if (resolved) {
      ref.resolved = resolved;
    }
  }

  references.push(ref);
}

/**
 * Resolve a reference to its declaration
 */
function resolveReference(
  ref: Reference,
  context: ResolutionContext
): Declaration | null {
  // If already resolved by custom resolver, return it
  if (ref.resolved) {
    return ref.resolved;
  }

  // Get the scope for this reference node
  const scope = context.scopeOf(ref.node);
  if (!scope) {
    return null;
  }

  // Look up the name in the scope chain
  const decl = scope.lookup(ref.name, ref.to);
  return decl;
}

/**
 * Get visibility for a declaration
 */
function getVisibility(
  node: ASTNode,
  descriptor: DeclarationDescriptor
): Visibility {
  if (!descriptor.visibility) {
    return 'private'; // Default
  }

  if (typeof descriptor.visibility === 'function') {
    return descriptor.visibility(node);
  }

  return descriptor.visibility;
}

/**
 * Get target scope for a declaration
 */
function getTargetScope(
  node: ASTNode,
  target: ScopeTarget,
  nodeScopes: Map<ASTNode, Scope>
): Scope | null {
  if (target === 'global') {
    // Walk up to root
    let current: ASTNode | null = node;
    while (current) {
      const scope = nodeScopes.get(current);
      if (scope?.kind === 'global') {
        return scope;
      }
      current = current.parent;
    }
    return null;
  }

  if (target === 'enclosing') {
    // Find nearest scope boundary
    let current: ASTNode | null = node.parent;
    while (current) {
      const scope = nodeScopes.get(current);
      if (scope) {
        return scope;
      }
      current = current.parent;
    }
    return null;
  }

  if (target === 'local') {
    // Immediate parent that has a scope
    let current: ASTNode | null = node.parent;
    while (current) {
      const scope = nodeScopes.get(current);
      if (scope) {
        return scope;
      }
      current = current.parent;
    }
    return null;
  }

  return null;
}
