/**
 * Live integration tests for indent-lang using the Lezer backend
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
const testFilePath = resolve(__dirname, 'test.indent');
const hasLezer = existsSync(parserBundlePath) && existsSync(metaPath);

async function createLezerDocumentState(
  uri: string,
  source: string,
): Promise<DocumentState> {
  const { parser } = await import('./generated-lezer/parser.bundle.js') as { parser: import('@lezer/lr').LRParser };
  const meta: ParserMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const backend = new LezerRuntime(parser, meta);
  return backend.createDocumentState('', { uri, version: 1, languageId: 'indentlang' }, source);
}

describe.skipIf(!hasLezer)('indent-lang Lezer integration', () => {
  // ========== Parser Tests ==========

  describe('parser', () => {
    let doc: DocumentState;

    beforeAll(async () => {
      const source = readFileSync(testFilePath, 'utf-8');
      doc = await createLezerDocumentState('file:///test.indent', source);
    });

    afterAll(() => {
      doc?.dispose();
    });

    it('parses test.indent with Lezer backend', () => {
      expect(doc.root).toBeDefined();
      expect(doc.root.type).toBe('program');
    });

    it('root has no errors', () => {
      expect(doc.hasErrors).toBe(false);
    });

    it('parses assignments', () => {
      const assignments = doc.root.descendantsOfType('assignment');
      expect(assignments.length).toBeGreaterThanOrEqual(2);
      expect(assignments[0]!.field('name')!.text).toBe('x');
      expect(assignments[1]!.field('name')!.text).toBe('name');
    });

    it('parses function definition with indented body', () => {
      const funcs = doc.root.descendantsOfType('function_def');
      expect(funcs).toHaveLength(1);
      expect(funcs[0]!.field('name')!.text).toBe('greet');
    });

    it('function has block with statements', () => {
      const funcs = doc.root.descendantsOfType('function_def');
      const body = funcs[0]!.field('body');
      expect(body).not.toBeNull();
      expect(body!.type).toBe('block');
    });

    it('parses if statement with indented body', () => {
      const ifs = doc.root.descendantsOfType('if_stmt');
      expect(ifs).toHaveLength(1);
      expect(ifs[0]!.field('condition')!.text).toBe('x');
    });

    it('parses return statement inside function', () => {
      const returns = doc.root.descendantsOfType('return_stmt');
      expect(returns).toHaveLength(1);
      expect(returns[0]!.field('value')!.text).toBe('0');
    });

    it('parses call expressions', () => {
      const calls = doc.root.descendantsOfType('call_expr');
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it('detects parse errors in malformed input', async () => {
      const badDoc = await createLezerDocumentState('file:///bad.indent', 'def ()');
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
      const source = readFileSync(testFilePath, 'utf-8');
      doc = await createLezerDocumentState('file:///test.indent', source);
      service = createServer(definition);
      service.documents.open(doc);
    });

    afterAll(() => {
      doc?.dispose();
    });

    it('computes diagnostics without errors for valid file', () => {
      const diags = service.computeDiagnostics(doc);
      const errors = diags.filter(d => d.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('provides hover on function name', () => {
      const funcs = doc.root.descendantsOfType('function_def');
      const nameNode = funcs[0]!.field('name')!;
      const hover = service.provideHover(doc, nameNode.startPosition);
      expect(hover).not.toBeNull();
      expect(hover!.contents).toContain('**def**');
      expect(hover!.contents).toContain('greet');
    });

    it('provides hover on assignment name', () => {
      const assignments = doc.root.descendantsOfType('assignment');
      const nameNode = assignments[0]!.field('name')!;
      const hover = service.provideHover(doc, nameNode.startPosition);
      expect(hover).not.toBeNull();
      expect(hover!.contents).toContain('**variable**');
      expect(hover!.contents).toContain('x');
    });

    it('provides definition for identifier reference', () => {
      const ifs = doc.root.descendantsOfType('if_stmt');
      const condition = ifs[0]!.field('condition')!;
      const defResult = service.provideDefinition(doc, condition.startPosition);
      expect(defResult).not.toBeNull();
    });

    it('provides completions with keywords and declarations', () => {
      const completions = service.provideCompletion(
        doc,
        { line: 0, character: 0 },
      );
      expect(completions.length).toBeGreaterThan(0);
      const labels = completions.map(c => c.label);
      expect(labels).toContain('def');
      expect(labels).toContain('if');
      expect(labels).toContain('return');
    });

    it('provides document symbols', () => {
      const symbols = service.provideSymbols(doc);
      expect(symbols.length).toBeGreaterThanOrEqual(3);
      const names = symbols.map(s => s.name);
      expect(names).toContain('x');
      expect(names).toContain('greet');
    });

    it('provides references for function declaration', () => {
      const funcs = doc.root.descendantsOfType('function_def');
      const nameNode = funcs[0]!.field('name')!;
      const refs = service.provideReferences(doc, nameNode.startPosition);
      expect(refs.length).toBeGreaterThanOrEqual(1);
    });

    it('provides rename for declaration', () => {
      const assignments = doc.root.descendantsOfType('assignment');
      const nameNode = assignments[0]!.field('name')!;
      const result = service.provideRename(doc, nameNode.startPosition, 'val');
      expect(result).not.toBeNull();
      const edits = result!.changes[doc.uri];
      expect(edits).toBeDefined();
      expect(edits!.length).toBeGreaterThanOrEqual(1);
      for (const edit of edits!) {
        expect(edit.newText).toBe('val');
      }
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
      const source1 = readFileSync(testFilePath, 'utf-8');
      doc1 = await createLezerDocumentState('file:///test.indent', source1);

      const test2Path = resolve(__dirname, 'test2.indent');
      const source2 = readFileSync(test2Path, 'utf-8');
      doc2 = await createLezerDocumentState('file:///test2.indent', source2);

      service = createServer(definition);
      service.documents.open(doc1);

      const workspace = service.documents.getWorkspace();
      const stats = workspace.getStats();
      expect(stats.publicDeclarationCount).toBeGreaterThan(0);

      const greetDecls = workspace.lookupPublic('greet');
      expect(greetDecls).toHaveLength(1);
      expect(greetDecls[0]!.declaredBy).toBe('function_def');
    });

    it('resolves public declaration from another file', () => {
      service.documents.open(doc2);

      const diags = service.computeDiagnostics(doc2);
      const unresolvedErrors = diags.filter(
        d => d.code === 'unresolved-reference'
      );
      expect(unresolvedErrors).toHaveLength(0);
    });

    it('provides completion for cross-file public declarations', () => {
      const completions = service.provideCompletion(
        doc2,
        { line: 0, character: 0 },
      );
      const labels = completions.map(c => c.label);
      expect(labels).toContain('greet');
    });
  });
});
