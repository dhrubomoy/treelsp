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

    it('parses all 5 variable declarations', () => {
      const varDecls = doc.root.descendantsOfType('variable_decl');
      expect(varDecls).toHaveLength(5);
    });

    it('variable_decl has name and value fields', () => {
      const varDecls = doc.root.descendantsOfType('variable_decl');
      const first = varDecls[0]!;
      expect(first.field('name')!.text).toBe('x');
      expect(first.field('value')!.text).toBe('10');
    });

    it('parses binary expressions with correct structure', () => {
      // "let sum = x + y;" — value is an expression wrapping binary_expr
      const binaryExprs = doc.root.descendantsOfType('binary_expr');
      expect(binaryExprs.length).toBeGreaterThan(0);
      const sumExpr = binaryExprs[0]!;
      expect(sumExpr.field('left')).not.toBeNull();
      expect(sumExpr.field('right')).not.toBeNull();
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
      // All references in test.mini should resolve (x, y used after declaration)
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
      // Position inside an expression — should suggest declared variables
      const completions = service.provideCompletion(
        doc,
        { line: 4, character: 10 },
      );
      expect(completions.length).toBeGreaterThan(0);
      const labels = completions.map(c => c.label);
      // Should include the 'let' keyword
      expect(labels).toContain('let');
    });

    it('provides document symbols for all declarations', () => {
      const symbols = service.provideSymbols(doc);
      expect(symbols.length).toBeGreaterThanOrEqual(5);
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
