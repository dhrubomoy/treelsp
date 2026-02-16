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
});
