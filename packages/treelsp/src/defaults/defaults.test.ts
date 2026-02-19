/**
 * Tests for defaults export structure
 * Verifies the restructured exports: validation.$references, validation.$declarations,
 * lsp.hover, lsp.complete, lsp.symbol
 */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { describe, it, expect } from 'vitest';
import { validation, lsp } from './index.js';

describe('defaults exports', () => {
  describe('validation', () => {
    it('should export $references as a function', () => {
      expect(typeof validation.$references).toBe('function');
    });

    it('should export $declarations as a function', () => {
      expect(typeof validation.$declarations).toBe('function');
    });
  });

  describe('lsp', () => {
    it('should export hover as a function', () => {
      expect(typeof lsp.hover).toBe('function');
    });

    it('should export complete as a function', () => {
      expect(typeof lsp.complete).toBe('function');
    });

    it('should export symbol as a function', () => {
      expect(typeof lsp.symbol).toBe('function');
    });
  });

  describe('validation.$declarations detects duplicates', () => {
    it('should emit warning for duplicate declarations', () => {
      const warnings: Array<{ node: any; message: string; options?: any }> = [];

      const mockCtx = {
        scopeOf: () => ({}),
        declarationsOf: () => [
          { name: 'x', node: { text: 'x' } },
          { name: 'x', node: { text: 'x' } },
        ],
        warning: (node: any, message: string, options?: any) => {
          warnings.push({ node, message, options });
        },
        error: () => {},
        info: () => {},
        hint: () => {},
      };

      validation.$declarations({} as any, mockCtx as any);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain('Duplicate declaration');
      expect(warnings[0]?.message).toContain('x');
      expect(warnings[0]?.options?.code).toBe('duplicate-declaration');
    });

    it('should not emit warning when no duplicates', () => {
      const warnings: any[] = [];

      const mockCtx = {
        scopeOf: () => ({}),
        declarationsOf: () => [
          { name: 'x', node: { text: 'x' } },
          { name: 'y', node: { text: 'y' } },
        ],
        warning: (_node: any, message: string) => {
          warnings.push(message);
        },
      };

      validation.$declarations({} as any, mockCtx as any);

      expect(warnings).toHaveLength(0);
    });
  });

  describe('lsp.hover', () => {
    it('should return hover text with name field', () => {
      const mockNode = {
        type: 'variable_decl',
        text: 'let x = 1',
        field: (name: string) => name === 'name' ? { text: 'x' } : null,
      };
      const mockCtx = {} as any;

      const result = lsp.hover(mockNode, mockCtx);

      expect(result).toContain('variable_decl');
      expect(result).toContain('x');
    });

    it('should fall back to node text when no name field', () => {
      const mockNode = {
        type: 'literal',
        text: '42',
        field: () => null,
      };
      const mockCtx = {} as any;

      const result = lsp.hover(mockNode, mockCtx);

      expect(result).toContain('literal');
      expect(result).toContain('42');
    });
  });

  describe('lsp.symbol', () => {
    it('should return symbol descriptor when name field exists', () => {
      const mockNode = {
        field: (name: string) => name === 'name' ? { text: 'myVar' } : null,
      };

      const result = lsp.symbol(mockNode);

      expect(result).not.toBeNull();
      expect(result?.kind).toBe('Variable');
      expect(result?.label).toBe('myVar');
    });

    it('should return null when no name field', () => {
      const mockNode = {
        field: () => null,
      };

      const result = lsp.symbol(mockNode);
      expect(result).toBeNull();
    });
  });
});
