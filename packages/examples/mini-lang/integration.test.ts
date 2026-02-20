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

    it('provides signature help inside function call', () => {
      // line 17: "let result = add(x, y);"
      const calls = doc.root.descendantsOfType('call_expr');
      const addCall = calls.find(c => c.field('callee')!.text === 'add');
      expect(addCall).toBeDefined();

      // Position just after "(" in "add("
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

    it('provides signature help for single-param function', () => {
      // line 18: "let msg = greet(greeting);"
      const calls = doc.root.descendantsOfType('call_expr');
      const greetCall = calls.find(c => c.field('callee')!.text === 'greet');
      expect(greetCall).toBeDefined();

      const callee = greetCall!.field('callee')!;
      const afterParen = {
        line: callee.startPosition.line,
        character: callee.endPosition.character + 1,
      };

      const sigHelp = service.provideSignatureHelp(doc, afterParen);
      expect(sigHelp).not.toBeNull();
      expect(sigHelp!.signatures[0]!.label).toContain('greet');
      expect(sigHelp!.signatures[0]!.parameters).toHaveLength(1);
      expect(sigHelp!.signatures[0]!.parameters[0]!.label).toBe('name');
      expect(sigHelp!.activeParameter).toBe(0);
    });

    it('collects signature trigger characters from definition', () => {
      expect(service.signatureTriggerCharacters).toContain('(');
      expect(service.signatureTriggerCharacters).toContain(',');
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

  // ========== Incremental Parsing Tests ==========

  describe('incremental parsing', () => {
    const metadata = { uri: 'file:///incr.mini', version: 1, languageId: 'minilang' };

    it('single character replacement produces correct AST', async () => {
      // Start: "let x = 10;"  →  Change 'x' to 'z'  →  "let z = 10;"
      const doc = await createDocumentState(wasmPath, metadata, 'let x = 10;');
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

    it('matches full reparse result', async () => {
      const source = 'let x = 10;\nlet y = 20;';
      const incrDoc = await createDocumentState(wasmPath, { ...metadata, uri: 'file:///incr1.mini' }, source);
      const fullDoc = await createDocumentState(wasmPath, { ...metadata, uri: 'file:///full1.mini' }, 'let z = 10;\nlet y = 20;');
      try {
        // Incremental: change 'x' to 'z'
        incrDoc.updateIncremental([{
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
          text: 'z',
        }]);

        expect(incrDoc.text).toBe(fullDoc.text);
        expect(incrDoc.root.toString()).toBe(fullDoc.root.toString());
      } finally {
        incrDoc.dispose();
        fullDoc.dispose();
      }
    });

    it('handles insertion (adding text)', async () => {
      // Start: "let x = 10;"  →  Insert "let y = 20;\n" before it
      const doc = await createDocumentState(wasmPath, metadata, 'let x = 10;');
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
      // Start: "let x = 10;\nlet y = 20;"  →  Delete first line
      const doc = await createDocumentState(wasmPath, metadata, 'let x = 10;\nlet y = 20;');
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

    it('handles multi-line replacement', async () => {
      // Replace the whole body of a function
      const source = 'fn add(a, b) {\n  return a + b;\n}';
      const doc = await createDocumentState(wasmPath, metadata, source);
      try {
        // Replace "return a + b;" with "return a * b;"
        doc.updateIncremental([{
          range: { start: { line: 1, character: 9 }, end: { line: 1, character: 14 } },
          text: 'a * b',
        }]);

        expect(doc.text).toBe('fn add(a, b) {\n  return a * b;\n}');
        expect(doc.hasErrors).toBe(false);
        const returns = doc.root.descendantsOfType('return_statement');
        expect(returns).toHaveLength(1);
        // value field is the 'expression' wrapper; binary_expr is nested inside
        const binaryExprs = doc.root.descendantsOfType('binary_expr');
        expect(binaryExprs).toHaveLength(1);
      } finally {
        doc.dispose();
      }
    });

    it('handles multiple sequential changes in one update', async () => {
      // Start: "let x = 10;\nlet y = 20;"
      // Change 1: 'x' → 'a' (line 0, char 4-5)
      // Change 2: 'y' → 'b' (line 1, char 4-5, but after change 1 the text is the same structure)
      const doc = await createDocumentState(wasmPath, metadata, 'let x = 10;\nlet y = 20;');
      try {
        doc.updateIncremental([
          {
            range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
            text: 'a',
          },
          {
            range: { start: { line: 1, character: 4 }, end: { line: 1, character: 5 } },
            text: 'b',
          },
        ]);

        expect(doc.text).toBe('let a = 10;\nlet b = 20;');
        expect(doc.hasErrors).toBe(false);
        const vars = doc.root.descendantsOfType('variable_decl');
        expect(vars).toHaveLength(2);
        expect(vars[0]!.field('name')!.text).toBe('a');
        expect(vars[1]!.field('name')!.text).toBe('b');
      } finally {
        doc.dispose();
      }
    });

    it('preserves LSP features after incremental update', async () => {
      const source = 'let x = 10;\nlet sum = x + 5;';
      const doc = await createDocumentState(wasmPath, metadata, source);
      const service = createServer(definition);
      try {
        service.documents.open(doc);

        // Verify initial state: 'x' reference resolves
        const diagsBefore = service.computeDiagnostics(doc);
        const unresolvedBefore = diagsBefore.filter(d => d.code === 'unresolved-reference');
        expect(unresolvedBefore).toHaveLength(0);

        // Incrementally rename 'x' to 'z' in declaration (line 0, char 4-5)
        doc.updateIncremental([{
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
          text: 'z',
        }]);
        service.documents.change(doc);

        // Now 'x' in sum is unresolved (declaration is 'z' but reference is still 'x')
        const diagsAfter = service.computeDiagnostics(doc);
        const unresolvedAfter = diagsAfter.filter(d => d.code === 'unresolved-reference');
        expect(unresolvedAfter).toHaveLength(1);

        // Fix: rename 'x' to 'z' in the reference too (line 1, char 10-11)
        doc.updateIncremental([{
          range: { start: { line: 1, character: 10 }, end: { line: 1, character: 11 } },
          text: 'z',
        }]);
        service.documents.change(doc);

        expect(doc.text).toBe('let z = 10;\nlet sum = z + 5;');
        const diagsFinal = service.computeDiagnostics(doc);
        const unresolvedFinal = diagsFinal.filter(d => d.code === 'unresolved-reference');
        expect(unresolvedFinal).toHaveLength(0);

        // Hover on 'z' declaration should work
        const hover = service.provideHover(doc, { line: 0, character: 4 });
        expect(hover).not.toBeNull();
      } finally {
        doc.dispose();
      }
    });

    it('handles adding a new function', async () => {
      const source = 'let x = 10;';
      const doc = await createDocumentState(wasmPath, metadata, source);
      try {
        // Append a function declaration
        doc.updateIncremental([{
          range: { start: { line: 0, character: 11 }, end: { line: 0, character: 11 } },
          text: '\nfn double(n) {\n  return n + n;\n}',
        }]);

        expect(doc.hasErrors).toBe(false);
        const fns = doc.root.descendantsOfType('function_decl');
        expect(fns).toHaveLength(1);
        expect(fns[0]!.field('name')!.text).toBe('double');
        const params = doc.root.descendantsOfType('parameter');
        expect(params).toHaveLength(1);
        expect(params[0]!.field('name')!.text).toBe('n');
      } finally {
        doc.dispose();
      }
    });

    it('version increments correctly', async () => {
      const doc = await createDocumentState(
        wasmPath,
        { uri: 'file:///ver.mini', version: 1, languageId: 'minilang' },
        'let x = 10;',
      );
      try {
        expect(doc.version).toBe(1);

        // With explicit version
        doc.updateIncremental([{
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
          text: 'y',
        }], 5);
        expect(doc.version).toBe(5);

        // Without explicit version (auto-increment)
        doc.updateIncremental([{
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
          text: 'z',
        }]);
        expect(doc.version).toBe(6);
      } finally {
        doc.dispose();
      }
    });

    it('handles rapid sequential updates (simulating typing)', async () => {
      // Simulate typing "let abc = 1;" character by character starting from empty
      const doc = await createDocumentState(wasmPath, metadata, '');
      try {
        const chars = 'let abc = 1;';
        for (let i = 0; i < chars.length; i++) {
          doc.updateIncremental([{
            range: { start: { line: 0, character: i }, end: { line: 0, character: i } },
            text: chars[i]!,
          }]);
        }

        expect(doc.text).toBe('let abc = 1;');
        expect(doc.hasErrors).toBe(false);
        const vars = doc.root.descendantsOfType('variable_decl');
        expect(vars).toHaveLength(1);
        expect(vars[0]!.field('name')!.text).toBe('abc');
      } finally {
        doc.dispose();
      }
    });
  });

  // ========== Dispose Safety Tests ==========

  describe('dispose safety', () => {
    it('update() is a no-op after dispose()', async () => {
      const doc = await createDocumentState(
        wasmPath,
        { uri: 'file:///dispose.mini', version: 1, languageId: 'minilang' },
        'let x = 10;',
      );
      doc.dispose();
      expect(() => doc.update('let y = 20;')).not.toThrow();
    });

    it('updateIncremental() is a no-op after dispose()', async () => {
      const doc = await createDocumentState(
        wasmPath,
        { uri: 'file:///dispose.mini', version: 1, languageId: 'minilang' },
        'let x = 10;',
      );
      doc.dispose();
      expect(() => doc.updateIncremental([{
        range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
        text: 'z',
      }])).not.toThrow();
    });

    it('dispose() can be called multiple times', async () => {
      const doc = await createDocumentState(
        wasmPath,
        { uri: 'file:///dispose.mini', version: 1, languageId: 'minilang' },
        'let x = 10;',
      );
      doc.dispose();
      expect(() => doc.dispose()).not.toThrow();
    });
  });

  // ========== Code Actions Tests ==========

  describe('code actions', () => {
    it('reports duplicate variable and offers fix to remove it', async () => {
      const source = 'let x = 1;\nlet x = 2;\n';
      const doc = await createDocumentState(
        wasmPath,
        { uri: 'file:///dup.mini', version: 1, languageId: 'minilang' },
        source,
      );
      try {
        const service = createServer(definition);
        service.documents.open(doc);

        // Should have a duplicate-declaration error
        const diags = service.computeDiagnostics(doc);
        const dupDiag = diags.find(d => d.code === 'duplicate-declaration');
        expect(dupDiag).toBeDefined();
        expect(dupDiag!.message).toContain("'x'");
        expect(dupDiag!.fix).toBeDefined();
        expect(dupDiag!.fix!.label).toContain('x');

        // Code action should be returned for the range of the second decl
        const actions = service.provideCodeActions(doc, {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 10 },
        });
        expect(actions).toHaveLength(1);
        expect(actions[0]!.kind).toBe('quickfix');
        expect(actions[0]!.edit.changes['file:///dup.mini']).toHaveLength(1);

        // Fix should remove the entire second line
        const edit = actions[0]!.edit.changes['file:///dup.mini']![0]!;
        expect(edit.newText).toBe('');
        expect(edit.range.start.line).toBe(1);
        expect(edit.range.end.line).toBe(2);
      } finally {
        doc.dispose();
      }
    });

    it('does not report duplicate when variable is declared once', async () => {
      const source = 'let x = 1;\nlet y = 2;\n';
      const doc = await createDocumentState(
        wasmPath,
        { uri: 'file:///nodup.mini', version: 1, languageId: 'minilang' },
        source,
      );
      try {
        const service = createServer(definition);
        service.documents.open(doc);

        const diags = service.computeDiagnostics(doc);
        const dupDiag = diags.find(d => d.code === 'duplicate-declaration');
        expect(dupDiag).toBeUndefined();
      } finally {
        doc.dispose();
      }
    });
  });
});
