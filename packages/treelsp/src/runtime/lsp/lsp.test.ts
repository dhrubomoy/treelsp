/**
 * Unit tests for LSP handlers
 * Uses mock ASTNode — no WASM dependency
 */

import { describe, it, expect } from 'vitest';
import { ASTNode } from '../parser/node.js';
import { Scope, type Declaration, type Reference } from '../scope/scope.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { DocumentState } from '../parser/tree.js';
import type { SemanticDefinition } from '../../definition/semantic.js';
import type { LspDefinition } from '../../definition/lsp.js';
import type { Workspace } from '../scope/workspace.js';

import {
  findReferenceForNode,
  findDeclarationForNode,
  findScopeForNode,
  createLspContext,
} from './context.js';
import { computeDiagnostics } from './diagnostics.js';
import { provideHover } from './hover.js';
import { provideDefinition } from './definition.js';
import { provideReferences } from './references.js';
import { provideCompletion } from './completion.js';
import { provideRename } from './rename.js';
import { provideSymbols } from './symbols.js';

// ========== Mock Helpers ==========

let nodeIdCounter = 0;

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
    isError?: boolean;
    isMissing?: boolean;
    fields?: Record<string, any>;
  }
): ASTNode {
  const startLine = options?.startLine ?? 0;
  const startChar = options?.startChar ?? 0;
  const endLine = options?.endLine ?? startLine;
  const endChar = options?.endChar ?? (startChar + text.length);
  const id = nodeIdCounter++;

  const mockSyntaxNode: any = {
    id,
    type,
    text,
    isError: options?.isError ?? false,
    hasError: options?.isError ?? false,
    isMissing: options?.isMissing ?? false,
    isNamed: true,
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
    descendantForPosition: function (pos: any) {
      // Simple: check children first, then return self
      for (const child of (options?.namedChildren ?? [])) {
        const childStart = child.startPosition;
        const childEnd = child.endPosition;
        if (
          (pos.row > childStart.row || (pos.row === childStart.row && pos.column >= childStart.column)) &&
          (pos.row < childEnd.row || (pos.row === childEnd.row && pos.column <= childEnd.column))
        ) {
          return child;
        }
      }
      return this;
    },
    descendantsOfType: () => [],
    toString: () => text,
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return new ASTNode(mockSyntaxNode);
}

function createMockDocument(root: ASTNode, uri = 'file:///test.ml'): DocumentState {
  return {
    root,
    text: root.text,
    uri,
    version: 1,
    languageId: 'test',
    hasErrors: false,
    update: () => {},
    dispose: () => {},
  } as unknown as DocumentState;
}

function createMockDocScope(options: {
  root: Scope;
  nodeScopes?: Map<number, Scope>;
  references?: Reference[];
  declarations?: Declaration[];
}): DocumentScope {
  return {
    root: options.root,
    nodeScopes: options.nodeScopes ?? new Map(),
    references: options.references ?? [],
    declarations: options.declarations ?? [],
  };
}

// ========== Context Tests ==========

describe('LspContext', () => {
  describe('findReferenceForNode', () => {
    it('should find reference by position match', () => {
      const refNode = createMockNode('identifier', 'x', {
        startLine: 1, startChar: 4, endLine: 1, endChar: 5,
      });
      const declNode = createMockNode('identifier', 'x', {
        startLine: 0, startChar: 4, endLine: 0, endChar: 5,
      });
      const decl: Declaration = {
        node: declNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
      };
      const ref: Reference = {
        node: refNode, name: 'x', to: ['variable_decl'], resolved: decl,
      };

      const docScope = createMockDocScope({
        root: new Scope('global', null, null),
        references: [ref],
      });

      const found = findReferenceForNode(refNode, docScope);
      expect(found).toBe(ref);
    });

    it('should return null for non-reference node', () => {
      const node = createMockNode('keyword', 'let', {
        startLine: 0, startChar: 0, endLine: 0, endChar: 3,
      });

      const docScope = createMockDocScope({
        root: new Scope('global', null, null),
        references: [],
      });

      expect(findReferenceForNode(node, docScope)).toBeNull();
    });
  });

  describe('findDeclarationForNode', () => {
    it('should find declaration by position match', () => {
      const declNode = createMockNode('identifier', 'x', {
        startLine: 0, startChar: 4, endLine: 0, endChar: 5,
      });
      const decl: Declaration = {
        node: declNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
      };

      const docScope = createMockDocScope({
        root: new Scope('global', null, null),
        declarations: [decl],
      });

      const found = findDeclarationForNode(declNode, docScope);
      expect(found).toBe(decl);
    });
  });

  describe('findScopeForNode', () => {
    it('should find scope for node in nodeScopes map', () => {
      const rootNode = createMockNode('program', 'program');
      const globalScope = new Scope('global', rootNode, null);
      const nodeScopes = new Map<number, Scope>();
      nodeScopes.set(rootNode.id, globalScope);

      const docScope = createMockDocScope({
        root: globalScope,
        nodeScopes,
      });

      expect(findScopeForNode(rootNode, docScope)).toBe(globalScope);
    });

    it('should fall back to root scope', () => {
      const orphanNode = createMockNode('identifier', 'x');
      const globalScope = new Scope('global', null, null);

      const docScope = createMockDocScope({
        root: globalScope,
      });

      expect(findScopeForNode(orphanNode, docScope)).toBe(globalScope);
    });
  });

  describe('createLspContext', () => {
    it('should resolve reference nodes', () => {
      const declNode = createMockNode('identifier', 'x', {
        startLine: 0, startChar: 4, endLine: 0, endChar: 5,
      });
      const refNode = createMockNode('identifier', 'x', {
        startLine: 1, startChar: 0, endLine: 1, endChar: 1,
      });
      const decl: Declaration = {
        node: declNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
      };
      const ref: Reference = {
        node: refNode, name: 'x', to: ['variable_decl'], resolved: decl,
      };

      const globalScope = new Scope('global', null, null);
      const docScope = createMockDocScope({
        root: globalScope,
        references: [ref],
      });
      const document = createMockDocument(refNode);

      const ctx = createLspContext(docScope, {} as unknown as Workspace, document, {});
      expect(ctx.resolve(refNode)).toBe(declNode);
    });

    it('should return null for typeOf (v2)', () => {
      const node = createMockNode('identifier', 'x');
      const globalScope = new Scope('global', null, null);
      const docScope = createMockDocScope({ root: globalScope });
      const document = createMockDocument(node);

      const ctx = createLspContext(docScope, {} as unknown as Workspace, document, {});
      expect(ctx.typeOf(node)).toBeNull();
    });
  });
});

// ========== Diagnostics Tests ==========

describe('computeDiagnostics', () => {
  it('should report unresolved references', () => {
    const refNode = createMockNode('identifier', 'unknown', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 7,
    });
    const parentNode = createMockNode('name_ref', 'unknown', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 7,
    });
    // Wire parent
    (refNode as any)._syntaxNode.parent = (parentNode as any)._syntaxNode;

    const ref: Reference = {
      node: refNode, name: 'unknown', to: ['variable_decl'], resolved: null,
    };

    const rootNode = createMockNode('program', '', {
      namedChildren: [],
    });
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref],
    });

    const semantic: SemanticDefinition = {
      name_ref: {
        references: { field: 'name', to: 'variable_decl', onUnresolved: 'error' },
      },
    };

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, semantic);

    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    const unresolved = diagnostics.find(d => d.code === 'unresolved-reference');
    expect(unresolved).toBeDefined();
    expect(unresolved?.message).toContain('unknown');
  });

  it('should skip ignored unresolved references', () => {
    const refNode = createMockNode('identifier', 'x');
    const parentNode = createMockNode('name_ref', 'x');
    (refNode as any)._syntaxNode.parent = (parentNode as any)._syntaxNode;

    const ref: Reference = {
      node: refNode, name: 'x', to: ['variable_decl'], resolved: null,
    };

    const rootNode = createMockNode('program', '');
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref],
    });

    const semantic: SemanticDefinition = {
      name_ref: {
        references: { field: 'name', to: 'variable_decl', onUnresolved: 'ignore' },
      },
    };

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, semantic);

    const unresolved = diagnostics.filter(d => d.code === 'unresolved-reference');
    expect(unresolved).toHaveLength(0);
  });
});

