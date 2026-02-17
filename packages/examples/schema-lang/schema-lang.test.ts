/**
 * End-to-end validation for schema-lang
 * Verifies the full treelsp pipeline: defineLanguage → codegen → valid output
 */

import { describe, it, expect } from 'vitest';
import { generateGrammar, generateAstTypes, generateManifest } from 'treelsp/codegen';
import definition from './grammar.js';

describe('schema-lang end-to-end', () => {
  // ========== Language Definition ==========

  describe('language definition', () => {
    it('has correct metadata', () => {
      expect(definition.name).toBe('SchemaLang');
      expect(definition.fileExtensions).toEqual(['.schema']);
      expect(definition.entry).toBe('schema');
      expect(definition.word).toBe('identifier');
    });

    it('defines all grammar rules', () => {
      const ruleNames = Object.keys(definition.grammar);
      expect(ruleNames).toContain('schema');
      expect(ruleNames).toContain('declaration');
      expect(ruleNames).toContain('type_decl');
      expect(ruleNames).toContain('field_decl');
      expect(ruleNames).toContain('enum_decl');
      expect(ruleNames).toContain('variant');
      expect(ruleNames).toContain('type_ref');
      expect(ruleNames).toContain('identifier');
      expect(ruleNames).toContain('comment');
    });

    it('has semantic layer', () => {
      expect(definition.semantic).toBeDefined();
      expect(definition.semantic?.schema).toHaveProperty('scope');
      expect(definition.semantic?.type_decl).toHaveProperty('scope');
      expect(definition.semantic?.type_decl).toHaveProperty('declares');
      expect(definition.semantic?.enum_decl).toHaveProperty('scope');
      expect(definition.semantic?.enum_decl).toHaveProperty('declares');
      expect(definition.semantic?.field_decl).toHaveProperty('declares');
      expect(definition.semantic?.variant).toHaveProperty('declares');
      expect(definition.semantic?.type_ref).toHaveProperty('references');
    });

    it('has validation layer', () => {
      expect(definition.validation).toBeDefined();
      expect(definition.validation?.type_decl).toBeDefined();
    });

    it('has LSP layer', () => {
      expect(definition.lsp).toBeDefined();
      expect(definition.lsp?.$keywords).toBeDefined();
      expect(definition.lsp?.type_decl).toBeDefined();
      expect(definition.lsp?.enum_decl).toBeDefined();
      expect(definition.lsp?.field_decl).toBeDefined();
      expect(definition.lsp?.variant).toBeDefined();
    });
  });

  // ========== Grammar Codegen ==========

  describe('grammar codegen', () => {
    it('generates valid Tree-sitter grammar', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('module.exports = grammar({');
      expect(grammar).toContain('name: "SchemaLang"');
      expect(grammar).toContain('word: $ => $.identifier');
    });

    it('includes all rules', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('schema: $ =>');
      expect(grammar).toContain('declaration: $ =>');
      expect(grammar).toContain('type_decl: $ =>');
      expect(grammar).toContain('field_decl: $ =>');
      expect(grammar).toContain('enum_decl: $ =>');
      expect(grammar).toContain('variant: $ =>');
      expect(grammar).toContain('type_ref: $ =>');
      expect(grammar).toContain('identifier: $ =>');
      expect(grammar).toContain('comment: $ =>');
    });

    it('generates fields for type_decl', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('field("name", $.identifier)');
    });

    it('generates fields for field_decl', () => {
      const grammar = generateGrammar(definition);
      expect(grammar).toContain('field("type", $.type_ref)');
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

    it('generates interfaces for all rules', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain('export interface SchemaNode extends ASTNode');
      expect(ast).toContain('export interface DeclarationNode extends ASTNode');
      expect(ast).toContain('export interface TypeDeclNode extends ASTNode');
      expect(ast).toContain('export interface FieldDeclNode extends ASTNode');
      expect(ast).toContain('export interface EnumDeclNode extends ASTNode');
      expect(ast).toContain('export interface VariantNode extends ASTNode');
      expect(ast).toContain('export interface TypeRefNode extends ASTNode');
      expect(ast).toContain('export interface IdentifierNode extends ASTNode');
    });

    it('generates typed fields for field_decl', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain("field(name: 'name'): IdentifierNode");
      expect(ast).toContain("field(name: 'type'): TypeRefNode");
    });

    it('generates union type', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain('export type SchemaLangNode =');
    });

    it('generates type guard', () => {
      const ast = generateAstTypes(definition);
      expect(ast).toContain('export function isNodeType');
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
      expect(manifest.name).toBe('SchemaLang');
      expect(manifest.languageId).toBe('schemalang');
      expect(manifest.fileExtensions).toEqual(['.schema']);
      expect(manifest.server).toBe('./server.bundle.cjs');
    });

    it('is deterministic', () => {
      const a = generateManifest(definition);
      const b = generateManifest(definition);
      expect(a).toBe(b);
    });
  });
});
