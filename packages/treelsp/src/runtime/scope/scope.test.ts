/**
 * Unit tests for Scope class
 */

import { describe, it, expect } from 'vitest';
import { Scope } from './scope.js';
import { ASTNode } from '../parser/node.js';

// Mock ASTNode for testing
function createMockNode(type: string, text: string): ASTNode {
  // Create a minimal mock SyntaxNode
  const mockSyntaxNode = {
    type,
    text,
    isError: false,
    hasError: false,
    isMissing: false,
    isNamed: true,
    parent: null,
    children: [],
    namedChildren: [],
    childCount: 0,
    namedChildCount: 0,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: text.length },
    startIndex: 0,
    endIndex: text.length,
    childForFieldName: () => null,
    childrenForFieldName: () => [],
    child: () => null,
    namedChild: () => null,
    descendantForIndex: function () {
      return this;
    },
    descendantForPosition: function () {
      return this;
    },
    descendantsOfType: () => [],
    toString: () => text,
  } as any;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return new ASTNode(mockSyntaxNode);
}

describe('Scope', () => {
  describe('constructor', () => {
    it('should create a global scope', () => {
      const node = createMockNode('program', 'program');
      const scope = new Scope('global', node, null);

      expect(scope.kind).toBe('global');
      expect(scope.node).toBe(node);
      expect(scope.parent).toBeNull();
    });

    it('should create a lexical scope with parent', () => {
      const globalNode = createMockNode('program', 'program');
      const blockNode = createMockNode('block', '{}');
      const globalScope = new Scope('global', globalNode, null);
      const blockScope = new Scope('lexical', blockNode, globalScope);

      expect(blockScope.kind).toBe('lexical');
      expect(blockScope.parent).toBe(globalScope);
      expect(globalScope.getChildren()).toContain(blockScope);
    });
  });

  describe('declare', () => {
    it('should add a declaration to the scope', () => {
      const scope = new Scope('global', null, null);
      const node = createMockNode('identifier', 'x');

      const decl = scope.declare('x', node, 'variable_decl', 'private');

      expect(decl.name).toBe('x');
      expect(decl.node).toBe(node);
      expect(decl.declaredBy).toBe('variable_decl');
      expect(decl.visibility).toBe('private');
    });

    it('should allow multiple declarations of same name', () => {
      const scope = new Scope('global', null, null);
      const node1 = createMockNode('identifier', 'x');
      const node2 = createMockNode('identifier', 'x');

      scope.declare('x', node1, 'variable_decl', 'private');
      scope.declare('x', node2, 'function_decl', 'private');

      const decls = scope.allDeclarations();
      expect(decls).toHaveLength(2);
    });
  });

  describe('lookupLocal', () => {
    it('should find a local declaration', () => {
      const scope = new Scope('global', null, null);
      const node = createMockNode('identifier', 'x');
      scope.declare('x', node, 'variable_decl', 'private');

      const found = scope.lookupLocal('x');
      expect(found).not.toBeNull();
      expect(found?.name).toBe('x');
    });

    it('should return null for undeclared name', () => {
      const scope = new Scope('global', null, null);
      const found = scope.lookupLocal('undefined');
      expect(found).toBeNull();
    });

    it('should filter by declaredBy', () => {
      const scope = new Scope('global', null, null);
      const node1 = createMockNode('identifier', 'x');
      const node2 = createMockNode('identifier', 'x');

      scope.declare('x', node1, 'variable_decl', 'private');
      scope.declare('x', node2, 'function_decl', 'private');

      const found = scope.lookupLocal('x', 'function_decl');
      expect(found?.declaredBy).toBe('function_decl');
    });

    it('should filter by visibility', () => {
      const scope = new Scope('global', null, null);
      const node1 = createMockNode('identifier', 'x');
      const node2 = createMockNode('identifier', 'y');

      scope.declare('x', node1, 'variable_decl', 'public');
      scope.declare('y', node2, 'variable_decl', 'private');

      const found = scope.lookupLocal('x', undefined, 'public');
      expect(found?.name).toBe('x');

      const notFound = scope.lookupLocal('y', undefined, 'public');
      expect(notFound).toBeNull();
    });
  });

  describe('lookup', () => {
    it('should find declaration in current scope', () => {
      const scope = new Scope('global', null, null);
      const node = createMockNode('identifier', 'x');
      scope.declare('x', node, 'variable_decl', 'private');

      const found = scope.lookup('x');
      expect(found?.name).toBe('x');
    });

    it('should find declaration in parent scope (lexical)', () => {
      const globalScope = new Scope('global', null, null);
      const lexicalScope = new Scope('lexical', null, globalScope);

      const node = createMockNode('identifier', 'x');
      globalScope.declare('x', node, 'variable_decl', 'private');

      const found = lexicalScope.lookup('x');
      expect(found?.name).toBe('x');
    });

    it('should not search parent for isolated scope', () => {
      const globalScope = new Scope('global', null, null);
      const isolatedScope = new Scope('isolated', null, globalScope);

      const node = createMockNode('identifier', 'x');
      globalScope.declare('x', node, 'variable_decl', 'private');

      const found = isolatedScope.lookup('x');
      expect(found).toBeNull();
    });

    it('should prefer local over parent declaration', () => {
      const globalScope = new Scope('global', null, null);
      const lexicalScope = new Scope('lexical', null, globalScope);

      const globalNode = createMockNode('identifier', 'x');
      const localNode = createMockNode('identifier', 'x');

      globalScope.declare('x', globalNode, 'variable_decl', 'private');
      lexicalScope.declare('x', localNode, 'variable_decl', 'private');

      const found = lexicalScope.lookup('x');
      expect(found?.node).toBe(localNode);
    });
  });

  describe('allDeclarations', () => {
    it('should return all declarations', () => {
      const scope = new Scope('global', null, null);
      const node1 = createMockNode('identifier', 'x');
      const node2 = createMockNode('identifier', 'y');

      scope.declare('x', node1, 'variable_decl', 'private');
      scope.declare('y', node2, 'variable_decl', 'private');

      const decls = scope.allDeclarations();
      expect(decls).toHaveLength(2);
    });

    it('should filter by visibility', () => {
      const scope = new Scope('global', null, null);
      const node1 = createMockNode('identifier', 'x');
      const node2 = createMockNode('identifier', 'y');

      scope.declare('x', node1, 'variable_decl', 'public');
      scope.declare('y', node2, 'variable_decl', 'private');

      const publicDecls = scope.allDeclarations({ visibility: 'public' });
      expect(publicDecls).toHaveLength(1);
      expect(publicDecls[0]?.name).toBe('x');
    });

    it('should filter by declaredBy', () => {
      const scope = new Scope('global', null, null);
      const node1 = createMockNode('identifier', 'x');
      const node2 = createMockNode('identifier', 'y');

      scope.declare('x', node1, 'variable_decl', 'private');
      scope.declare('y', node2, 'function_decl', 'private');

      const vars = scope.allDeclarations({ declaredBy: 'variable_decl' });
      expect(vars).toHaveLength(1);
      expect(vars[0]?.name).toBe('x');
    });
  });

  describe('isDeclared', () => {
    it('should return true for declared name', () => {
      const scope = new Scope('global', null, null);
      const node = createMockNode('identifier', 'x');
      scope.declare('x', node, 'variable_decl', 'private');

      expect(scope.isDeclared('x')).toBe(true);
    });

    it('should return false for undeclared name', () => {
      const scope = new Scope('global', null, null);
      expect(scope.isDeclared('x')).toBe(false);
    });
  });

  describe('global', () => {
    it('should return self for global scope', () => {
      const globalScope = new Scope('global', null, null);
      expect(globalScope.global()).toBe(globalScope);
    });

    it('should return root for nested scope', () => {
      const globalScope = new Scope('global', null, null);
      const lexicalScope = new Scope('lexical', null, globalScope);
      const nestedScope = new Scope('lexical', null, lexicalScope);

      expect(nestedScope.global()).toBe(globalScope);
    });
  });

  describe('descendants', () => {
    it('should return all descendant scopes', () => {
      const globalScope = new Scope('global', null, null);
      const child1 = new Scope('lexical', null, globalScope);
      const child2 = new Scope('lexical', null, globalScope);
      const grandchild = new Scope('lexical', null, child1);

      const descendants = globalScope.descendants();
      expect(descendants).toHaveLength(3);
      expect(descendants).toContain(child1);
      expect(descendants).toContain(child2);
      expect(descendants).toContain(grandchild);
    });
  });
});