// ========== Hover Tests ==========

describe('provideHover', () => {
  it('should return hover for declaration', () => {
    const nameNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const rootNode = createMockNode('program', 'let x = 1', {
      namedChildren: [(nameNode as any)._syntaxNode],
    });
    (nameNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const decl: Declaration = {
      node: nameNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
    };

    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      declarations: [decl],
    });

    const document = createMockDocument(rootNode);
    const result = provideHover(
      document, { line: 0, character: 4 }, docScope, {}
    );

    expect(result).not.toBeNull();
    expect(result?.contents).toContain('variable_decl');
    expect(result?.contents).toContain('x');
  });

  it('should return null for root node', () => {
    const rootNode = createMockNode('program', '');
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const result = provideHover(
      document, { line: 0, character: 0 }, docScope, {}
    );
    expect(result).toBeNull();
  });

  it('should use custom hover handler', () => {
    const nameNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const varDeclNode = createMockNode('variable_decl', 'let x = 1', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 10,
      namedChildren: [(nameNode as any)._syntaxNode],
    });
    (nameNode as any)._syntaxNode.parent = (varDeclNode as any)._syntaxNode;

    const decl: Declaration = {
      node: nameNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
    };
    const ref: Reference = {
      node: nameNode, name: 'x', to: ['variable_decl'], resolved: decl,
    };

    const globalScope = new Scope('global', null, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref],
      declarations: [decl],
    });

    const lsp: LspDefinition = {
      variable_decl: {
        hover: () => '**custom** hover text',
      },
    };

    const rootNode = createMockNode('program', 'let x = 1', {
      namedChildren: [(nameNode as any)._syntaxNode],
    });
    const document = createMockDocument(rootNode);

    const result = provideHover(
      document, { line: 0, character: 4 }, docScope, {}, lsp
    );

    expect(result?.contents).toBe('**custom** hover text');
  });
});

