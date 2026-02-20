/**
 * Live integration tests for mini-lang using the Lezer backend
 * Requires generated-lezer/parser.bundle.js — run "treelsp build" first
 * Skipped automatically if parser.bundle.js is not found
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LezerRuntime } from 'treelsp/backend/lezer';
import type { ParserMeta } from 'treelsp/backend/lezer';
import { createServer } from 'treelsp/runtime';
import type { DocumentState, LanguageService } from 'treelsp/runtime';
import definition from './grammar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const generatedDir = resolve(__dirname, 'generated-lezer');
const parserBundlePath = resolve(generatedDir, 'parser.bundle.js');
const metaPath = resolve(generatedDir, 'parser-meta.json');
const testMiniPath = resolve(__dirname, 'test.mini');
const hasLezer = existsSync(parserBundlePath) && existsSync(metaPath);

async function createLezerDocumentState(
  uri: string,
  source: string,
): Promise<DocumentState> {
  const { parser } = await import('./generated-lezer/parser.bundle.js') as { parser: import('@lezer/lr').LRParser };
  const meta: ParserMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const backend = new LezerRuntime(parser, meta);
  return backend.createDocumentState('', { uri, version: 1, languageId: 'minilang' }, source);
}

describe.skipIf(!hasLezer)('mini-lang Lezer integration', () => {
  // ========== Parser Tests ==========

  describe('parser', () => {
    let doc: DocumentState;

    beforeAll(async () => {
      const source = readFileSync(testMiniPath, 'utf-8');
      doc = await createLezerDocumentState('file:///test.mini', source);
    });

    afterAll(() => {
      doc?.dispose();
    });

    it('parses test.mini with Lezer backend', () => {
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
      // left expression, operator, right expression are positional children
      expect(sumExpr.namedChildren.length).toBeGreaterThanOrEqual(2);
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
      const badDoc = await createLezerDocumentState('file:///bad.mini', 'let = ;');
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
      doc = await createLezerDocumentState('file:///test.mini', source);
      service = createServer(definition);
      service.documents.open(doc);
    });

    afterAll(() => {
      doc?.dispose();
    });

    it('computes diagnostics without errors for valid file', () => {
      const diags = service.computeDiagnostics(doc);
      expect(Array.isArray(diags)).toBe(true);
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
      const identifiers = doc.root.descendantsOfType('identifier');
      const xNodes = identifiers.filter(id => id.text === 'x');
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

    it('provides signature help inside function call', () => {
      const calls = doc.root.descendantsOfType('call_expr');
      const addCall = calls.find(c => c.field('callee')!.text === 'add');
      expect(addCall).toBeDefined();

      const callee = addCall!.field('callee')!;
      const afterParen = {
        line: callee.startPosition.line,
        character: callee.endPosition.character + 1,
      };

      const sigHelp = service.provideSignatureHelp(doc, afterParen);
      expect(sigHelp).not.toBeNull();
      expect(sigHelp!.signatures).toHaveLength(1);
      expect(sigHelp!.signatures[0]!.label).toContain('add');
      expect(sigHelp!.signatures[0]!.parameters).toHaveLength(2);
      expect(sigHelp!.signatures[0]!.parameters[0]!.label).toBe('a');
      expect(sigHelp!.signatures[0]!.parameters[1]!.label).toBe('b');
      expect(sigHelp!.activeParameter).toBe(0);
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
      const source1 = readFileSync(testMiniPath, 'utf-8');
      doc1 = await createLezerDocumentState('file:///test.mini', source1);

      const test2Path = resolve(__dirname, 'test2.mini');
      const source2 = readFileSync(test2Path, 'utf-8');
      doc2 = await createLezerDocumentState('file:///test2.mini', source2);

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

      const wsDoc2 = service.documents.get('file:///test2.mini');
      const unresolvedRefs = wsDoc2!.scope.references.filter(r => !r.resolved);
      expect(unresolvedRefs).toHaveLength(0);

      const diags = service.computeDiagnostics(doc2);
      const unresolvedErrors = diags.filter(
        d => d.code === 'unresolved-reference'
      );
      expect(unresolvedErrors).toHaveLength(0);
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
      const defResult = service.provideDefinition(
        doc2,
        { line: 0, character: 10 },
      );
      expect(defResult).not.toBeNull();
      expect(defResult!.uri).toBe('file:///test.mini');
    });
  });

  // ========== Incremental Parsing Tests ==========

  describe('incremental parsing', () => {
    it('single character replacement produces correct AST', async () => {
      const doc = await createLezerDocumentState('file:///incr.mini', 'let x = 10;');
      try {
        expect(doc.root.type).toBe('program');
        const varsBefore = doc.root.descendantsOfType('variable_decl');
        expect(varsBefore[0]!.field('name')!.text).toBe('x');

        doc.updateIncremental([{
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
          text: 'z',
        }]);

        expect(doc.text).toBe('let z = 10;');
        expect(doc.version).toBe(2);
        expect(doc.hasErrors).toBe(false);
        const varsAfter = doc.root.descendantsOfType('variable_decl');
        expect(varsAfter[0]!.field('name')!.text).toBe('z');
      } finally {
        doc.dispose();
      }
    });

    it('handles insertion (adding text)', async () => {
      const doc = await createLezerDocumentState('file:///incr.mini', 'let x = 10;');
      try {
        doc.updateIncremental([{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          text: 'let y = 20;\n',
        }]);

        expect(doc.text).toBe('let y = 20;\nlet x = 10;');
        expect(doc.hasErrors).toBe(false);
        const vars = doc.root.descendantsOfType('variable_decl');
        expect(vars).toHaveLength(2);
        expect(vars[0]!.field('name')!.text).toBe('y');
        expect(vars[1]!.field('name')!.text).toBe('x');
      } finally {
        doc.dispose();
      }
    });

    it('handles deletion (removing text)', async () => {
      const doc = await createLezerDocumentState('file:///incr.mini', 'let x = 10;\nlet y = 20;');
      try {
        doc.updateIncremental([{
          range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
          text: '',
        }]);

        expect(doc.text).toBe('let y = 20;');
        expect(doc.hasErrors).toBe(false);
        const vars = doc.root.descendantsOfType('variable_decl');
        expect(vars).toHaveLength(1);
        expect(vars[0]!.field('name')!.text).toBe('y');
      } finally {
        doc.dispose();
      }
    });

    it('preserves LSP features after incremental update', async () => {
      const source = 'let x = 10;\nlet sum = x + 5;';
      const doc = await createLezerDocumentState('file:///incr.mini', source);
      const service = createServer(definition);
      try {
        service.documents.open(doc);

        const diagsBefore = service.computeDiagnostics(doc);
        const unresolvedBefore = diagsBefore.filter(d => d.code === 'unresolved-reference');
        expect(unresolvedBefore).toHaveLength(0);

        // Rename 'x' to 'z' in declaration
        doc.updateIncremental([{
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
          text: 'z',
        }]);
        service.documents.change(doc);

        // Now 'x' in sum is unresolved
        const diagsAfter = service.computeDiagnostics(doc);
        const unresolvedAfter = diagsAfter.filter(d => d.code === 'unresolved-reference');
        expect(unresolvedAfter).toHaveLength(1);

        // Fix: rename 'x' to 'z' in the reference too
        doc.updateIncremental([{
          range: { start: { line: 1, character: 10 }, end: { line: 1, character: 11 } },
          text: 'z',
        }]);
        service.documents.change(doc);

        expect(doc.text).toBe('let z = 10;\nlet sum = z + 5;');
        const diagsFinal = service.computeDiagnostics(doc);
        const unresolvedFinal = diagsFinal.filter(d => d.code === 'unresolved-reference');
        expect(unresolvedFinal).toHaveLength(0);
      } finally {
        doc.dispose();
      }
    });
  });

  // ========== Dispose Safety Tests ==========

  describe('dispose safety', () => {
    it('update() is a no-op after dispose()', async () => {
      const doc = await createLezerDocumentState('file:///dispose.mini', 'let x = 10;');
      doc.dispose();
      expect(() => doc.update('let y = 20;')).not.toThrow();
    });

    it('updateIncremental() is a no-op after dispose()', async () => {
      const doc = await createLezerDocumentState('file:///dispose.mini', 'let x = 10;');
      doc.dispose();
      expect(() => doc.updateIncremental([{
        range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
        text: 'z',
      }])).not.toThrow();
    });

    it('dispose() can be called multiple times', async () => {
      const doc = await createLezerDocumentState('file:///dispose.mini', 'let x = 10;');
      doc.dispose();
      expect(() => doc.dispose()).not.toThrow();
    });
  });

  // ========== Code Actions Tests ==========

  describe('code actions', () => {
    it('reports duplicate variable and offers fix to remove it', async () => {
      const source = 'let x = 1;\nlet x = 2;\n';
      const doc = await createLezerDocumentState('file:///dup.mini', source);
      try {
        const service = createServer(definition);
        service.documents.open(doc);

        const diags = service.computeDiagnostics(doc);
        const dupDiag = diags.find(d => d.code === 'duplicate-declaration');
        expect(dupDiag).toBeDefined();
        expect(dupDiag!.message).toContain("'x'");
        expect(dupDiag!.fix).toBeDefined();
        expect(dupDiag!.fix!.label).toContain('x');

        const actions = service.provideCodeActions(doc, {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 10 },
        });
        expect(actions).toHaveLength(1);
        expect(actions[0]!.kind).toBe('quickfix');
      } finally {
        doc.dispose();
      }
    });
  });
});
