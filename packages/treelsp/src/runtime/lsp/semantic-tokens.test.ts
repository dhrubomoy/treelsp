/**
 * Unit tests for semantic tokens provider
 * Uses mock ASTNode — no WASM dependency
 */

import { describe, it, expect } from 'vitest';
import type { ASTNode } from '../parser/ast-node.js';
import { TreeSitterASTNode } from '../parser/tree-sitter/node.js';
import { Scope, type Declaration, type Reference } from '../scope/scope.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { DocumentState } from '../parser/document-state.js';
import type { SemanticDefinition } from '../../definition/semantic.js';
import type { LspDefinition } from '../../definition/lsp.js';
import { provideSemanticTokensFull, SEMANTIC_TOKEN_TYPES } from './semantic-tokens.js';

// ========== Mock Helpers ==========

let nodeIdCounter = 1000;

function createMockNode(
  type: string,
  text: string,
  options?: {
    startLine?: number;
    startChar?: number;
    endLine?: number;
    endChar?: number;
    parent?: any;
    children?: any[];
    namedChildren?: any[];
    isNamed?: boolean;
    fields?: Record<string, any>;
  }
): TreeSitterASTNode {
  const startLine = options?.startLine ?? 0;
  const startChar = options?.startChar ?? 0;
  const endLine = options?.endLine ?? startLine;
  const endChar = options?.endChar ?? (startChar + text.length);
  const id = nodeIdCounter++;

  const mockSyntaxNode: any = {
    id,
    type,
    text,
    isError: false,
    hasError: false,
    isMissing: false,
    isNamed: options?.isNamed ?? true,
    parent: options?.parent ?? null,
    children: options?.children ?? [],
    namedChildren: options?.namedChildren ?? [],
    childCount: (options?.children ?? []).length,
    namedChildCount: (options?.namedChildren ?? []).length,
    startPosition: { row: startLine, column: startChar },
    endPosition: { row: endLine, column: endChar },
    startIndex: startChar,
    endIndex: endChar,
    childForFieldName: (name: string) => options?.fields?.[name] ?? null,
    childrenForFieldName: (name: string) => {
      const child = options?.fields?.[name];
      return child ? [child] : [];
    },
    child: (i: number) => (options?.children ?? [])[i] ?? null,
    namedChild: (i: number) => (options?.namedChildren ?? [])[i] ?? null,
    descendantForIndex: function () { return this; },
    descendantForPosition: function () { return this; },
    descendantsOfType: () => [],
    toString: () => text,
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return new TreeSitterASTNode(mockSyntaxNode);
}

function createMockDocument(root: ASTNode, uri = 'file:///test.ml'): DocumentState {
  return {
    root,
    text: root.text,
    uri,
    version: 1,
    languageId: 'test',
  } as unknown as DocumentState;
}

function tokenTypeIndex(name: string): number {
  return SEMANTIC_TOKEN_TYPES.indexOf(name as typeof SEMANTIC_TOKEN_TYPES[number]);
}

describe('provideSemanticTokensFull', () => {
  it('returns empty data for empty document', () => {
    const root = createMockNode('program', '');
    const doc = createMockDocument(root);
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [],
    };

    const result = provideSemanticTokensFull(doc, scope, {});
    expect(result.data).toEqual([]);
  });

  it('skips anonymous keyword tokens (handled by TextMate)', () => {
    // Anonymous nodes (keywords, operators) are now handled by TextMate grammar
    const letNode = createMockNode('let', 'let', {
      startLine: 0, startChar: 0, endChar: 3, isNamed: false,
    });
    const root = createMockNode('program', 'let x = 1;', {
      children: [letNode._syntaxNode],
    });
    const doc = createMockDocument(root);
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [],
    };

    const result = provideSemanticTokensFull(doc, scope, {});
    // Anonymous nodes should produce no semantic tokens
    expect(result.data).toEqual([]);
  });

  it('skips anonymous operator tokens (handled by TextMate)', () => {
    const opNode = createMockNode('+', '+', {
      startLine: 0, startChar: 5, endChar: 6, isNamed: false,
    });
    const root = createMockNode('program', 'a + b', {
      children: [opNode._syntaxNode],
    });
    const doc = createMockDocument(root);
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [],
    };

    const result = provideSemanticTokensFull(doc, scope, {});
    // Anonymous nodes should produce no semantic tokens
    expect(result.data).toEqual([]);
  });

  it('classifies declarations with declaration modifier', () => {
    const nameNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endChar: 5,
    });
    const root = createMockNode('program', 'let x = 1;', {
      children: [nameNode._syntaxNode],
      namedChildren: [nameNode._syntaxNode],
    });
    const doc = createMockDocument(root);

    const decl: Declaration = {
      name: 'x',
      node: nameNode,
      declaredBy: 'variable_decl',
      visibility: 'private',
    };
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [decl],
    };

    const lsp: LspDefinition = {
      variable_decl: { completionKind: 'Variable' },
    };

    const result = provideSemanticTokensFull(doc, scope, {}, lsp);
    expect(result.data.length).toBeGreaterThanOrEqual(5);
    // Find the token for 'x'
    expect(result.data[3]).toBe(tokenTypeIndex('variable'));
    expect(result.data[4]).toBe(1); // bit 0 = declaration modifier
  });

  it('classifies references based on declaring rule completionKind', () => {
    const refNode = createMockNode('identifier', 'myFunc', {
      startLine: 1, startChar: 0, endChar: 6,
    });
    const root = createMockNode('program', 'myFunc', {
      children: [refNode._syntaxNode],
      namedChildren: [refNode._syntaxNode],
    });
    const doc = createMockDocument(root);

    const declNode = createMockNode('identifier', 'myFunc', {
      startLine: 0, startChar: 3, endChar: 9,
    });
    const decl: Declaration = {
      name: 'myFunc',
      node: declNode,
      declaredBy: 'function_decl',
      visibility: 'private',
    };
    const ref: Reference = {
      node: refNode,
      name: 'myFunc',
      to: ['function_decl'],
      resolved: decl,
    };
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [ref],
      declarations: [],
    };

    const lsp: LspDefinition = {
      function_decl: { completionKind: 'Function' },
    };

    const result = provideSemanticTokensFull(doc, scope, {}, lsp);
    expect(result.data.length).toBeGreaterThanOrEqual(5);
    expect(result.data[3]).toBe(tokenTypeIndex('function'));
    expect(result.data[4]).toBe(0); // no declaration modifier for references
  });

  it('classifies number tokens by rule name', () => {
    const numNode = createMockNode('number', '42', {
      startLine: 0, startChar: 0, endChar: 2,
    });
    const root = createMockNode('program', '42', {
      children: [numNode._syntaxNode],
      namedChildren: [numNode._syntaxNode],
    });
    const doc = createMockDocument(root);
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [],
    };

    const result = provideSemanticTokensFull(doc, scope, {});
    expect(result.data.length).toBeGreaterThanOrEqual(5);
    expect(result.data[3]).toBe(tokenTypeIndex('number'));
  });

  it('classifies string tokens by rule name', () => {
    const strNode = createMockNode('string_literal', '"hello"', {
      startLine: 0, startChar: 0, endChar: 7,
    });
    const root = createMockNode('program', '"hello"', {
      children: [strNode._syntaxNode],
      namedChildren: [strNode._syntaxNode],
    });
    const doc = createMockDocument(root);
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [],
    };

    const result = provideSemanticTokensFull(doc, scope, {});
    expect(result.data.length).toBeGreaterThanOrEqual(5);
    expect(result.data[3]).toBe(tokenTypeIndex('string'));
  });

  it('produces delta-encoded output sorted by position', () => {
    // Two named tokens on different lines
    const numNode1 = createMockNode('number', '42', {
      startLine: 0, startChar: 0, endChar: 2,
    });
    const numNode2 = createMockNode('number', '99', {
      startLine: 1, startChar: 0, endChar: 2,
    });
    const root = createMockNode('program', '42\n99', {
      children: [numNode1._syntaxNode, numNode2._syntaxNode],
      namedChildren: [numNode1._syntaxNode, numNode2._syntaxNode],
    });
    const doc = createMockDocument(root);
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [],
    };

    const result = provideSemanticTokensFull(doc, scope, {});
    // Two tokens, 5 values each
    expect(result.data.length).toBe(10);
    // First token: line 0
    expect(result.data[0]).toBe(0); // deltaLine
    expect(result.data[1]).toBe(0); // deltaChar
    expect(result.data[3]).toBe(tokenTypeIndex('number'));
    // Second token: line 1 (deltaLine=1)
    expect(result.data[5]).toBe(1); // deltaLine
    expect(result.data[6]).toBe(0); // deltaChar (absolute since new line)
  });

  it('classifies unresolved references as variable via semantic', () => {
    const idNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 0, endChar: 1,
    });
    const root = createMockNode('program', 'x', {
      children: [idNode._syntaxNode],
      namedChildren: [idNode._syntaxNode],
    });
    const doc = createMockDocument(root);

    const semantic: SemanticDefinition = {
      identifier: { references: { field: 'name', to: 'variable_decl' } },
    };
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [],
    };

    const result = provideSemanticTokensFull(doc, scope, semantic);
    expect(result.data.length).toBeGreaterThanOrEqual(5);
    expect(result.data[3]).toBe(tokenTypeIndex('variable'));
  });

  it('uses semanticToken string shorthand to override token type', () => {
    const nameNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endChar: 5,
    });
    const root = createMockNode('program', 'fn x()', {
      children: [nameNode._syntaxNode],
      namedChildren: [nameNode._syntaxNode],
    });
    const doc = createMockDocument(root);

    const decl: Declaration = {
      name: 'x',
      node: nameNode,
      declaredBy: 'parameter',
      visibility: 'private',
    };
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [decl],
    };

    const lsp: LspDefinition = {
      parameter: {
        completionKind: 'Variable',
        semanticToken: 'parameter',
      },
    };

    const result = provideSemanticTokensFull(doc, scope, {}, lsp);
    expect(result.data.length).toBeGreaterThanOrEqual(5);
    expect(result.data[3]).toBe(tokenTypeIndex('parameter'));
    expect(result.data[4]).toBe(1); // declaration modifier still set
  });

  it('uses semanticToken object form with type and modifiers on declarations', () => {
    const nameNode = createMockNode('identifier', 'MAX', {
      startLine: 0, startChar: 6, endChar: 9,
    });
    const root = createMockNode('program', 'const MAX = 1', {
      children: [nameNode._syntaxNode],
      namedChildren: [nameNode._syntaxNode],
    });
    const doc = createMockDocument(root);

    const decl: Declaration = {
      name: 'MAX',
      node: nameNode,
      declaredBy: 'const_decl',
      visibility: 'private',
    };
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [decl],
    };

    const lsp: LspDefinition = {
      const_decl: {
        completionKind: 'Constant',
        semanticToken: {
          type: 'variable',
          modifiers: ['readonly'],
        },
      },
    };

    const result = provideSemanticTokensFull(doc, scope, {}, lsp);
    expect(result.data.length).toBeGreaterThanOrEqual(5);
    expect(result.data[3]).toBe(tokenTypeIndex('variable'));
    // readonly = bit 2 (1 << 2 = 4), declaration = bit 0 (1) → 5
    expect(result.data[4]).toBe(5);
  });

  it('uses semanticToken modifiers-only form (type from completionKind)', () => {
    const nameNode = createMockNode('identifier', 'old', {
      startLine: 0, startChar: 0, endChar: 3,
    });
    const root = createMockNode('program', 'old', {
      children: [nameNode._syntaxNode],
      namedChildren: [nameNode._syntaxNode],
    });
    const doc = createMockDocument(root);

    const decl: Declaration = {
      name: 'old',
      node: nameNode,
      declaredBy: 'deprecated_func',
      visibility: 'private',
    };
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [decl],
    };

    const lsp: LspDefinition = {
      deprecated_func: {
        completionKind: 'Function',
        semanticToken: {
          modifiers: ['deprecated'],
        },
      },
    };

    const result = provideSemanticTokensFull(doc, scope, {}, lsp);
    expect(result.data.length).toBeGreaterThanOrEqual(5);
    // Token type from completionKind (Function → function)
    expect(result.data[3]).toBe(tokenTypeIndex('function'));
    // deprecated = bit 4 (1 << 4 = 16), declaration = bit 0 (1) → 17
    expect(result.data[4]).toBe(17);
  });

  it('propagates semanticToken modifiers to references', () => {
    const refNode = createMockNode('identifier', 'MAX', {
      startLine: 1, startChar: 0, endChar: 3,
    });
    const root = createMockNode('program', 'MAX', {
      children: [refNode._syntaxNode],
      namedChildren: [refNode._syntaxNode],
    });
    const doc = createMockDocument(root);

    const declNode = createMockNode('identifier', 'MAX', {
      startLine: 0, startChar: 6, endChar: 9,
    });
    const decl: Declaration = {
      name: 'MAX',
      node: declNode,
      declaredBy: 'const_decl',
      visibility: 'private',
    };
    const ref: Reference = {
      node: refNode,
      name: 'MAX',
      to: ['const_decl'],
      resolved: decl,
    };
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [ref],
      declarations: [],
    };

    const lsp: LspDefinition = {
      const_decl: {
        completionKind: 'Constant',
        semanticToken: {
          type: 'variable',
          modifiers: ['readonly'],
        },
      },
    };

    const result = provideSemanticTokensFull(doc, scope, {}, lsp);
    expect(result.data.length).toBeGreaterThanOrEqual(5);
    expect(result.data[3]).toBe(tokenTypeIndex('variable'));
    // References get modifiers from semanticToken but NOT the declaration bit
    // readonly = bit 2 (1 << 2 = 4)
    expect(result.data[4]).toBe(4);
  });

  it('semanticToken takes precedence over completionKind for token type', () => {
    const nameNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 0, endChar: 1,
    });
    const root = createMockNode('program', 'x', {
      children: [nameNode._syntaxNode],
      namedChildren: [nameNode._syntaxNode],
    });
    const doc = createMockDocument(root);

    const decl: Declaration = {
      name: 'x',
      node: nameNode,
      declaredBy: 'param',
      visibility: 'private',
    };
    const scope: DocumentScope = {
      root: new Scope('global', root, null),
      nodeScopes: new Map(),
      references: [],
      declarations: [decl],
    };

    // completionKind says Variable (→ 'variable'), semanticToken says 'parameter'
    const lsp: LspDefinition = {
      param: {
        completionKind: 'Variable',
        semanticToken: 'parameter',
      },
    };

    const result = provideSemanticTokensFull(doc, scope, {}, lsp);
    // semanticToken wins
    expect(result.data[3]).toBe(tokenTypeIndex('parameter'));
  });
});
