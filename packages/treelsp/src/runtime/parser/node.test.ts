import { describe, it, expect } from 'vitest';
import { ASTNode, type Position } from './node.js';

describe('ASTNode', () => {
  describe('exports', () => {
    it('should export ASTNode class', () => {
      expect(ASTNode).toBeDefined();
      expect(typeof ASTNode).toBe('function');
    });

    it('should export Position interface type', () => {
      // Type test - should compile
      const pos: Position = { line: 0, character: 0 };
      expect(pos).toBeDefined();
    });
  });

  describe('Position type', () => {
    it('should accept valid Position objects', () => {
      const positions: Position[] = [
        { line: 0, character: 0 },
        { line: 10, character: 5 },
        { line: 100, character: 50 },
      ];

      for (const pos of positions) {
        expect(pos.line).toBeGreaterThanOrEqual(0);
        expect(pos.character).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // Note: Full ASTNode functionality tests require actual SyntaxNode instances
  // Those tests will be in integration test suite with real Tree-sitter parser
  // This file tests the API surface and type definitions
});
