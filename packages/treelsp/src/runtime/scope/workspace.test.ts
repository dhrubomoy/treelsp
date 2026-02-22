/**
 * Unit tests for Workspace — smart cross-file rescoping
 */

import { describe, it, expect } from 'vitest';
import { Workspace } from './workspace.js';
import { TreeSitterASTNode } from '../parser/tree-sitter/node.js';
import type { ASTNode } from '../parser/ast-node.js';
import type { DocumentState } from '../parser/document-state.js';
import type { SemanticDefinition } from '../../definition/semantic.js';

// ---------------------------------------------------------------------------
// Mock helpers — build mock SyntaxNodes that TreeSitterASTNode can wrap
// ---------------------------------------------------------------------------

let nextId = 100;

interface MockSyntaxNode {
  type: string;
  text: string;
  id: number;
  isError: boolean;
  hasError: boolean;
  isMissing: boolean;
  isNamed: boolean;
  parent: MockSyntaxNode | null;
  children: MockSyntaxNode[];
  namedChildren: MockSyntaxNode[];
  childCount: number;
  namedChildCount: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  childForFieldName: (name: string) => MockSyntaxNode | null;
  childrenForFieldName: (name: string) => MockSyntaxNode[];
  child: (index: number) => MockSyntaxNode | null;
  namedChild: (index: number) => MockSyntaxNode | null;
  descendantForIndex: (start: number, end?: number) => MockSyntaxNode;
  descendantForPosition: (start: any, end?: any) => MockSyntaxNode;
  descendantsOfType: (type: string) => MockSyntaxNode[];
  toString: () => string;
}

function makeSyntaxNode(
  type: string,
  text: string,
  opts?: {
    namedChildren?: MockSyntaxNode[];
    fieldMap?: Record<string, MockSyntaxNode>;
  },
): MockSyntaxNode {
  const id = nextId++;
  const children = opts?.namedChildren ?? [];
  const fieldMap = opts?.fieldMap ?? {};

  const node: MockSyntaxNode = {
    type,
    text,
    id,
    isError: false,
    hasError: false,
    isMissing: false,
    isNamed: true,
    parent: null,
    children,
    namedChildren: children,
    childCount: children.length,
    namedChildCount: children.length,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: text.length },
    startIndex: 0,
    endIndex: text.length,
    childForFieldName: (name: string) => fieldMap[name] ?? null,
    childrenForFieldName: (name: string) => {
      const child = fieldMap[name];
      return child ? [child] : [];
    },
    child: (index: number) => children[index] ?? null,
    namedChild: (index: number) => children[index] ?? null,
    descendantForIndex(start: number) { return this; },
    descendantForPosition(start: any) { return this; },
    descendantsOfType: () => [],
    toString: () => text,
  };

  // Set parent on children
  for (const child of children) {
    child.parent = node;
  }

  return node;
}

function wrapAsASTNode(syntaxNode: MockSyntaxNode): ASTNode {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return new TreeSitterASTNode(syntaxNode as any);
}

