/**
 * Live integration tests for schema-lang using the Lezer backend
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
const testSchemaPath = resolve(__dirname, 'test.schema');
const hasLezer = existsSync(parserBundlePath) && existsSync(metaPath);

async function createLezerDocumentState(
  uri: string,
  source: string,
): Promise<DocumentState> {
  const { parser } = await import('./generated-lezer/parser.bundle.js') as { parser: import('@lezer/lr').LRParser };
  const meta: ParserMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const backend = new LezerRuntime(parser, meta);
  return backend.createDocumentState('', { uri, version: 1, languageId: 'schemalang' }, source);
}

describe.skipIf(!hasLezer)('schema-lang Lezer integration', () => {
  // ========== Parser Tests ==========

  describe('parser', () => {
    let doc: DocumentState;

    beforeAll(async () => {
      const source = readFileSync(testSchemaPath, 'utf-8');
      doc = await createLezerDocumentState('file:///test.schema', source);
    });

    afterAll(() => {
      doc?.dispose();
    });

    it('parses test.schema with Lezer backend', () => {
      expect(doc.root).toBeDefined();
      expect(doc.root.type).toBe('schema');
    });

    it('root has no errors', () => {
      expect(doc.hasErrors).toBe(false);
    });

    it('parses all 2 type declarations', () => {
      const typeDecls = doc.root.descendantsOfType('type_decl');
      expect(typeDecls).toHaveLength(2);
    });

    it('parses all 2 enum declarations', () => {
      const enumDecls = doc.root.descendantsOfType('enum_decl');
      expect(enumDecls).toHaveLength(2);
    });

    it('type_decl has name field', () => {
      const typeDecls = doc.root.descendantsOfType('type_decl');
      expect(typeDecls[0]!.field('name')!.text).toBe('User');
      expect(typeDecls[1]!.field('name')!.text).toBe('Post');
    });

    it('enum_decl has name field', () => {
      const enumDecls = doc.root.descendantsOfType('enum_decl');
      expect(enumDecls[0]!.field('name')!.text).toBe('Role');
      expect(enumDecls[1]!.field('name')!.text).toBe('Status');
    });

    it('parses field declarations with name and type', () => {
      const fields = doc.root.descendantsOfType('field_decl');
      expect(fields).toHaveLength(4);
      const first = fields[0]!;
      expect(first.field('name')!.text).toBe('role');
      expect(first.field('type')!.text).toBe('Role');
    });

    it('parses enum variants', () => {
      const variants = doc.root.descendantsOfType('variant');
      expect(variants).toHaveLength(5);
      expect(variants[0]!.field('name')!.text).toBe('Admin');
    });

    it('parses type references', () => {
      const typeRefs = doc.root.descendantsOfType('type_ref');
      expect(typeRefs).toHaveLength(4);
    });

    it('detects parse errors in malformed input', async () => {
      const badDoc = await createLezerDocumentState('file:///bad.schema', 'type { }');
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
      const source = readFileSync(testSchemaPath, 'utf-8');
      doc = await createLezerDocumentState('file:///test.schema', source);
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

    it('provides hover on type declaration name', () => {
      const typeDecls = doc.root.descendantsOfType('type_decl');
      const nameNode = typeDecls[0]!.field('name')!;
      const hover = service.provideHover(doc, nameNode.startPosition);
      expect(hover).not.toBeNull();
      expect(hover!.contents).toContain('**type**');
      expect(hover!.contents).toContain('User');
    });

    it('provides hover on enum declaration name', () => {
      const enumDecls = doc.root.descendantsOfType('enum_decl');
      const nameNode = enumDecls[0]!.field('name')!;
      const hover = service.provideHover(doc, nameNode.startPosition);
      expect(hover).not.toBeNull();
      expect(hover!.contents).toContain('**enum**');
      expect(hover!.contents).toContain('Role');
    });

    it('provides definition for type reference', () => {
      const typeRefs = doc.root.descendantsOfType('type_ref');
      const roleRef = typeRefs.find(r => r.text === 'Role')!;
      const defResult = service.provideDefinition(doc, roleRef.startPosition);
      expect(defResult).not.toBeNull();
    });

    it('provides completions with declared types and keywords', () => {
      const completions = service.provideCompletion(
        doc,
        { line: 0, character: 0 },
      );
      expect(completions.length).toBeGreaterThan(0);
      const labels = completions.map(c => c.label);
      expect(labels).toContain('type');
      expect(labels).toContain('enum');
    });

    it('provides document symbols for all declarations', () => {
      const symbols = service.provideSymbols(doc);
      expect(symbols.length).toBeGreaterThanOrEqual(4);
      const names = symbols.map(s => s.name);
      expect(names).toContain('User');
      expect(names).toContain('Role');
      expect(names).toContain('Post');
      expect(names).toContain('Status');
    });

    it('provides references for type declaration', () => {
      const typeDecls = doc.root.descendantsOfType('type_decl');
      const userDecl = typeDecls.find(t => t.field('name')!.text === 'User')!;
      const nameNode = userDecl.field('name')!;
      const refs = service.provideReferences(doc, nameNode.startPosition);
      expect(refs.length).toBeGreaterThanOrEqual(1);
    });

    it('provides rename for type declaration', () => {
      const typeDecls = doc.root.descendantsOfType('type_decl');
      const userDecl = typeDecls.find(t => t.field('name')!.text === 'User')!;
      const nameNode = userDecl.field('name')!;
      const result = service.provideRename(doc, nameNode.startPosition, 'Person');
      expect(result).not.toBeNull();
      const edits = result!.changes[doc.uri];
      expect(edits).toBeDefined();
      expect(edits!.length).toBeGreaterThanOrEqual(2);
      for (const edit of edits!) {
        expect(edit.newText).toBe('Person');
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
      const source1 = readFileSync(testSchemaPath, 'utf-8');
      doc1 = await createLezerDocumentState('file:///test.schema', source1);

      const test2Path = resolve(__dirname, 'test2.schema');
      const source2 = readFileSync(test2Path, 'utf-8');
      doc2 = await createLezerDocumentState('file:///test2.schema', source2);

      service = createServer(definition);
      service.documents.open(doc1);

      const workspace = service.documents.getWorkspace();
      const stats = workspace.getStats();
      expect(stats.publicDeclarationCount).toBeGreaterThan(0);

      const userDecls = workspace.lookupPublic('User');
      expect(userDecls).toHaveLength(1);
      expect(userDecls[0]!.declaredBy).toBe('type_decl');
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
      expect(labels).toContain('User');
    });

    it('go-to-definition navigates to the declaring file', () => {
      const typeRefs = doc2.root.descendantsOfType('type_ref');
      const userRef = typeRefs.find(r => r.text === 'User')!;
      const defResult = service.provideDefinition(doc2, userRef.startPosition);
      expect(defResult).not.toBeNull();
      expect(defResult!.uri).toBe('file:///test.schema');
    });
  });
});
