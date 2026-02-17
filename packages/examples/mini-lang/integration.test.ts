/**
 * Live integration tests for mini-lang
 * Requires grammar.wasm — run "treelsp build" first
 * Skipped automatically if grammar.wasm is not found
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocumentState, createServer } from 'treelsp/runtime';
import type { DocumentState, LanguageService } from 'treelsp/runtime';
import definition from './grammar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, 'generated', 'grammar.wasm');
const testMiniPath = resolve(__dirname, 'test.mini');
const hasWasm = existsSync(wasmPath);

describe.skipIf(!hasWasm)('mini-lang integration (live WASM)', () => {
  // ========== Parser Tests ==========

  describe('parser', () => {
    let doc: DocumentState;

    beforeAll(async () => {
      const source = readFileSync(testMiniPath, 'utf-8');
      doc = await createDocumentState(
        wasmPath,
        { uri: 'file:///test.mini', version: 1, languageId: 'minilang' },
        source,
      );
    });

    afterAll(() => {
      doc?.dispose();
    });

    it('loads grammar.wasm and parses test.mini', () => {
      expect(doc.root).toBeDefined();
      expect(doc.root.type).toBe('program');
    });

    it('root has no errors', () => {
      expect(doc.hasErrors).toBe(false);
    });

    it('parses all 8 variable declarations', () => {
      const varDecls = doc.root.descendantsOfType('variable_decl');
      expect(varDecls).toHaveLength(8);
    });

    it('variable_decl has name and value fields', () => {
      const varDecls = doc.root.descendantsOfType('variable_decl');
      const first = varDecls[0]!;
      expect(first.field('name')!.text).toBe('x');
      expect(first.field('value')!.text).toBe('10');
    });

    it('parses string literal values', () => {
      const varDecls = doc.root.descendantsOfType('variable_decl');
      const greeting = varDecls.find(v => v.field('name')!.text === 'greeting');
      expect(greeting).toBeDefined();
      expect(greeting!.field('value')!.text).toBe('"hello world"');
    });

    it('parses binary expressions with correct structure', () => {
      const binaryExprs = doc.root.descendantsOfType('binary_expr');
      expect(binaryExprs.length).toBeGreaterThan(0);
      const sumExpr = binaryExprs[0]!;
      expect(sumExpr.field('left')).not.toBeNull();
      expect(sumExpr.field('right')).not.toBeNull();
    });

    it('parses function declarations', () => {
      const fnDecls = doc.root.descendantsOfType('function_decl');
      expect(fnDecls).toHaveLength(2);
      const addFn = fnDecls[0]!;
      expect(addFn.field('name')!.text).toBe('add');
      expect(addFn.field('params')).not.toBeNull();
      expect(addFn.field('body')).not.toBeNull();
    });

    it('parses function parameters', () => {
      const params = doc.root.descendantsOfType('parameter');
      // add(a, b) + greet(name) = 3 params
      expect(params).toHaveLength(3);
      expect(params[0]!.field('name')!.text).toBe('a');
      expect(params[1]!.field('name')!.text).toBe('b');
      expect(params[2]!.field('name')!.text).toBe('name');
    });

    it('parses function call expressions', () => {
      const calls = doc.root.descendantsOfType('call_expr');
      expect(calls).toHaveLength(2);
      expect(calls[0]!.field('callee')!.text).toBe('add');
      expect(calls[1]!.field('callee')!.text).toBe('greet');
    });

    it('parses return statements', () => {
      const returns = doc.root.descendantsOfType('return_statement');
      expect(returns).toHaveLength(2);
      expect(returns[0]!.field('value')).not.toBeNull();
    });

    it('detects parse errors in malformed input', async () => {
      const badDoc = await createDocumentState(
        wasmPath,
        { uri: 'file:///bad.mini', version: 1, languageId: 'minilang' },
        'let = ;',
      );
      try {
        expect(badDoc.hasErrors).toBe(true);
      } finally {
        badDoc.dispose();
      }
    });
  });

  // ========== LSP Handler Tests ==========

  describe('LSP handlers', () => {
    let doc: DocumentState;
    let service: LanguageService;

    beforeAll(async () => {
      const source = readFileSync(testMiniPath, 'utf-8');
      doc = await createDocumentState(
        wasmPath,
        { uri: 'file:///test.mini', version: 1, languageId: 'minilang' },
        source,
      );
      service = createServer(definition);
      service.documents.open(doc);
    });

    afterAll(() => {
      doc?.dispose();
    });

    it('computes diagnostics without errors for valid file', () => {
      const diags = service.computeDiagnostics(doc);
      expect(Array.isArray(diags)).toBe(true);
      // All references in test.mini should resolve
      const errors = diags.filter(d => d.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('provides hover on variable declaration name', () => {
      const varDecls = doc.root.descendantsOfType('variable_decl');
      const nameNode = varDecls[0]!.field('name')!;
      const hover = service.provideHover(doc, nameNode.startPosition);
      expect(hover).not.toBeNull();
    });

    it('provides definition for variable reference', () => {
      // Find 'x' identifiers — the ones in binary expressions are references
      const identifiers = doc.root.descendantsOfType('identifier');
      const xNodes = identifiers.filter(id => id.text === 'x');
      // First 'x' is the declaration name, subsequent are references
      expect(xNodes.length).toBeGreaterThan(1);
      const xRef = xNodes[1]!;
      const defResult = service.provideDefinition(doc, xRef.startPosition);
      expect(defResult).not.toBeNull();
    });

    it('provides completions with declared variables and keywords', () => {
      const completions = service.provideCompletion(
        doc,
        { line: 4, character: 10 },
      );
      expect(completions.length).toBeGreaterThan(0);
      const labels = completions.map(c => c.label);
      expect(labels).toContain('let');
      expect(labels).toContain('fn');
      expect(labels).toContain('return');
    });

    it('provides document symbols for all declarations', () => {
      const symbols = service.provideSymbols(doc);
      // 7 variables + 2 functions = 9 declarations with symbols
      expect(symbols.length).toBeGreaterThanOrEqual(9);
    });

    it('provides references for declared variable', () => {
      const varDecls = doc.root.descendantsOfType('variable_decl');
      const nameNode = varDecls[0]!.field('name')!;
      const refs = service.provideReferences(doc, nameNode.startPosition);
      // 'x' is used in sum and product and complex
      expect(refs.length).toBeGreaterThanOrEqual(1);
    });

    it('provides rename for variable declaration', () => {
      const varDecls = doc.root.descendantsOfType('variable_decl');
      const nameNode = varDecls[0]!.field('name')!;
      const result = service.provideRename(doc, nameNode.startPosition, 'newX');
      expect(result).not.toBeNull();
      const edits = result!.changes[doc.uri];
      expect(edits).toBeDefined();
      expect(edits!.length).toBeGreaterThanOrEqual(2);
      for (const edit of edits!) {
        expect(edit.newText).toBe('newX');
      }
    });

    it('provides rename for variable reference', () => {
      const identifiers = doc.root.descendantsOfType('identifier');
      const xNodes = identifiers.filter(id => id.text === 'x');
      expect(xNodes.length).toBeGreaterThan(1);
      const xRef = xNodes[1]!;
      const result = service.provideRename(doc, xRef.startPosition, 'renamedX');
      expect(result).not.toBeNull();
      const edits = result!.changes[doc.uri];
      expect(edits).toBeDefined();
      expect(edits!.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========== Cross-file Resolution Tests ==========

  describe('cross-file resolution', () => {
    let doc1: DocumentState;
    let doc2: DocumentState;
    let service: LanguageService;

    afterAll(() => {
      doc1?.dispose();
      doc2?.dispose();
    });

    it('indexes public declarations in workspace', async () => {
      // File 1 declares a global variable with visibility: 'public'
      const source1 = readFileSync(testMiniPath, 'utf-8');
      doc1 = await createDocumentState(
        wasmPath,
        { uri: 'file:///test.mini', version: 1, languageId: 'minilang' },
        source1,
      );

      // File 2 references globalVar from file 1
      const test2Path = resolve(__dirname, 'test2.mini');
      const source2 = readFileSync(test2Path, 'utf-8');
      doc2 = await createDocumentState(
        wasmPath,
        { uri: 'file:///test2.mini', version: 1, languageId: 'minilang' },
        source2,
      );

      service = createServer(definition);
      service.documents.open(doc1);

      const workspace = service.documents.getWorkspace();
      const stats = workspace.getStats();
      expect(stats.publicDeclarationCount).toBeGreaterThan(0);

      const publicDecls = workspace.lookupPublic('globalVar');
      expect(publicDecls).toHaveLength(1);
      expect(publicDecls[0]!.declaredBy).toBe('global_var_decl');
    });

    it('resolves public declaration from another file', () => {
      service.documents.open(doc2);

      // Check that doc2's scope resolved the cross-file reference
      const wsDoc2 = service.documents.get('file:///test2.mini');
      const unresolvedRefs = wsDoc2!.scope.references.filter(r => !r.resolved);
      expect(unresolvedRefs).toHaveLength(0);

      // test2.mini should have no unresolved reference errors
      const diags = service.computeDiagnostics(doc2);
      const unresolvedErrors = diags.filter(
        d => d.code === 'unresolved-reference'
      );
      expect(unresolvedErrors).toHaveLength(0);
    });

    it('resolves when file with reference is opened before declaring file', () => {
      const service2 = createServer(definition);

      // Open file 2 FIRST (references globalVar)
      service2.documents.open(doc2);

      // At this point globalVar is unresolved
      const diagsBefore = service2.computeDiagnostics(doc2);
      const unresolvedBefore = diagsBefore.filter(
        d => d.code === 'unresolved-reference'
      );
      expect(unresolvedBefore).toHaveLength(1);

      // Now open file 1 (declares globalVar)
      service2.documents.open(doc1);

      // After opening file 1, file 2 should resolve globalVar
      const diagsAfter = service2.computeDiagnostics(doc2);
      const unresolvedAfter = diagsAfter.filter(
        d => d.code === 'unresolved-reference'
      );
      expect(unresolvedAfter).toHaveLength(0);
    });

    it('provides completion for cross-file public declarations', () => {
      const completions = service.provideCompletion(
        doc2,
        { line: 0, character: 10 },
      );
      const labels = completions.map(c => c.label);
      expect(labels).toContain('globalVar');
    });

    it('go-to-definition navigates to the declaring file', () => {
      // In test2.mini, globalVar is at line 0, character 8-17
      const defResult = service.provideDefinition(
        doc2,
        { line: 0, character: 10 },
      );
      expect(defResult).not.toBeNull();
      // Should point to test.mini, NOT test2.mini
      expect(defResult!.uri).toBe('file:///test.mini');
    });
  });
});