function createMockDocument(uri: string, rootSyntaxNode: MockSyntaxNode): DocumentState {
  const root = wrapAsASTNode(rootSyntaxNode);
  return {
    root,
    uri,
    version: 1,
    languageId: 'test',
    text: '',
    hasErrors: false,
    update: () => {},
    updateIncremental: () => {},
    dispose: () => {},
  } as DocumentState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Workspace — smart cross-file rescoping', () => {
  // Semantic definition:
  // - `program` creates a global scope
  // - `type_decl` declares a name with public visibility
  // - `var_decl` declares a name with private visibility (default)
  const semantic: SemanticDefinition = {
    program: { scope: 'global' },
    type_decl: {
      declares: {
        field: 'name',
        scope: 'enclosing',
        visibility: 'public',
      },
    },
    var_decl: {
      declares: {
        field: 'name',
        scope: 'enclosing',
      },
    },
  };

  it('does not re-scope other files when private declarations change', () => {
    const workspace = new Workspace(semantic);

    // Document A: program with a private var_decl
    const nameA = makeSyntaxNode('identifier', 'x');
    const varDecl = makeSyntaxNode('var_decl', 'let x = 1;', {
      fieldMap: { name: nameA },
    });
    const rootA = makeSyntaxNode('program', '', { namedChildren: [varDecl] });
    const docA = createMockDocument('file:///a.test', rootA);
    workspace.addDocument(docA);

    // Document B: empty program
    const rootB = makeSyntaxNode('program', '');
    const docB = createMockDocument('file:///b.test', rootB);
    workspace.addDocument(docB);

    const scopeB1 = workspace.getDocument('file:///b.test')!.scope;

    // Re-add A with same private declarations — B should NOT be rescoped
    workspace.addDocument(docA);

    const scopeB2 = workspace.getDocument('file:///b.test')!.scope;
    expect(scopeB2).toBe(scopeB1);
  });

  it('re-scopes other files when a public declaration is added', () => {
    const workspace = new Workspace(semantic);

    // Document A starts empty
    const rootA1 = makeSyntaxNode('program', '');
    const docA1 = createMockDocument('file:///a.test', rootA1);
    workspace.addDocument(docA1);

    // Document B
    const rootB = makeSyntaxNode('program', '');
    const docB = createMockDocument('file:///b.test', rootB);
    workspace.addDocument(docB);

    const scopeB1 = workspace.getDocument('file:///b.test')!.scope;

    // Edit A: add a PUBLIC type declaration
    const nameNode = makeSyntaxNode('identifier', 'MyType');
    const typeDecl = makeSyntaxNode('type_decl', 'type MyType {}', {
      fieldMap: { name: nameNode },
    });
    const rootA2 = makeSyntaxNode('program', '', { namedChildren: [typeDecl] });
    const docA2 = createMockDocument('file:///a.test', rootA2);
    workspace.addDocument(docA2);

    const scopeB2 = workspace.getDocument('file:///b.test')!.scope;

    // B should be rescoped because A's public declarations changed
    expect(scopeB2).not.toBe(scopeB1);
  });

  it('re-scopes other files when a public declaration is removed', () => {
    const workspace = new Workspace(semantic);

    // Document A starts with a public type
    const nameNode = makeSyntaxNode('identifier', 'MyType');
    const typeDecl = makeSyntaxNode('type_decl', 'type MyType {}', {
      fieldMap: { name: nameNode },
    });
    const rootA1 = makeSyntaxNode('program', '', { namedChildren: [typeDecl] });
    const docA1 = createMockDocument('file:///a.test', rootA1);
    workspace.addDocument(docA1);

    // Document B
    const rootB = makeSyntaxNode('program', '');
    const docB = createMockDocument('file:///b.test', rootB);
    workspace.addDocument(docB);

    const scopeB1 = workspace.getDocument('file:///b.test')!.scope;

    // Remove the public type from A
    const rootA2 = makeSyntaxNode('program', '');
    const docA2 = createMockDocument('file:///a.test', rootA2);
    workspace.addDocument(docA2);

    const scopeB2 = workspace.getDocument('file:///b.test')!.scope;

    // B should be rescoped because A's public declarations changed
    expect(scopeB2).not.toBe(scopeB1);
  });

  it('does not re-scope when public declarations are identical after edit', () => {
    const workspace = new Workspace(semantic);

    // Document A has a public type and a private var
    const nameType = makeSyntaxNode('identifier', 'MyType');
    const typeDecl = makeSyntaxNode('type_decl', 'type MyType {}', {
      fieldMap: { name: nameType },
    });
    const nameVar = makeSyntaxNode('identifier', 'x');
    const varDecl = makeSyntaxNode('var_decl', 'let x = 1;', {
      fieldMap: { name: nameVar },
    });
    const rootA1 = makeSyntaxNode('program', '', { namedChildren: [typeDecl, varDecl] });
    const docA1 = createMockDocument('file:///a.test', rootA1);
    workspace.addDocument(docA1);

    // Document B
    const rootB = makeSyntaxNode('program', '');
    const docB = createMockDocument('file:///b.test', rootB);
    workspace.addDocument(docB);

    const scopeB1 = workspace.getDocument('file:///b.test')!.scope;

    // Re-add A with same public type (private var may change, doesn't matter)
    // Same public fingerprint => B not rescoped
    const nameType2 = makeSyntaxNode('identifier', 'MyType');
    const typeDecl2 = makeSyntaxNode('type_decl', 'type MyType {}', {
      fieldMap: { name: nameType2 },
    });
    const nameVar2 = makeSyntaxNode('identifier', 'y');
    const varDecl2 = makeSyntaxNode('var_decl', 'let y = 2;', {
      fieldMap: { name: nameVar2 },
    });
    const rootA2 = makeSyntaxNode('program', '', { namedChildren: [typeDecl2, varDecl2] });
    const docA2 = createMockDocument('file:///a.test', rootA2);
    workspace.addDocument(docA2);

    const scopeB2 = workspace.getDocument('file:///b.test')!.scope;

    // B should NOT be rescoped — public decls are the same
    expect(scopeB2).toBe(scopeB1);
  });

  it('cleans up fingerprints on removeDocument', () => {
    const workspace = new Workspace(semantic);

    const rootA = makeSyntaxNode('program', '');
    const docA = createMockDocument('file:///a.test', rootA);
    workspace.addDocument(docA);

    expect(workspace.getDocument('file:///a.test')).not.toBeNull();
    workspace.removeDocument('file:///a.test');
    expect(workspace.getDocument('file:///a.test')).toBeNull();

    // Re-adding should work without stale fingerprints
    workspace.addDocument(docA);
    expect(workspace.getDocument('file:///a.test')).not.toBeNull();
  });
});
