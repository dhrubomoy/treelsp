/**
 * End-to-end validation for indent-lang
 * Verifies the full treelsp pipeline: defineLanguage → codegen → valid output
 */

import { describe, it, expect } from 'vitest';
import { generateGrammar, generateAstTypes, generateManifest } from 'treelsp/codegen';
import definition from './grammar.js';

describe('indent-lang end-to-end', () => {
  // ========== Language Definition ==========

  describe('language definition', () => {
    it('has correct metadata', () => {
      expect(definition.name).toBe('IndentLang');
      expect(definition.fileExtensions).toEqual(['.indent']);
      expect(definition.entry).toBe('program');
      expect(definition.word).toBe('identifier');
    });

    it('defines all grammar rules', () => {
      const ruleNames = Object.keys(definition.grammar);
      expect(ruleNames).toContain('program');
      expect(ruleNames).toContain('statement');
      expect(ruleNames).toContain('assignment');
      expect(ruleNames).toContain('function_def');
      expect(ruleNames).toContain('if_stmt');
      expect(ruleNames).toContain('return_stmt');
      expect(ruleNames).toContain('expr_stmt');
      expect(ruleNames).toContain('block');
      expect(ruleNames).toContain('expression');
      expect(ruleNames).toContain('call_expr');
      expect(ruleNames).toContain('binary_expr');
      expect(ruleNames).toContain('identifier');
      expect(ruleNames).toContain('number');
      expect(ruleNames).toContain('string_literal');
      expect(ruleNames).toContain('comment');
    });

    it('declares externals', () => {
      expect(definition.externals).toBeDefined();
    });

    it('has semantic layer', () => {
      expect(definition.semantic).toBeDefined();
      expect(definition.semantic?.program).toHaveProperty('scope');
      expect(definition.semantic?.function_def).toHaveProperty('scope');
      expect(definition.semantic?.function_def).toHaveProperty('declares');
      expect(definition.semantic?.assignment).toHaveProperty('declares');
      expect(definition.semantic?.parameter).toHaveProperty('declares');
      expect(definition.semantic?.identifier).toHaveProperty('references');
    });

    it('has LSP layer', () => {
      expect(definition.lsp).toBeDefined();
      expect(definition.lsp?.$keywords).toBeDefined();
      expect(definition.lsp?.assignment).toBeDefined();
      expect(definition.lsp?.function_def).toBeDefined();
      expect(definition.lsp?.parameter).toBeDefined();
    });
  });

  // ========== Grammar Codegen ==========

  describe('grammar codegen', () => {
    it('generates valid Tree-sitter grammar', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('module.exports = grammar({');
      expect(grammar).toContain('name: "IndentLang"');
      expect(grammar).toContain('word: $ => $.identifier');
    });

    it('includes externals declaration', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('externals: $ => [');
      expect(grammar).toContain('$.indent');
      expect(grammar).toContain('$.dedent');
      expect(grammar).toContain('$.newline');
    });

    it('includes extras declaration', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('extras: $ => [');
      expect(grammar).toContain('$.comment');
    });

    it('includes all rules', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('program: $ =>');
      expect(grammar).toContain('statement: $ =>');
      expect(grammar).toContain('assignment: $ =>');
      expect(grammar).toContain('function_def: $ =>');
      expect(grammar).toContain('if_stmt: $ =>');
      expect(grammar).toContain('return_stmt: $ =>');
      expect(grammar).toContain('block: $ =>');
      expect(grammar).toContain('expression: $ =>');
      expect(grammar).toContain('identifier: $ =>');
    });

    it('references external tokens in rules', () => {
      const grammar = generateGrammar(definition);
      // block uses indent/dedent/newline
      expect(grammar).toContain('$.indent');
      expect(grammar).toContain('$.dedent');
      expect(grammar).toContain('$.newline');
    });

    it('is deterministic', () => {
      const a = generateGrammar(definition);
      const b = generateGrammar(definition);
      expect(a).toBe(b);
    });
  });

  // ========== AST Types Codegen ==========

  describe('AST types codegen', () => {
    it('generates non-empty output', () => {
      const ast = generateAstTypes(definition);
      expect(ast.length).toBeGreaterThan(0);
    });

    it('generates interfaces for grammar rules', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain('export interface ProgramNode extends ASTNode');
      expect(ast).toContain('export interface AssignmentNode extends ASTNode');
      expect(ast).toContain('export interface FunctionDefNode extends ASTNode');
      expect(ast).toContain('export interface IfStmtNode extends ASTNode');
      expect(ast).toContain('export interface BlockNode extends ASTNode');
      expect(ast).toContain('export interface ExpressionNode extends ASTNode');
    });

    it('generates typed fields', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain("field(name: 'name'): IdentifierNode");
      expect(ast).toContain("field(name: 'value'):");
    });

    it('generates union type', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain('export type IndentLangNode =');
    });

    it('is deterministic', () => {
      const a = generateAstTypes(definition);
      const b = generateAstTypes(definition);
      expect(a).toBe(b);
    });
  });

  // ========== Manifest Codegen ==========

  describe('manifest codegen', () => {
    it('generates valid JSON', () => {
      const manifest = JSON.parse(generateManifest(definition));
      expect(manifest).toBeDefined();
    });

    it('contains correct language metadata', () => {
      const manifest = JSON.parse(generateManifest(definition));
      expect(manifest.name).toBe('IndentLang');
      expect(manifest.languageId).toBe('indentlang');
      expect(manifest.fileExtensions).toEqual(['.indent']);
      expect(manifest.server).toBe('./server.bundle.cjs');
    });

    it('is deterministic', () => {
      const a = generateManifest(definition);
      const b = generateManifest(definition);
      expect(a).toBe(b);
    });
  });
});
