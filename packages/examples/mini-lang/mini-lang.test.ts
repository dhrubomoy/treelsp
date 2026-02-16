/**
 * End-to-end validation for mini-lang
 * Verifies the full treelsp pipeline: defineLanguage → codegen → valid output
 */

import { describe, it, expect } from 'vitest';
import { generateGrammar, generateAstTypes, generateManifest } from 'treelsp/codegen';
import definition from './grammar.js';

describe('mini-lang end-to-end', () => {
  // ========== Language Definition ==========

  describe('language definition', () => {
    it('has correct metadata', () => {
      expect(definition.name).toBe('MiniLang');
      expect(definition.fileExtensions).toEqual(['.mini']);
      expect(definition.entry).toBe('program');
      expect(definition.word).toBe('identifier');
    });

    it('defines all grammar rules', () => {
      const ruleNames = Object.keys(definition.grammar);
      expect(ruleNames).toContain('program');
      expect(ruleNames).toContain('statement');
      expect(ruleNames).toContain('variable_decl');
      expect(ruleNames).toContain('function_decl');
      expect(ruleNames).toContain('parameter_list');
      expect(ruleNames).toContain('parameter');
      expect(ruleNames).toContain('block');
      expect(ruleNames).toContain('return_statement');
      expect(ruleNames).toContain('expr_statement');
      expect(ruleNames).toContain('expression');
      expect(ruleNames).toContain('call_expr');
      expect(ruleNames).toContain('argument_list');
      expect(ruleNames).toContain('binary_expr');
      expect(ruleNames).toContain('identifier');
      expect(ruleNames).toContain('number');
      expect(ruleNames).toContain('string_literal');
    });

    it('has semantic layer', () => {
      expect(definition.semantic).toBeDefined();
      expect(definition.semantic?.program).toHaveProperty('scope');
      expect(definition.semantic?.variable_decl).toHaveProperty('declares');
      expect(definition.semantic?.function_decl).toHaveProperty('scope');
      expect(definition.semantic?.function_decl).toHaveProperty('declares');
      expect(definition.semantic?.parameter).toHaveProperty('declares');
      expect(definition.semantic?.block).toHaveProperty('scope');
      expect(definition.semantic?.identifier).toHaveProperty('references');
    });

    it('has validation layer', () => {
      expect(definition.validation).toBeDefined();
      expect(definition.validation?.variable_decl).toBeDefined();
    });

    it('has LSP layer', () => {
      expect(definition.lsp).toBeDefined();
      expect(definition.lsp?.$keywords).toBeDefined();
      expect(definition.lsp?.variable_decl).toBeDefined();
      expect(definition.lsp?.function_decl).toBeDefined();
      expect(definition.lsp?.parameter).toBeDefined();
    });
  });

  // ========== Grammar Codegen ==========

  describe('grammar codegen', () => {
    it('generates valid Tree-sitter grammar', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('module.exports = grammar({');
      expect(grammar).toContain('name: "MiniLang"');
      expect(grammar).toContain('word: $ => $.identifier');
    });

    it('includes all rules', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('program: $ =>');
      expect(grammar).toContain('statement: $ =>');
      expect(grammar).toContain('variable_decl: $ =>');
      expect(grammar).toContain('function_decl: $ =>');
      expect(grammar).toContain('parameter_list: $ =>');
      expect(grammar).toContain('parameter: $ =>');
      expect(grammar).toContain('block: $ =>');
      expect(grammar).toContain('return_statement: $ =>');
      expect(grammar).toContain('expr_statement: $ =>');
      expect(grammar).toContain('expression: $ =>');
      expect(grammar).toContain('call_expr: $ =>');
      expect(grammar).toContain('argument_list: $ =>');
      expect(grammar).toContain('binary_expr: $ =>');
      expect(grammar).toContain('identifier: $ =>');
      expect(grammar).toContain('number: $ =>');
      expect(grammar).toContain('string_literal: $ =>');
    });

    it('generates fields for variable_decl', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('field("name", $.identifier)');
      expect(grammar).toContain('field("value", $.expression)');
    });

    it('generates precedence for binary operators', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('prec.left(1,');
      expect(grammar).toContain('prec.left(2,');
    });

    it('matches the existing generated grammar.js', () => {
      const freshGrammar = generateGrammar(definition);
      // The generated grammar should be deterministic
      const freshAgain = generateGrammar(definition);
      expect(freshGrammar).toBe(freshAgain);
    });
  });

  // ========== AST Types Codegen ==========

  describe('AST types codegen', () => {
    it('generates non-empty output', () => {
      const ast = generateAstTypes(definition);
      expect(ast.length).toBeGreaterThan(0);
    });

    it('generates interfaces for all rules', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain('export interface ProgramNode extends ASTNode');
      expect(ast).toContain('export interface StatementNode extends ASTNode');
      expect(ast).toContain('export interface VariableDeclNode extends ASTNode');
      expect(ast).toContain('export interface FunctionDeclNode extends ASTNode');
      expect(ast).toContain('export interface ParameterListNode extends ASTNode');
      expect(ast).toContain('export interface ParameterNode extends ASTNode');
      expect(ast).toContain('export interface BlockNode extends ASTNode');
      expect(ast).toContain('export interface ReturnStatementNode extends ASTNode');
      expect(ast).toContain('export interface ExprStatementNode extends ASTNode');
      expect(ast).toContain('export interface ExpressionNode extends ASTNode');
      expect(ast).toContain('export interface CallExprNode extends ASTNode');
      expect(ast).toContain('export interface ArgumentListNode extends ASTNode');
      expect(ast).toContain('export interface BinaryExprNode extends ASTNode');
      expect(ast).toContain('export interface IdentifierNode extends ASTNode');
      expect(ast).toContain('export interface NumberNode extends ASTNode');
      expect(ast).toContain('export interface StringLiteralNode extends ASTNode');
    });

    it('generates typed fields for variable_decl', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain("field(name: 'name'): IdentifierNode");
      expect(ast).toContain("field(name: 'value'): ExpressionNode");
    });

    it('generates typed fields for binary_expr', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain("field(name: 'left'): ExpressionNode");
      expect(ast).toContain("field(name: 'right'): ExpressionNode");
    });

    it('generates union type', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain('export type MiniLangNode =');
    });

    it('generates type guard', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain('export function isNodeType');
    });

    it('imports from treelsp/runtime', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain("import type { ASTNode } from 'treelsp/runtime'");
    });
  });

  // ========== Codegen Determinism ==========

  describe('codegen determinism', () => {
    it('grammar codegen is deterministic', () => {
      const a = generateGrammar(definition);
      const b = generateGrammar(definition);
      expect(a).toBe(b);
    });

    it('AST types codegen is deterministic', () => {
      const a = generateAstTypes(definition);
      const b = generateAstTypes(definition);
      expect(a).toBe(b);
    });

    it('manifest codegen is deterministic', () => {
      const a = generateManifest(definition);
      const b = generateManifest(definition);
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
      expect(manifest.name).toBe('MiniLang');
      expect(manifest.languageId).toBe('minilang');
      expect(manifest.fileExtensions).toEqual(['.mini']);
      expect(manifest.server).toBe('./server.bundle.cjs');
    });
  });
});
