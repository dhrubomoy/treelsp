/**
 * Unit tests for LSP handlers
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
import type { Workspace } from '../scope/workspace.js';

import {
  findNodeAtPosition,
  findReferenceForNode,
  findDeclarationForNode,
  findScopeForNode,
  createLspContext,
} from './context.js';
import { computeDiagnostics } from './diagnostics.js';
import { provideHover } from './hover.js';
import { provideDefinition } from './definition.js';
import { provideReferences } from './references.js';
import { provideCompletion, getCompletionTriggerCharacters } from './completion.js';
import { prepareRename, provideRename } from './rename.js';
import { provideSymbols } from './symbols.js';
import { provideSignatureHelp, getSignatureTriggerCharacters } from './signature-help.js';
import { provideCodeActions } from './code-actions.js';
import { DocumentManager } from './documents.js';
import { createServer } from './server.js';
import type { LanguageDefinition } from '../../definition/index.js';
import type { ValidationDefinition } from '../../definition/validation.js';

function createMockLanguageDef(overrides?: Partial<LanguageDefinition>): LanguageDefinition {
  return {
    name: 'test',
    fileExtensions: ['.test'],
    entry: 'program',
    grammar: {} as any,
    ...overrides,
  };
}

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
    isNamed?: boolean;
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
    descendantForPosition: function (pos: any): any {
      // Recursively find the smallest node containing the position.
      // End position is exclusive (matching tree-sitter semantics).
      // Search all children (named + anonymous) to match tree-sitter behavior.
      const allChildren = (options?.children ?? []).length > 0
        ? (options?.children ?? [])
        : (options?.namedChildren ?? []);
      for (const child of allChildren) {
        const childStart = child.startPosition;
        const childEnd = child.endPosition;
        if (
          (pos.row > childStart.row || (pos.row === childStart.row && pos.column >= childStart.column)) &&
          (pos.row < childEnd.row || (pos.row === childEnd.row && pos.column < childEnd.column))
        ) {
          // Recurse into child to find the smallest match
          if (child.descendantForPosition) {
            return child.descendantForPosition(pos);
          }
          return child;
        }
      }
      return this;
    },
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

// ========== findNodeAtPosition Tests ==========

describe('findNodeAtPosition', () => {
  it('should return leaf node when position is inside a token', () => {
    // identifier "x" at (0, 10)-(0, 11), inside binary_expr (0, 10)-(0, 15)
    const identNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 10, endLine: 0, endChar: 11,
    });
    const binaryNode = createMockNode('binary_expr', 'x + y', {
      startLine: 0, startChar: 10, endLine: 0, endChar: 15,
      namedChildren: [(identNode as any)._syntaxNode],
    });
    const rootNode = createMockNode('program', 'let sum = x + y;', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 16,
      namedChildren: [(binaryNode as any)._syntaxNode],
    });

    // Position at start of "x" → should return identifier
    const node = findNodeAtPosition(rootNode, { line: 0, character: 10 });
    expect(node.type).toBe('identifier');
    expect(node.text).toBe('x');
  });

  it('should fall back to previous character when position is at exclusive end of token', () => {
    // identifier "x" at (0, 10)-(0, 11), inside binary_expr (0, 10)-(0, 15)
    // Position 11 is past the identifier (whitespace) → tree-sitter returns binary_expr
    // The fix should look one char back and find "x"
    const identNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 10, endLine: 0, endChar: 11,
    });
    const binaryNode = createMockNode('binary_expr', 'x + y', {
      startLine: 0, startChar: 10, endLine: 0, endChar: 15,
      namedChildren: [(identNode as any)._syntaxNode],
    });
    const rootNode = createMockNode('program', 'let sum = x + y;', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 16,
      namedChildren: [(binaryNode as any)._syntaxNode],
    });

    // Position at char 11 (past "x") → should still find "x" via fallback
    const node = findNodeAtPosition(rootNode, { line: 0, character: 11 });
    expect(node.type).toBe('identifier');
    expect(node.text).toBe('x');
  });

  it('should not fall back when already on a leaf node', () => {
    // Two adjacent identifiers: "x" at (0, 0)-(0, 1), "y" at (0, 1)-(0, 2)
    const xNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
    });
    const yNode = createMockNode('identifier', 'y', {
      startLine: 0, startChar: 1, endLine: 0, endChar: 2,
    });
    const rootNode = createMockNode('program', 'xy', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 2,
      namedChildren: [(xNode as any)._syntaxNode, (yNode as any)._syntaxNode],
    });

    // Position at char 1 hits "y" directly (leaf) → no fallback needed
    const node = findNodeAtPosition(rootNode, { line: 0, character: 1 });
    expect(node.type).toBe('identifier');
    expect(node.text).toBe('y');
  });

  it('should fall back when position lands on anonymous node like semicolon', () => {
    // "y" at (0, 14)-(0, 15) named, ";" at (0, 15)-(0, 16) anonymous
    // Clicking at the right edge of "y" sends position 15 which hits ";"
    const yNode = createMockNode('identifier', 'y', {
      startLine: 0, startChar: 14, endLine: 0, endChar: 15,
      isNamed: true,
    });
    const semiNode = createMockNode(';', ';', {
      startLine: 0, startChar: 15, endLine: 0, endChar: 16,
      isNamed: false,
    });
    const rootNode = createMockNode('program', 'let sum = x + y;', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 16,
      children: [(yNode as any)._syntaxNode, (semiNode as any)._syntaxNode],
    });

    // Position at char 15 hits ";" → should fall back to "y"
    const node = findNodeAtPosition(rootNode, { line: 0, character: 15 });
    expect(node.type).toBe('identifier');
    expect(node.text).toBe('y');
  });

  it('should not fall back at character 0', () => {
    const rootNode = createMockNode('program', 'hello', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 5,
    });

    // Position at char 0 → can't go back, return whatever we get
    const node = findNodeAtPosition(rootNode, { line: 0, character: 0 });
    expect(node.type).toBe('program');
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

// ========== Diagnostics: Parse Errors ==========

describe('computeDiagnostics — parse errors', () => {
  it('should report missing nodes', () => {
    const missingNode = createMockNode('identifier', '', {
      startLine: 0, startChar: 5, endLine: 0, endChar: 5,
      isMissing: true,
    });
    const rootNode = createMockNode('program', 'let  ', {
      children: [(missingNode as any)._syntaxNode],
      namedChildren: [(missingNode as any)._syntaxNode],
    });

    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const diagnostics = computeDiagnostics(document, docScope, {});

    const missing = diagnostics.find(d => d.code === 'missing-node');
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe('error');
    expect(missing?.message).toContain('Missing');
  });

  it('should report leaf error nodes', () => {
    const errorNode = createMockNode('ERROR', '???', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 3,
      isError: true,
    });
    const rootNode = createMockNode('program', '???', {
      children: [(errorNode as any)._syntaxNode],
      namedChildren: [(errorNode as any)._syntaxNode],
    });

    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const diagnostics = computeDiagnostics(document, docScope, {});

    const syntaxError = diagnostics.find(d => d.code === 'syntax-error');
    expect(syntaxError).toBeDefined();
    expect(syntaxError?.severity).toBe('error');
    expect(syntaxError?.message).toBe('Syntax error');
  });

  it('should not duplicate errors for parent nodes that have error children', () => {
    const leafError = createMockNode('ERROR', '!', {
      startLine: 0, startChar: 3, endLine: 0, endChar: 4,
      isError: true,
    });
    const parentError = createMockNode('ERROR', 'x !', {
      startLine: 0, startChar: 2, endLine: 0, endChar: 4,
      isError: true,
      children: [(leafError as any)._syntaxNode],
    });
    const rootNode = createMockNode('program', '  x !', {
      children: [(parentError as any)._syntaxNode],
      namedChildren: [(parentError as any)._syntaxNode],
    });

    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const diagnostics = computeDiagnostics(document, docScope, {});

    // Only the leaf error should produce a diagnostic, not the parent
    const syntaxErrors = diagnostics.filter(d => d.code === 'syntax-error');
    expect(syntaxErrors).toHaveLength(1);
    expect(syntaxErrors[0]?.range.start.character).toBe(3);
  });
});

// ========== Diagnostics: Unresolved Reference Variants ==========

describe('computeDiagnostics — unresolved reference variants', () => {
  it('should report warning severity when onUnresolved is "warning"', () => {
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
        references: { field: 'name', to: 'variable_decl', onUnresolved: 'warning' },
      },
    };

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, semantic);

    const unresolved = diagnostics.find(d => d.code === 'unresolved-reference');
    expect(unresolved).toBeDefined();
    expect(unresolved?.severity).toBe('warning');
  });

  it('should skip optional references', () => {
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
        references: { field: 'name', to: 'variable_decl', optional: true },
      },
    };

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, semantic);

    expect(diagnostics.filter(d => d.code === 'unresolved-reference')).toHaveLength(0);
  });

  it('should use custom $unresolved message', () => {
    const refNode = createMockNode('identifier', 'foo');
    const parentNode = createMockNode('name_ref', 'foo');
    (refNode as any)._syntaxNode.parent = (parentNode as any)._syntaxNode;

    const ref: Reference = {
      node: refNode, name: 'foo', to: ['variable_decl'], resolved: null,
    };

    const rootNode = createMockNode('program', '');
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref],
    });

    const semantic: SemanticDefinition = {
      name_ref: {
        references: { field: 'name', to: 'variable_decl' },
      },
    };

    const lsp = {
      $unresolved: () => 'Did you mean bar?',
    } as LspDefinition;

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, semantic, lsp);

    const unresolved = diagnostics.find(d => d.code === 'unresolved-reference');
    expect(unresolved?.message).toBe('Did you mean bar?');
  });

  it('should skip already-resolved references', () => {
    const declNode = createMockNode('identifier', 'x');
    const refNode = createMockNode('identifier', 'x');

    const decl: Declaration = {
      node: declNode, name: 'x', visibility: 'private', declaredBy: 'variable_decl',
    };
    const ref: Reference = {
      node: refNode, name: 'x', to: ['variable_decl'], resolved: decl,
    };

    const rootNode = createMockNode('program', '');
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref],
    });

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, {});

    expect(diagnostics.filter(d => d.code === 'unresolved-reference')).toHaveLength(0);
  });
});

// ========== Diagnostics: Custom Validation ==========

describe('computeDiagnostics — custom validation', () => {
  it('should collect errors from validators', () => {
    const nameNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const varDeclNode = createMockNode('variable_decl', 'let x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 5,
      namedChildren: [(nameNode as any)._syntaxNode],
    });
    (nameNode as any)._syntaxNode.parent = (varDeclNode as any)._syntaxNode;

    const rootNode = createMockNode('program', 'let x', {
      namedChildren: [(varDeclNode as any)._syntaxNode],
    });
    (varDeclNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const globalScope = new Scope('global', rootNode, null);
    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);
    nodeScopes.set(varDeclNode.id, globalScope);

    const docScope = createMockDocScope({
      root: globalScope,
      nodeScopes,
    });

    const validation: ValidationDefinition = {
      variable_decl: (node: any, ctx: any) => {
        ctx.error(node, 'Variables must be uppercase', { code: 'uppercase-var' });
      },
    };

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, {}, undefined, validation);

    const custom = diagnostics.find(d => d.code === 'uppercase-var');
    expect(custom).toBeDefined();
    expect(custom?.severity).toBe('error');
    expect(custom?.message).toBe('Variables must be uppercase');
  });

  it('should support all severity levels from validators', () => {
    const node = createMockNode('some_node', 'x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
    });
    const rootNode = createMockNode('program', 'x', {
      namedChildren: [(node as any)._syntaxNode],
    });
    (node as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const globalScope = new Scope('global', rootNode, null);
    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({ root: globalScope, nodeScopes });

    const validation: ValidationDefinition = {
      some_node: (n: any, ctx: any) => {
        ctx.error(n, 'err');
        ctx.warning(n, 'warn');
        ctx.info(n, 'inf');
        ctx.hint(n, 'hnt');
      },
    };

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, {}, undefined, validation);

    const severities = diagnostics.map(d => d.severity);
    expect(severities).toContain('error');
    expect(severities).toContain('warning');
    expect(severities).toContain('info');
    expect(severities).toContain('hint');
  });

  it('should support array of validators per rule', () => {
    const node = createMockNode('rule_a', 'a', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
    });
    const rootNode = createMockNode('program', 'a', {
      namedChildren: [(node as any)._syntaxNode],
    });
    (node as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const globalScope = new Scope('global', rootNode, null);
    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({ root: globalScope, nodeScopes });

    const validation: ValidationDefinition = {
      rule_a: [
        (n: any, ctx: any) => { ctx.error(n, 'v1'); },
        (n: any, ctx: any) => { ctx.warning(n, 'v2'); },
      ],
    };

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, {}, undefined, validation);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.message).toBe('v1');
    expect(diagnostics[1]?.message).toBe('v2');
  });

  it('should pass correct node to declarationsOf (not validator node)', () => {
    // Bug: declarationsOf was using the validator's node scope instead of the target's scope
    // Setup: two scopes — global has 'a', child scope has 'b'
    // Validator runs on a node in global scope but calls declarationsOf(nodeInChildScope)
    // Must return child scope declarations, not global scope declarations

    const childScopeNode = createMockNode('block', '{ b }', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 5,
    });
    const nameA = createMockNode('identifier', 'a', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const nameB = createMockNode('identifier', 'b', {
      startLine: 1, startChar: 2, endLine: 1, endChar: 3,
    });
    const varDeclNode = createMockNode('variable_decl', 'let a', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 5,
      namedChildren: [(nameA as any)._syntaxNode],
    });
    (nameA as any)._syntaxNode.parent = (varDeclNode as any)._syntaxNode;
    (nameB as any)._syntaxNode.parent = (childScopeNode as any)._syntaxNode;

    const rootNode = createMockNode('program', 'let a\n{ b }', {
      namedChildren: [
        (varDeclNode as any)._syntaxNode,
        (childScopeNode as any)._syntaxNode,
      ],
    });
    (varDeclNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;
    (childScopeNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const globalScope = new Scope('global', rootNode, null);
    const childScope = new Scope('lexical', childScopeNode, globalScope);
    globalScope.declare('a', nameA, 'variable_decl', 'private');
    childScope.declare('b', nameB, 'variable_decl', 'private');

    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);
    nodeScopes.set(varDeclNode.id, globalScope);
    nodeScopes.set(childScopeNode.id, childScope);

    const docScope = createMockDocScope({
      root: globalScope,
      nodeScopes,
    });

    let capturedDeclarations: any[] = [];

    const validation: ValidationDefinition = {
      // Validator runs on variable_decl (in global scope)
      // but calls declarationsOf(childScopeNode) — should get child scope's declarations
      variable_decl: (node: any, ctx: any) => {
        capturedDeclarations = ctx.declarationsOf(childScopeNode);
        // Don't emit a diagnostic — we just want to capture the result
      },
    };

    const document = createMockDocument(rootNode);
    computeDiagnostics(document, docScope, {}, undefined, validation);

    // The fix: declarationsOf should return declarations from the TARGET's scope (child)
    // Before fix: it would return declarations from the validator node's scope (global)
    const names = capturedDeclarations.map((d: any) => d.name);
    expect(names).toContain('b');
    // Child scope also inherits parent declarations via allDeclarations(),
    // but the key assertion is that 'b' IS included (it wouldn't be if using global scope only)
    expect(names).toContain('b');
  });

  it('should support diagnostic options with "at" target node', () => {
    const nameNode = createMockNode('identifier', 'bad', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 7,
    });
    const declNode = createMockNode('variable_decl', 'let bad', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 7,
      namedChildren: [(nameNode as any)._syntaxNode],
      fields: { name: (nameNode as any)._syntaxNode },
    });
    (nameNode as any)._syntaxNode.parent = (declNode as any)._syntaxNode;

    const rootNode = createMockNode('program', 'let bad', {
      namedChildren: [(declNode as any)._syntaxNode],
    });
    (declNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const globalScope = new Scope('global', rootNode, null);
    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({ root: globalScope, nodeScopes });

    const validation: ValidationDefinition = {
      variable_decl: (node: any, ctx: any) => {
        const name = node.field('name');
        ctx.error(node, 'bad name', { at: name, code: 'bad-name' });
      },
    };

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, {}, undefined, validation);

    const diag = diagnostics.find(d => d.code === 'bad-name');
    expect(diag).toBeDefined();
    // "at" redirects the diagnostic range to the name node
    expect(diag?.range.start.character).toBe(4);
  });
});

// ========== DocumentManager Tests ==========

describe('DocumentManager', () => {
  function makeSimpleDocAndScope() {
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode, 'file:///a.ml');
    return { rootNode, document };
  }

  it('should open a document and return scope', () => {
    const mgr = new DocumentManager({});
    const { document } = makeSimpleDocAndScope();

    const scope = mgr.open(document);
    expect(scope).toBeDefined();
    expect(scope.root).toBeDefined();
  });

  it('should get a document after opening', () => {
    const mgr = new DocumentManager({});
    const { document } = makeSimpleDocAndScope();

    mgr.open(document);
    const wsDoc = mgr.get('file:///a.ml');
    expect(wsDoc).not.toBeNull();
    expect(wsDoc?.document).toBe(document);
  });

  it('should return null for unknown URI', () => {
    const mgr = new DocumentManager({});
    expect(mgr.get('file:///nonexistent.ml')).toBeNull();
  });

  it('should handle change (re-scope)', () => {
    const mgr = new DocumentManager({});
    const { document } = makeSimpleDocAndScope();

    mgr.open(document);
    const scope2 = mgr.change(document);
    expect(scope2).toBeDefined();
  });

  it('should close a document', () => {
    const mgr = new DocumentManager({});
    const { document } = makeSimpleDocAndScope();

    mgr.open(document);
    mgr.close('file:///a.ml');
    expect(mgr.get('file:///a.ml')).toBeNull();
  });

  it('should list all documents', () => {
    const mgr = new DocumentManager({});
    const root1 = createMockNode('program', '');
    const root2 = createMockNode('program', '');
    const doc1 = createMockDocument(root1, 'file:///a.ml');
    const doc2 = createMockDocument(root2, 'file:///b.ml');

    mgr.open(doc1);
    mgr.open(doc2);

    expect(mgr.getAllDocuments()).toHaveLength(2);
  });

  it('should clear all documents', () => {
    const mgr = new DocumentManager({});
    const root1 = createMockNode('program', '');
    const doc1 = createMockDocument(root1, 'file:///a.ml');
    mgr.open(doc1);
    mgr.clear();

    expect(mgr.getAllDocuments()).toHaveLength(0);
    expect(mgr.get('file:///a.ml')).toBeNull();
  });

  it('should expose workspace', () => {
    const mgr = new DocumentManager({});
    expect(mgr.getWorkspace()).toBeDefined();
  });
});

// ========== createServer Tests ==========

describe('createServer', () => {
  it('should auto-register unknown documents via getDocScope', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode, 'file:///auto.ml');

    // Calling any handler should auto-register the document
    const diagnostics = server.computeDiagnostics(document);
    expect(diagnostics).toEqual([]);

    // Document should now be in workspace
    expect(server.documents.get('file:///auto.ml')).not.toBeNull();
  });

  it('should re-register stale document when DocumentState changes', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode1 = createMockNode('program', 'v1');
    const doc1 = createMockDocument(rootNode1, 'file:///stale.ml');

    server.documents.open(doc1);

    // Create a new document state for same URI
    const rootNode2 = createMockNode('program', 'v2');
    const doc2 = createMockDocument(rootNode2, 'file:///stale.ml');

    // Handler should detect stale and re-register
    const diagnostics = server.computeDiagnostics(doc2);
    expect(diagnostics).toBeDefined();

    // The workspace should now have doc2
    const wsDoc = server.documents.get('file:///stale.ml');
    expect(wsDoc?.document).toBe(doc2);
  });

  it('should return cached scope for same document', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode, 'file:///cached.ml');

    server.documents.open(document);

    // Multiple calls should reuse scope, not re-register
    server.computeDiagnostics(document);
    server.computeDiagnostics(document);
    expect(server.documents.get('file:///cached.ml')).not.toBeNull();
  });

  it('should wire all handler methods', () => {
    const server = createServer(createMockLanguageDef());

    expect(typeof server.computeDiagnostics).toBe('function');
    expect(typeof server.provideHover).toBe('function');
    expect(typeof server.provideDefinition).toBe('function');
    expect(typeof server.provideReferences).toBe('function');
    expect(typeof server.provideCompletion).toBe('function');
    expect(typeof server.prepareRename).toBe('function');
    expect(typeof server.provideRename).toBe('function');
    expect(typeof server.provideSymbols).toBe('function');
    expect(typeof server.provideSemanticTokensFull).toBe('function');
    expect(typeof server.provideSignatureHelp).toBe('function');
    expect(Array.isArray(server.signatureTriggerCharacters)).toBe(true);
    expect(server.documents).toBeDefined();
  });

  it('should pass through to provideSignatureHelp handler', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode);

    const result = server.provideSignatureHelp(document, { line: 0, character: 0 });
    // No signature descriptors → null
    expect(result).toBeNull();
  });

  it('should collect trigger characters from definition', () => {
    const server = createServer(createMockLanguageDef({
      lsp: {
        function_call: {
          signature: {
            trigger: ['(', ','],
            label: 'fn()',
            params: () => [],
            activeParam: () => 0,
          },
        },
      },
    }));

    expect(server.signatureTriggerCharacters).toContain('(');
    expect(server.signatureTriggerCharacters).toContain(',');
  });

  it('should pass through to provideHover handler', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode);

    const result = server.provideHover(document, { line: 0, character: 0 });
    // Root node → null
    expect(result).toBeNull();
  });

  it('should pass through to provideDefinition handler', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode);

    const result = server.provideDefinition(document, { line: 0, character: 0 });
    expect(result).toBeNull();
  });

  it('should pass through to provideReferences handler', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode);

    const result = server.provideReferences(document, { line: 0, character: 0 });
    expect(result).toEqual([]);
  });

  it('should pass through to provideCompletion handler', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode);

    const result = server.provideCompletion(document, { line: 0, character: 0 });
    expect(Array.isArray(result)).toBe(true);
  });

  it('should pass through to prepareRename handler', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode);

    const result = server.prepareRename(document, { line: 0, character: 0 });
    expect(result).toBeNull();
  });

  it('should pass through to provideRename handler', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode);

    const result = server.provideRename(document, { line: 0, character: 0 }, 'newName');
    expect(result).toBeNull();
  });

  it('should pass through to provideSymbols handler', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode);

    const result = server.provideSymbols(document);
    expect(result).toEqual([]);
  });

  it('should pass through to provideSemanticTokensFull handler', () => {
    const server = createServer(createMockLanguageDef());
    const rootNode = createMockNode('program', '');
    const document = createMockDocument(rootNode);

    const result = server.provideSemanticTokensFull(document);
    expect(result).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });
});

// ========== prepareRename Tests ==========

describe('prepareRename', () => {
  it('should return range and placeholder for a reference', () => {
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

    const result = prepareRename(document, { line: 1, character: 0 }, docScope);

    expect(result).not.toBeNull();
    expect(result?.placeholder).toBe('x');
    expect(result?.range.start.line).toBe(1);
  });

  it('should return range and placeholder for a declaration', () => {
    const declNode = createMockNode('identifier', 'myVar', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 9,
    });

    const decl: Declaration = {
      node: declNode, name: 'myVar', visibility: 'private', declaredBy: 'variable_decl',
    };

    const rootNode = createMockNode('program', '', {
      namedChildren: [(declNode as any)._syntaxNode],
    });
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      declarations: [decl],
    });
    const document = createMockDocument(rootNode);

    const result = prepareRename(document, { line: 0, character: 4 }, docScope);

    expect(result).not.toBeNull();
    expect(result?.placeholder).toBe('myVar');
  });

  it('should return null for non-symbol position', () => {
    const rootNode = createMockNode('program', 'hello');
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const result = prepareRename(document, { line: 0, character: 0 }, docScope);
    expect(result).toBeNull();
  });
});

// ========== Cross-file Rename ==========

describe('provideRename — cross-file', () => {
  it('should rename across workspace documents', () => {
    // Declare x in doc1, reference x in doc2
    const declNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const refNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
    });

    const decl: Declaration = {
      node: declNode, name: 'x', visibility: 'public', declaredBy: 'variable_decl',
    };
    const ref: Reference = {
      node: refNode, name: 'x', to: ['variable_decl'], resolved: decl,
    };

    const rootNode1 = createMockNode('program', 'let x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 5,
      namedChildren: [(declNode as any)._syntaxNode],
    });
    const rootNode2 = createMockNode('program', 'x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
      namedChildren: [(refNode as any)._syntaxNode],
    });

    const docScope1 = createMockDocScope({
      root: new Scope('global', rootNode1, null),
      declarations: [decl],
    });
    const docScope2 = createMockDocScope({
      root: new Scope('global', rootNode2, null),
      references: [ref],
    });

    const doc1 = createMockDocument(rootNode1, 'file:///a.ml');
    const doc2 = createMockDocument(rootNode2, 'file:///b.ml');

    const workspace: Workspace = {
      getAllDocuments: () => [
        { document: doc1, scope: docScope1 },
        { document: doc2, scope: docScope2 },
      ],
      lookupPublic: () => [],
      getAllPublicDeclarations: () => [decl],
    } as unknown as Workspace;

    // Rename from declaration
    const result = provideRename(
      doc1, { line: 0, character: 4 }, 'newX', docScope1, workspace
    );

    expect(result).not.toBeNull();
    // Should have edits in both files
    const editsA = result?.changes['file:///a.ml'];
    const editsB = result?.changes['file:///b.ml'];
    expect(editsA).toBeDefined();
    expect(editsB).toBeDefined();
    expect(editsA?.every(e => e.newText === 'newX')).toBe(true);
    expect(editsB?.every(e => e.newText === 'newX')).toBe(true);
  });
});

// ========== Cross-file Definition ==========

describe('provideDefinition — cross-file', () => {
  it('should resolve definition from another document', () => {
    const declNode = createMockNode('identifier', 'x', {
      startLine: 5, startChar: 4, endLine: 5, endChar: 5,
    });
    const refNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
    });

    const decl: Declaration = {
      node: declNode, name: 'x', visibility: 'public', declaredBy: 'variable_decl',
    };
    const ref: Reference = {
      node: refNode, name: 'x', to: ['variable_decl'], resolved: decl,
    };

    const rootNode2 = createMockNode('program', '', {
      namedChildren: [(refNode as any)._syntaxNode],
    });

    const docScope1 = createMockDocScope({
      root: new Scope('global', null, null),
      declarations: [decl],
    });
    const docScope2 = createMockDocScope({
      root: new Scope('global', rootNode2, null),
      references: [ref],
    });

    const doc1 = createMockDocument(createMockNode('program', ''), 'file:///a.ml');
    const doc2 = createMockDocument(rootNode2, 'file:///b.ml');

    const workspace: Workspace = {
      getAllDocuments: () => [
        { document: doc1, scope: docScope1 },
        { document: doc2, scope: docScope2 },
      ],
    } as unknown as Workspace;

    const result = provideDefinition(doc2, { line: 0, character: 0 }, docScope2, workspace);

    expect(result).not.toBeNull();
    expect(result?.uri).toBe('file:///a.ml');
    expect(result?.range.start.line).toBe(5);
  });
});

// ========== Cross-file References ==========

describe('provideReferences — cross-file', () => {
  it('should collect references from all workspace documents', () => {
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
      node: declNode, name: 'x', visibility: 'public', declaredBy: 'variable_decl',
    };
    const ref1: Reference = {
      node: refNode1, name: 'x', to: ['variable_decl'], resolved: decl,
    };
    const ref2: Reference = {
      node: refNode2, name: 'x', to: ['variable_decl'], resolved: decl,
    };

    const rootNode1 = createMockNode('program', '', {
      namedChildren: [(declNode as any)._syntaxNode],
    });

    const docScope1 = createMockDocScope({
      root: new Scope('global', rootNode1, null),
      declarations: [decl],
      references: [ref1],
    });
    const docScope2 = createMockDocScope({
      root: new Scope('global', null, null),
      references: [ref2],
    });

    const doc1 = createMockDocument(rootNode1, 'file:///a.ml');
    const doc2 = createMockDocument(createMockNode('program', ''), 'file:///b.ml');

    const workspace: Workspace = {
      getAllDocuments: () => [
        { document: doc1, scope: docScope1 },
        { document: doc2, scope: docScope2 },
      ],
    } as unknown as Workspace;

    const result = provideReferences(
      doc1, { line: 0, character: 4 }, docScope1, workspace
    );

    expect(result).toHaveLength(2);
    const uris = result.map(r => r.uri);
    expect(uris).toContain('file:///a.ml');
    expect(uris).toContain('file:///b.ml');
  });

  it('should find references when starting from a reference node', () => {
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
      declarations: [decl],
    });
    const document = createMockDocument(rootNode);

    // Query from the reference position (not declaration)
    const result = provideReferences(
      document, { line: 1, character: 0 }, docScope
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.range.start.line).toBe(1);
  });
});

// ========== Hover: Reference → Declaration ==========

describe('provideHover — reference paths', () => {
  it('should show declaration hover when hovering over a reference', () => {
    const declNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const refNode = createMockNode('identifier', 'x', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 1,
    });
    const varDeclNode = createMockNode('variable_decl', 'let x = 1', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 10,
    });
    (declNode as any)._syntaxNode.parent = (varDeclNode as any)._syntaxNode;

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

    const result = provideHover(
      document, { line: 1, character: 0 }, docScope, {}
    );

    expect(result).not.toBeNull();
    expect(result?.contents).toContain('variable_decl');
    expect(result?.contents).toContain('x');
  });

  it('should return null for unresolved reference hover', () => {
    const refNode = createMockNode('identifier', 'unknown', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 7,
    });

    const ref: Reference = {
      node: refNode, name: 'unknown', to: ['variable_decl'], resolved: null,
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

    const result = provideHover(
      document, { line: 0, character: 0 }, docScope, {}
    );

    expect(result).toBeNull();
  });

  it('should use custom hover for reference via declaration type', () => {
    const declNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const varDeclNode = createMockNode('variable_decl', 'let x = 1', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 10,
    });
    (declNode as any)._syntaxNode.parent = (varDeclNode as any)._syntaxNode;

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

    const lsp: LspDefinition = {
      variable_decl: {
        hover: () => '**type**: number',
      },
    };

    const document = createMockDocument(rootNode);
    const result = provideHover(
      document, { line: 1, character: 0 }, docScope, {}, lsp
    );

    expect(result?.contents).toBe('**type**: number');
  });

  it('should fall through to default when custom hover returns null', () => {
    const declNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 4, endLine: 0, endChar: 5,
    });
    const varDeclNode = createMockNode('variable_decl', 'let x = 1', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 10,
    });
    (declNode as any)._syntaxNode.parent = (varDeclNode as any)._syntaxNode;

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

    const lsp: LspDefinition = {
      variable_decl: {
        hover: () => null,
      },
    };

    const document = createMockDocument(rootNode);
    const result = provideHover(
      document, { line: 1, character: 0 }, docScope, {}, lsp
    );

    // Falls through to default hover
    expect(result).not.toBeNull();
    expect(result?.contents).toContain('variable_decl');
    expect(result?.contents).toContain('x');
  });

  it('should return null when no reference or declaration found', () => {
    const identNode = createMockNode('identifier', 'nothing', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 7,
    });
    const rootNode = createMockNode('program', 'nothing', {
      namedChildren: [(identNode as any)._syntaxNode],
    });

    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const result = provideHover(
      document, { line: 0, character: 0 }, docScope, {}
    );

    expect(result).toBeNull();
  });
});

// ========== Completion: Custom Handlers ==========

describe('provideCompletion — custom handlers', () => {
  it('should use custom complete handler returning array', () => {
    const identNode = createMockNode('expression', 'x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
    });
    const rootNode = createMockNode('program', 'x', {
      namedChildren: [(identNode as any)._syntaxNode],
    });
    (identNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const globalScope = new Scope('global', rootNode, null);
    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({
      root: globalScope,
      nodeScopes,
    });

    const lsp: LspDefinition = {
      expression: {
        complete: () => [
          { label: 'custom1' },
          { label: 'custom2' },
        ],
      },
    };

    const document = createMockDocument(rootNode);
    const result = provideCompletion(
      document, { line: 0, character: 0 }, docScope, {}, lsp
    );

    const labels = result.map(i => i.label);
    expect(labels).toContain('custom1');
    expect(labels).toContain('custom2');
  });

  it('should support replace mode from custom handler', () => {
    const identNode = createMockNode('expression', 'x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
    });
    const rootNode = createMockNode('program', 'x', {
      namedChildren: [(identNode as any)._syntaxNode],
    });
    (identNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const globalScope = new Scope('global', rootNode, null);
    const xNode = createMockNode('identifier', 'shouldNotAppear');
    globalScope.declare('shouldNotAppear', xNode, 'variable_decl', 'private');

    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({
      root: globalScope,
      nodeScopes,
    });

    const lsp: LspDefinition = {
      expression: {
        complete: () => ({
          items: [{ label: 'only_this' }],
          replace: true,
        }),
      },
    };

    const document = createMockDocument(rootNode);
    const result = provideCompletion(
      document, { line: 0, character: 0 }, docScope, {}, lsp
    );

    // Replace mode: only custom items, no scope-based completions
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('only_this');
  });

  it('should deduplicate completion items by label', () => {
    const rootNode = createMockNode('program', '');
    const globalScope = new Scope('global', rootNode, null);

    const xNode1 = createMockNode('identifier', 'x');
    const xNode2 = createMockNode('identifier', 'x');
    globalScope.declare('x', xNode1, 'variable_decl', 'private');
    globalScope.declare('x', xNode2, 'function_decl', 'private');

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

    // Should only have one "x" entry (deduplication by label)
    const xItems = result.filter(i => i.label === 'x');
    expect(xItems).toHaveLength(1);
  });

  it('should include workspace public declarations', () => {
    const rootNode = createMockNode('program', '');
    const globalScope = new Scope('global', rootNode, null);

    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({
      root: globalScope,
      nodeScopes,
    });

    const pubDeclNode = createMockNode('identifier', 'publicFn');
    const workspace: Workspace = {
      getAllDocuments: () => [],
      getAllPublicDeclarations: () => [
        { node: pubDeclNode, name: 'publicFn', visibility: 'public' as const, declaredBy: 'function_decl' },
      ],
      lookupPublic: () => [],
    } as unknown as Workspace;

    const document = createMockDocument(rootNode);
    const result = provideCompletion(
      document, { line: 0, character: 0 }, docScope, {}, undefined, workspace
    );

    const labels = result.map(i => i.label);
    expect(labels).toContain('publicFn');
  });

  it('should walk up node tree for custom handler', () => {
    const leafNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
    });
    const parentNode = createMockNode('expression', 'x + 1', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 5,
      namedChildren: [(leafNode as any)._syntaxNode],
    });
    (leafNode as any)._syntaxNode.parent = (parentNode as any)._syntaxNode;
    const rootNode = createMockNode('program', 'x + 1', {
      namedChildren: [(parentNode as any)._syntaxNode],
    });
    (parentNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const globalScope = new Scope('global', rootNode, null);
    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({
      root: globalScope,
      nodeScopes,
    });

    const lsp: LspDefinition = {
      // Handler on parent type, not leaf type
      expression: {
        complete: () => [{ label: 'fromParent' }],
      },
    };

    const document = createMockDocument(rootNode);
    const result = provideCompletion(
      document, { line: 0, character: 0 }, docScope, {}, lsp
    );

    const labels = result.map(i => i.label);
    expect(labels).toContain('fromParent');
  });

  it('should include keyword documentation', () => {
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
        'fn': { detail: 'Declare function', documentation: 'Defines a new function' },
      },
    } as LspDefinition;

    const document = createMockDocument(rootNode);
    const result = provideCompletion(
      document, { line: 0, character: 0 }, docScope, {}, lsp
    );

    const fnItem = result.find(i => i.label === 'fn');
    expect(fnItem?.detail).toBe('Declare function');
    expect(fnItem?.documentation).toBe('Defines a new function');
    expect(fnItem?.kind).toBe('Keyword');
  });
});

// ========== Completion Trigger Character Tests ==========

describe('getCompletionTriggerCharacters', () => {
  it('should return empty array when no LSP config', () => {
    expect(getCompletionTriggerCharacters(undefined)).toEqual([]);
  });

  it('should return empty array when no completionTrigger defined', () => {
    const lsp: LspDefinition = {
      variable_decl: { completionKind: 'Variable' },
    };
    expect(getCompletionTriggerCharacters(lsp)).toEqual([]);
  });

  it('should collect trigger characters from rules', () => {
    const lsp: LspDefinition = {
      member_expr: {
        completionTrigger: ['.'],
      },
    };
    const triggers = getCompletionTriggerCharacters(lsp);
    expect(triggers).toContain('.');
    expect(triggers).toHaveLength(1);
  });

  it('should deduplicate trigger characters across rules', () => {
    const lsp: LspDefinition = {
      member_expr: {
        completionTrigger: ['.', '['],
      },
      import_path: {
        completionTrigger: ['.', '/'],
      },
    };
    const triggers = getCompletionTriggerCharacters(lsp);
    expect(triggers).toHaveLength(3); // '.', '[', '/' — deduped
    expect(triggers).toContain('.');
    expect(triggers).toContain('[');
    expect(triggers).toContain('/');
  });

  it('should skip $-prefixed keys', () => {
    const lsp = {
      $keywords: { let: { detail: 'Declare' } },
      member_expr: {
        completionTrigger: ['.'],
      },
    } as LspDefinition;
    const triggers = getCompletionTriggerCharacters(lsp);
    expect(triggers).toEqual(['.']);
  });
});

// ========== Signature Help Tests ==========

describe('getSignatureTriggerCharacters', () => {
  it('should return empty array when no LSP config', () => {
    expect(getSignatureTriggerCharacters(undefined)).toEqual([]);
  });

  it('should return empty array when no signature descriptors', () => {
    const lsp: LspDefinition = {
      variable_decl: { completionKind: 'Variable' },
    };
    expect(getSignatureTriggerCharacters(lsp)).toEqual([]);
  });

  it('should collect trigger characters from signature descriptors', () => {
    const lsp: LspDefinition = {
      function_call: {
        signature: {
          trigger: ['(', ','],
          label: 'fn()',
          params: () => [],
          activeParam: () => 0,
        },
      },
    };
    const triggers = getSignatureTriggerCharacters(lsp);
    expect(triggers).toContain('(');
    expect(triggers).toContain(',');
    expect(triggers).toHaveLength(2);
  });

  it('should deduplicate trigger characters across rules', () => {
    const lsp: LspDefinition = {
      function_call: {
        signature: {
          trigger: ['(', ','],
          label: 'fn()',
          params: () => [],
          activeParam: () => 0,
        },
      },
      method_call: {
        signature: {
          trigger: ['(', ','],
          label: 'method()',
          params: () => [],
          activeParam: () => 0,
        },
      },
    };
    const triggers = getSignatureTriggerCharacters(lsp);
    expect(triggers).toHaveLength(2); // Deduped, not 4
  });

  it('should skip $-prefixed keys', () => {
    const lsp = {
      $keywords: { let: { detail: 'Declare' } },
      function_call: {
        signature: {
          trigger: ['('],
          label: 'fn()',
          params: () => [],
          activeParam: () => 0,
        },
      },
    } as LspDefinition;
    const triggers = getSignatureTriggerCharacters(lsp);
    expect(triggers).toEqual(['(']);
  });
});

describe('provideSignatureHelp', () => {
  it('should return null when no LSP config', () => {
    const rootNode = createMockNode('program', '');
    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const result = provideSignatureHelp(document, { line: 0, character: 0 }, docScope);
    expect(result).toBeNull();
  });

  it('should return null when no signature descriptor matches', () => {
    const identNode = createMockNode('identifier', 'x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
    });
    const rootNode = createMockNode('program', 'x', {
      namedChildren: [(identNode as any)._syntaxNode],
      children: [(identNode as any)._syntaxNode],
    });
    (identNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({ root: globalScope });
    const document = createMockDocument(rootNode);

    const lsp: LspDefinition = {
      function_decl: { completionKind: 'Function' }, // No signature descriptor
    };

    const result = provideSignatureHelp(document, { line: 0, character: 0 }, docScope, lsp);
    expect(result).toBeNull();
  });

  it('should return signature when reference resolves to declaration with signature', () => {
    // Setup: call_expr with a reference child "add" that resolves to a function_decl
    // call_expr: add(1, 2)   —   children: [refNode("add"), "(", "1", ",", "2", ")"]
    const declNameNode = createMockNode('identifier', 'add', {
      startLine: 0, startChar: 3, endLine: 0, endChar: 6,
    });
    const funcDeclNode = createMockNode('function_decl', 'fn add(a, b)', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 12,
      namedChildren: [(declNameNode as any)._syntaxNode],
    });
    (declNameNode as any)._syntaxNode.parent = (funcDeclNode as any)._syntaxNode;

    const refNode = createMockNode('identifier', 'add', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 3,
    });
    const commaNode = createMockNode(',', ',', {
      startLine: 1, startChar: 5, endLine: 1, endChar: 6,
      isNamed: false,
    });
    const callNode = createMockNode('call_expr', 'add(1, 2)', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 9,
      children: [(refNode as any)._syntaxNode, (commaNode as any)._syntaxNode],
      namedChildren: [(refNode as any)._syntaxNode],
    });
    (refNode as any)._syntaxNode.parent = (callNode as any)._syntaxNode;
    (commaNode as any)._syntaxNode.parent = (callNode as any)._syntaxNode;

    const rootNode = createMockNode('program', 'fn add(a, b)\nadd(1, 2)', {
      children: [(callNode as any)._syntaxNode],
      namedChildren: [(callNode as any)._syntaxNode],
    });
    (callNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const decl: Declaration = {
      node: declNameNode, name: 'add', visibility: 'public', declaredBy: 'function_decl',
    };
    const ref: Reference = {
      node: refNode, name: 'add', to: ['function_decl'], resolved: decl,
    };

    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref],
      declarations: [decl],
    });

    const lsp: LspDefinition = {
      function_decl: {
        signature: {
          trigger: ['(', ','],
          label: (node: any) => `fn ${node.text}`,
          params: () => [
            { label: 'a', documentation: 'First param' },
            { label: 'b', documentation: 'Second param' },
          ],
          activeParam: (_node: any, commaCount: number) => commaCount,
        },
      },
    };

    const document = createMockDocument(rootNode);

    // Cursor after the comma (position 1:6) — should be on param index 1
    const result = provideSignatureHelp(
      document, { line: 1, character: 6 }, docScope, lsp
    );

    expect(result).not.toBeNull();
    expect(result?.signatures).toHaveLength(1);
    expect(result?.signatures[0]?.label).toBe('fn fn add(a, b)');
    expect(result?.signatures[0]?.parameters).toHaveLength(2);
    expect(result?.signatures[0]?.parameters[0]?.label).toBe('a');
    expect(result?.activeSignature).toBe(0);
    expect(result?.activeParameter).toBe(1); // After one comma
  });

  it('should count commas inside argument_list (nested comma structure)', () => {
    // Mirrors real mini-lang AST: call_expr > argument_list > commas
    // call_expr children: [identifier "add", "(", argument_list, ")"]
    // argument_list children: [identifier "x", ",", identifier "y"]
    const declNameNode = createMockNode('identifier', 'add', {
      startLine: 0, startChar: 3, endLine: 0, endChar: 6,
    });
    const funcDeclNode = createMockNode('function_decl', 'fn add(a, b)', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 12,
      namedChildren: [(declNameNode as any)._syntaxNode],
    });
    (declNameNode as any)._syntaxNode.parent = (funcDeclNode as any)._syntaxNode;

    const refNode = createMockNode('identifier', 'add', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 3,
    });
    const argX = createMockNode('identifier', 'x', {
      startLine: 1, startChar: 4, endLine: 1, endChar: 5,
    });
    const commaNode = createMockNode(',', ',', {
      startLine: 1, startChar: 5, endLine: 1, endChar: 6,
      isNamed: false,
    });
    const argY = createMockNode('identifier', 'y', {
      startLine: 1, startChar: 7, endLine: 1, endChar: 8,
    });
    const argList = createMockNode('argument_list', 'x, y', {
      startLine: 1, startChar: 4, endLine: 1, endChar: 8,
      children: [(argX as any)._syntaxNode, (commaNode as any)._syntaxNode, (argY as any)._syntaxNode],
      namedChildren: [(argX as any)._syntaxNode, (argY as any)._syntaxNode],
    });
    (argX as any)._syntaxNode.parent = (argList as any)._syntaxNode;
    (commaNode as any)._syntaxNode.parent = (argList as any)._syntaxNode;
    (argY as any)._syntaxNode.parent = (argList as any)._syntaxNode;

    const openParen = createMockNode('(', '(', {
      startLine: 1, startChar: 3, endLine: 1, endChar: 4,
      isNamed: false,
    });
    const closeParen = createMockNode(')', ')', {
      startLine: 1, startChar: 8, endLine: 1, endChar: 9,
      isNamed: false,
    });
    const callNode = createMockNode('call_expr', 'add(x, y)', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 9,
      children: [
        (refNode as any)._syntaxNode,
        (openParen as any)._syntaxNode,
        (argList as any)._syntaxNode,
        (closeParen as any)._syntaxNode,
      ],
      namedChildren: [(refNode as any)._syntaxNode, (argList as any)._syntaxNode],
    });
    (refNode as any)._syntaxNode.parent = (callNode as any)._syntaxNode;
    (openParen as any)._syntaxNode.parent = (callNode as any)._syntaxNode;
    (argList as any)._syntaxNode.parent = (callNode as any)._syntaxNode;
    (closeParen as any)._syntaxNode.parent = (callNode as any)._syntaxNode;

    const rootNode = createMockNode('program', 'fn add(a, b)\nadd(x, y)', {
      children: [(callNode as any)._syntaxNode],
      namedChildren: [(callNode as any)._syntaxNode],
    });
    (callNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const decl: Declaration = {
      node: declNameNode, name: 'add', visibility: 'public', declaredBy: 'function_decl',
    };
    const ref: Reference = {
      node: refNode, name: 'add', to: ['function_decl'], resolved: decl,
    };

    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref],
      declarations: [decl],
    });

    const lsp: LspDefinition = {
      function_decl: {
        signature: {
          trigger: ['(', ','],
          label: 'add(a, b)',
          params: () => [{ label: 'a' }, { label: 'b' }],
          activeParam: (_node: any, commaCount: number) => commaCount,
        },
      },
    };

    const document = createMockDocument(rootNode);

    // Cursor on first arg "x" at 1:4 — should be param 0
    const result0 = provideSignatureHelp(
      document, { line: 1, character: 4 }, docScope, lsp
    );
    expect(result0).not.toBeNull();
    expect(result0?.activeParameter).toBe(0);

    // Cursor on second arg "y" at 1:7 (after the comma) — should be param 1
    const result1 = provideSignatureHelp(
      document, { line: 1, character: 7 }, docScope, lsp
    );
    expect(result1).not.toBeNull();
    expect(result1?.activeParameter).toBe(1);

    // Cursor in space after comma "add(x, |)" at 1:6 — cursor is past
    // argument_list's end but should still count the comma → param 1
    const result1space = provideSignatureHelp(
      document, { line: 1, character: 6 }, docScope, lsp
    );
    expect(result1space).not.toBeNull();
    expect(result1space?.activeParameter).toBe(1);
  });

  it('should return activeParameter 0 when no commas before cursor', () => {
    // Same setup but cursor is before the comma
    const declNameNode = createMockNode('identifier', 'add', {
      startLine: 0, startChar: 3, endLine: 0, endChar: 6,
    });
    const funcDeclNode = createMockNode('function_decl', 'fn add(a, b)', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 12,
      namedChildren: [(declNameNode as any)._syntaxNode],
    });
    (declNameNode as any)._syntaxNode.parent = (funcDeclNode as any)._syntaxNode;

    const refNode = createMockNode('identifier', 'add', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 3,
    });
    const callNode = createMockNode('call_expr', 'add(1)', {
      startLine: 1, startChar: 0, endLine: 1, endChar: 6,
      children: [(refNode as any)._syntaxNode],
      namedChildren: [(refNode as any)._syntaxNode],
    });
    (refNode as any)._syntaxNode.parent = (callNode as any)._syntaxNode;

    const rootNode = createMockNode('program', 'fn add(a, b)\nadd(1)', {
      children: [(callNode as any)._syntaxNode],
      namedChildren: [(callNode as any)._syntaxNode],
    });
    (callNode as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const decl: Declaration = {
      node: declNameNode, name: 'add', visibility: 'public', declaredBy: 'function_decl',
    };
    const ref: Reference = {
      node: refNode, name: 'add', to: ['function_decl'], resolved: decl,
    };

    const globalScope = new Scope('global', rootNode, null);
    const docScope = createMockDocScope({
      root: globalScope,
      references: [ref],
      declarations: [decl],
    });

    const lsp: LspDefinition = {
      function_decl: {
        signature: {
          trigger: ['('],
          label: 'add(a, b)',
          params: () => [
            { label: 'a' },
            { label: 'b' },
          ],
          activeParam: (_node: any, commaCount: number) => commaCount,
        },
      },
    };

    const document = createMockDocument(rootNode);
    const result = provideSignatureHelp(
      document, { line: 1, character: 4 }, docScope, lsp
    );

    expect(result).not.toBeNull();
    expect(result?.activeParameter).toBe(0); // No commas before cursor
    // String label (not function)
    expect(result?.signatures[0]?.label).toBe('add(a, b)');
  });
});

// ========== Code Actions Tests ==========

describe('provideCodeActions', () => {
  it('returns code action for diagnostic with fix', () => {
    const actions = provideCodeActions(
      [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        severity: 'error',
        message: 'Bad name',
        code: 'bad-name',
        fix: {
          label: 'Rename to good',
          edits: [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            newText: 'good',
          }],
        },
      }],
      { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      'file:///test.ml',
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]!.title).toBe('Rename to good');
    expect(actions[0]!.kind).toBe('quickfix');
    expect(actions[0]!.edit.changes['file:///test.ml']).toHaveLength(1);
    expect(actions[0]!.edit.changes['file:///test.ml']![0]!.newText).toBe('good');
  });

  it('returns empty for diagnostic without fix', () => {
    const actions = provideCodeActions(
      [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        severity: 'error',
        message: 'Syntax error',
      }],
      { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      'file:///test.ml',
    );

    expect(actions).toHaveLength(0);
  });

  it('filters diagnostics outside requested range', () => {
    const actions = provideCodeActions(
      [{
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } },
        severity: 'warning',
        message: 'Unused',
        fix: { label: 'Remove', edits: [{ range: { start: { line: 5, character: 0 }, end: { line: 5, character: 3 } }, newText: '' }] },
      }],
      { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      'file:///test.ml',
    );

    expect(actions).toHaveLength(0);
  });

  it('includes diagnostic in code action for editor matching', () => {
    const diag = {
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
      severity: 'error' as const,
      message: 'Bad',
      fix: {
        label: 'Fix it',
        edits: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: 'good' }],
      },
    };

    const actions = provideCodeActions(
      [diag],
      { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
      'file:///test.ml',
    );

    expect(actions[0]!.diagnostics).toHaveLength(1);
    expect(actions[0]!.diagnostics[0]!.message).toBe('Bad');
  });
});

describe('computeDiagnostics — fix preservation', () => {
  it('preserves fix field from validation options', () => {
    const node = createMockNode('bad_node', 'x', {
      startLine: 0, startChar: 0, endLine: 0, endChar: 1,
    });
    const rootNode = createMockNode('program', 'x', {
      namedChildren: [(node as any)._syntaxNode],
    });
    (node as any)._syntaxNode.parent = (rootNode as any)._syntaxNode;

    const globalScope = new Scope('global', rootNode, null);
    const nodeScopes = new Map<number, Scope>();
    nodeScopes.set(rootNode.id, globalScope);

    const docScope = createMockDocScope({ root: globalScope, nodeScopes });

    const validation: ValidationDefinition = {
      bad_node: (n: any, ctx: any) => {
        ctx.error(n, 'Bad node', {
          code: 'bad',
          fix: {
            label: 'Fix bad node',
            edits: [{
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              newText: 'y',
            }],
          },
        });
      },
    };

    const document = createMockDocument(rootNode);
    const diagnostics = computeDiagnostics(document, docScope, {}, undefined, validation);

    const diag = diagnostics.find(d => d.code === 'bad');
    expect(diag).toBeDefined();
    expect(diag?.fix).toBeDefined();
    expect(diag?.fix?.label).toBe('Fix bad node');
    expect(diag?.fix?.edits).toHaveLength(1);
    expect(diag?.fix?.edits[0]!.newText).toBe('y');
  });
});
