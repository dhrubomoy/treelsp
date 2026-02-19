import { describe, it, expect } from 'vitest';
import type { DocumentMetadata, TextEdit, ContentChange } from './tree.js';

describe('DocumentState', () => {
  describe('exports', () => {
    it('should export TreeSitterDocumentState class', async () => {
      const { TreeSitterDocumentState } = await import('./tree.js');
      expect(TreeSitterDocumentState).toBeDefined();
      expect(typeof TreeSitterDocumentState).toBe('function');
    });

    it('should export createDocumentState function', async () => {
      const { createDocumentState } = await import('./tree.js');
      expect(typeof createDocumentState).toBe('function');
    });
  });

  describe('DocumentMetadata type', () => {
    it('should accept valid DocumentMetadata objects', () => {
      const metadata: DocumentMetadata = {
        uri: 'file:///test.txt',
        version: 1,
        languageId: 'test',
      };

      expect(metadata.uri).toBe('file:///test.txt');
      expect(metadata.version).toBe(1);
      expect(metadata.languageId).toBe('test');
    });
  });

  describe('TextEdit type', () => {
    it('should accept valid TextEdit objects', () => {
      const edit: TextEdit = {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        newText: 'hello',
      };

      expect(edit.newText).toBe('hello');
      expect(edit.range.start.line).toBe(0);
      expect(edit.range.end.character).toBe(5);
    });
  });

  describe('ContentChange type', () => {
    it('should accept valid ContentChange objects', () => {
      const change: ContentChange = {
        range: {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 5 },
        },
        text: 'z',
      };

      expect(change.text).toBe('z');
      expect(change.range.start.line).toBe(0);
      expect(change.range.end.character).toBe(5);
    });
  });

  // Note: Full DocumentState functionality tests require actual Parser and WASM
  // Those tests will be in integration test suite
  // This file tests the API surface and type definitions
});