// ========== Definition Tests ==========

describe('provideDefinition', () => {
  it('should return declaration location for reference', () => {
    const declNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const refNode = createMockNode('identifier', 'x', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 1,
    });

    const decl: Declaration = {
      node: declNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
    };
    const ref: Reference = {
      node: refNode, name: 'x', to: ['variable_decl'], resolved: decl,
    };

    const rootNode = createMockNode('program', '', {
      namedChildren: [(refNode as any)._syntaxNode],
    });
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref],
    });
    const document = createMockDocument(rootNode);

    const result = provideDefinition(
      document, { line: 1, character: 0 }, docScope
    );

    expect(result).not.toBeNull();
    expect(result?.range.start.line).toBe(0);
    expect(result?.range.start.character).toBe(4);
  });

  it('should return null for non-reference', () => {
    const node = createMockNode('keyword', 'let', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 3,
    });
    const rootNode = createMockNode('program', '', {
      namedChildren: [(node as any)._syntaxNode],
    });
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const result = provideDefinition(
      document, { line: 0, character: 0 }, docScope
    );
    expect(result).toBeNull();
  });
});

// ========== References Tests ==========

describe('provideReferences', () => {
  it('should find all references to a declaration', () => {
    const declNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const refNode1 = createMockNode('identifier', 'x', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 1,
    });
    const refNode2 = createMockNode('identifier', 'x', {
      startLine: 2, startChar: 0, endLine: 2, endChar: 1,
    });

    const decl: Declaration = {
      node: declNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
    };
    const ref1: Reference = {
      node: refNode1, name: 'x', to: ['variable_decl'], resolved: decl,
    };
    const ref2: Reference = {
      node: refNode2, name: 'x', to: ['variable_decl'], resolved: decl,
    };

    const rootNode = createMockNode('program', '', {
      namedChildren: [(declNode as any)._syntaxNode],
    });
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref1, ref2],
      declarations: [decl],
    });
    const document = createMockDocument(rootNode);

    // Query from declaration position
    const result = provideReferences(
      document, { line: 0, character: 4 }, docScope
    );

    expect(result).toHaveLength(2);
  });

  it('should return empty for non-symbol', () => {
    const node = createMockNode('keyword', 'let');
    const rootNode = createMockNode('program', '', {
      namedChildren: [(node as any)._syntaxNode],
    });
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const result = provideReferences(
      document, { line: 0, character: 0 }, docScope
    );
    expect(result).toHaveLength(0);
  });
});

// ========== Completion Tests ==========

describe('provideCompletion', () => {
  it('should return scope-based completions', () => {
    const rootNode = createMockNode('program', '');
    const globalScope = new Scope('global', rootNode, null);

    const xNode = createMockNode('identifier', 'x');
    const yNode = createMockNode('identifier', 'y');
    globalScope.declare('x', xNode, 'variable_decl', 'private');
    globalScope.declare('y', yNode, 'variable_decl', 'private');

    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({
      root: globalScope,
      nodeScopes,
    });

    const document = createMockDocument(rootNode);
    const result = provideCompletion(
      document, { line: 0, character: 0 }, docScope, {}
    );

    expect(result.length).toBeGreaterThanOrEqual(2);
    const labels = result.map(i => i.label);
    expect(labels).toContain('x');
    expect(labels).toContain('y');
  });

  it('should return keyword completions', () => {
    const rootNode = createMockNode('program', '');
    const globalScope = new Scope('global', rootNode, null);
    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({
      root: globalScope,
      nodeScopes,
    });

    const lsp = {
      $keywords: {
        'let': { detail: 'Declare variable' },
        'if': { detail: 'Conditional' },
      },
    } as LspDefinition;

    const document = createMockDocument(rootNode);
    const result = provideCompletion(
      document, { line: 0, character: 0 }, docScope, {}, lsp
    );

    const labels = result.map(i => i.label);
    expect(labels).toContain('let');
    expect(labels).toContain('if');
  });

  it('should use completionKind from LSP config', () => {
    const rootNode = createMockNode('program', '');
    const globalScope = new Scope('global', rootNode, null);

    const xNode = createMockNode('identifier', 'x');
    globalScope.declare('x', xNode, 'variable_decl', 'private');

    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({
      root: globalScope,
      nodeScopes,
    });

    const lsp: LspDefinition = {
      variable_decl: { completionKind: 'Variable' },
    };

    const document = createMockDocument(rootNode);
    const result = provideCompletion(
      document, { line: 0, character: 0 }, docScope, {}, lsp
    );

    const xItem = result.find(i => i.label === 'x');
    expect(xItem?.kind).toBe('Variable');
  });
});

