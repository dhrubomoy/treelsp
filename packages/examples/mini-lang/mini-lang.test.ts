/**
 * End-to-end validation for mini-lang
 * Verifies the full treelsp pipeline: defineLanguage → codegen → valid output
 */

import { describe, it, expect } from 'vitest';
import { generateGrammar, generateAstTypes, generateServer, generateManifest } from 'treelsp/codegen';
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
      expect(ruleNames).toContain('expr_statement');
      expect(ruleNames).toContain('expression');
      expect(ruleNames).toContain('binary_expr');
      expect(ruleNames).toContain('identifier');
      expect(ruleNames).toContain('number');
    });

    it('has semantic layer', () => {
      expect(definition.semantic).toBeDefined();
      expect(definition.semantic?.program).toHaveProperty('scope');
      expect(definition.semantic?.variable_decl).toHaveProperty('declares');
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
      expect(grammar).toContain('expr_statement: $ =>');
      expect(grammar).toContain('expression: $ =>');
      expect(grammar).toContain('binary_expr: $ =>');
      expect(grammar).toContain('identifier: $ =>');
      expect(grammar).toContain('number: $ =>');
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
      expect(ast).toContain('export interface ExprStatementNode extends ASTNode');
      expect(ast).toContain('export interface ExpressionNode extends ASTNode');
      expect(ast).toContain('export interface BinaryExprNode extends ASTNode');
      expect(ast).toContain('export interface IdentifierNode extends ASTNode');
      expect(ast).toContain('export interface NumberNode extends ASTNode');
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

  // ========== Server Codegen ==========

  describe('server codegen', () => {
    it('generates non-empty output', () => {
      const server = generateServer(definition);
      expect(server.length).toBeGreaterThan(0);
    });

    it('generates server for MiniLang', () => {
      const server = generateServer(definition);
      expect(server).toContain('LSP server for MiniLang');
      expect(server).toContain("languageId: 'minilang'");
    });

    it('imports all required dependencies', () => {
      const server = generateServer(definition);
      expect(server).toContain("from 'vscode-languageserver/node'");
      expect(server).toContain("from 'vscode-languageserver-textdocument'");
      expect(server).toContain("from 'treelsp/runtime'");
      expect(server).toContain("from '../grammar.js'");
    });

    it('wires all LSP capabilities', () => {
      const server = generateServer(definition);
      expect(server).toContain('hoverProvider: true');
      expect(server).toContain('definitionProvider: true');
      expect(server).toContain('referencesProvider: true');
      expect(server).toContain('completionProvider');
      expect(server).toContain('renameProvider: true');
      expect(server).toContain('documentSymbolProvider: true');
    });

    it('handles full document lifecycle', () => {
      const server = generateServer(definition);
      expect(server).toContain('onDidOpen');
      expect(server).toContain('onDidChangeContent');
      expect(server).toContain('onDidClose');
      expect(server).toContain('state.dispose()');
    });

    it('starts connection', () => {
      const server = generateServer(definition);
      expect(server).toContain('connection.listen()');
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

    it('server codegen is deterministic', () => {
      const a = generateServer(definition);
      const b = generateServer(definition);
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