// ========== Rename Tests ==========

describe('provideRename', () => {
  it('should rename declaration and all references', () => {
    const declNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const refNode = createMockNode('identifier', 'x', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 1,
    });

    const decl: Declaration = {
      node: declNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
    };
    const ref: Reference = {
      node: refNode, name: 'x', to: ['variable_decl'], resolved: decl,
    };

    const rootNode = createMockNode('program', '', {
      namedChildren: [(declNode as any)._syntaxNode],
    });
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref],
      declarations: [decl],
    });

    const document = createMockDocument(rootNode);
    const result = provideRename(
      document, { line: 0, character: 4 }, 'newName', docScope
    );

    expect(result).not.toBeNull();
    const edits = result?.changes[document.uri];
    expect(edits).toBeDefined();
    // Should have edit for declaration + reference
    expect(edits?.length).toBeGreaterThanOrEqual(2);
    for (const edit of edits ?? []) {
      expect(edit.newText).toBe('newName');
    }
  });

  it('should return null for non-symbol', () => {
    const node = createMockNode('keyword', 'let');
    const rootNode = createMockNode('program', '', {
      namedChildren: [(node as any)._syntaxNode],
    });
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const result = provideRename(
      document, { line: 0, character: 0 }, 'newName', docScope
    );
    expect(result).toBeNull();
  });
});

// ========== Symbols Tests ==========

describe('provideSymbols', () => {
  it('should return symbols for declarations with symbol descriptors', () => {
    const nameNode = createMockNode('identifier', 'myVar', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 9,
    });
    const varDeclNode = createMockNode('variable_decl', 'let myVar = 1', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 13,
    });
    (nameNode as any)._syntaxNode.parent = (varDeclNode as any)._syntaxNode;

    const decl: Declaration = {
      node: nameNode, name: 'myVar', visibility: 'private', declaredBy: 'variable_decl',
    };

    const globalScope = new Scope('global', null, null);
    const docScope = createMockDocScope({
      root: globalScope,
      declarations: [decl],
    });

    const lsp: LspDefinition = {
      variable_decl: {
        symbol: {
          kind: 'Variable',
          label: (node: any) => node.text?.split?.(' ')?.[1] ?? 'unknown',
        },
      },
    };

    const symbols = provideSymbols(docScope, lsp);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.kind).toBe('Variable');
    expect(symbols[0]?.kindNumber).toBe(13); // Variable = 13
  });

  it('should skip declarations without symbol descriptor', () => {
    const nameNode = createMockNode('identifier', 'x');
    const decl: Declaration = {
      node: nameNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
    };

    const globalScope = new Scope('global', null, null);
    const docScope = createMockDocScope({
      root: globalScope,
      declarations: [decl],
    });

    const lsp: LspDefinition = {};
    const symbols = provideSymbols(docScope, lsp);
    expect(symbols).toHaveLength(0);
  });

  it('should return empty without LSP config', () => {
    const globalScope = new Scope('global', null, null);
    const docScope = createMockDocScope({ root: globalScope });

    const symbols = provideSymbols(docScope);
    expect(symbols).toHaveLength(0);
  });

  it('should use string label', () => {
    const nameNode = createMockNode('identifier', 'x');
    const decl: Declaration = {
      node: nameNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
    };

    const globalScope = new Scope('global', null, null);
    const docScope = createMockDocScope({
      root: globalScope,
      declarations: [decl],
    });

    const lsp: LspDefinition = {
      variable_decl: {
        symbol: {
          kind: 'Variable',
          label: 'Variables',
        },
      },
    };

    const symbols = provideSymbols(docScope, lsp);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe('Variables');
  });
});
