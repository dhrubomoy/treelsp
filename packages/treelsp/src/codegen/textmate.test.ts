import { describe, it, expect } from 'vitest';
import { generateTextmate } from './textmate.js';
import type { LanguageDefinition } from '../definition/index.js';

type MiniLangRules =
  | 'program' | 'statement' | 'variable_decl' | 'expr_statement'
  | 'expression' | 'binary_expr' | 'identifier' | 'number'
  | 'string_literal' | 'comment';

function createMiniLangDefinition(): LanguageDefinition<MiniLangRules> {
  return {
    name: 'MiniLang',
    fileExtensions: ['.mini'],
    entry: 'program',
    word: 'identifier',

    grammar: {
      program: r => r.repeat(r.statement),
      statement: r => r.choice(r.variable_decl, r.expr_statement),
      variable_decl: r => r.seq(
        'let',
        r.field('name', r.identifier),
        '=',
        r.field('value', r.expression),
        ';',
      ),
      expr_statement: r => r.seq(r.field('expr', r.expression), ';'),
      expression: r => r.choice(r.binary_expr, r.identifier, r.number, r.string_literal),
      binary_expr: r => r.choice(
        r.prec.left(1, r.seq(r.field('left', r.expression), '+', r.field('right', r.expression))),
        r.prec.left(1, r.seq(r.field('left', r.expression), '-', r.field('right', r.expression))),
        r.prec.left(2, r.seq(r.field('left', r.expression), '*', r.field('right', r.expression))),
      ),
      identifier: r => r.token(/[a-zA-Z_][a-zA-Z0-9_]*/),
      number: r => r.token(/[0-9]+/),
      string_literal: r => r.token(/"[^"]*"/),
      comment: r => r.token(/\/\/.*/),
    },

    lsp: {
      $keywords: { 'let': { detail: 'Declare a variable' } },
      variable_decl: { completionKind: 'Variable' },
    },
  };
}

describe('generateTextmate', () => {
  it('generates valid JSON', () => {
    const result = generateTextmate(createMiniLangDefinition());
    const parsed = JSON.parse(result);
    expect(parsed).toBeDefined();
  });

  it('sets correct name and scopeName', () => {
    const result = JSON.parse(generateTextmate(createMiniLangDefinition()));
    expect(result.name).toBe('MiniLang');
    expect(result.scopeName).toBe('source.minilang');
  });

  it('includes comment pattern from token rule', () => {
    const result = JSON.parse(generateTextmate(createMiniLangDefinition()));
    expect(result.repository.comment).toBeDefined();
    expect(result.repository.comment.match).toBe('\\/\\/.*');
    expect(result.repository.comment.name).toContain('comment.line.');
  });

  it('includes string pattern from token rule', () => {
    const result = JSON.parse(generateTextmate(createMiniLangDefinition()));
    expect(result.repository.string).toBeDefined();
    expect(result.repository.string.name).toContain('string.quoted.');
  });

  it('includes number pattern from token rule', () => {
    const result = JSON.parse(generateTextmate(createMiniLangDefinition()));
    expect(result.repository.number).toBeDefined();
    expect(result.repository.number.match).toBe('[0-9]+');
    expect(result.repository.number.name).toContain('constant.numeric.');
  });

  it('generates keyword pattern from string literals', () => {
    const result = JSON.parse(generateTextmate(createMiniLangDefinition()));
    expect(result.repository.keyword).toBeDefined();
    expect(result.repository.keyword.match).toContain('let');
    expect(result.repository.keyword.name).toContain('keyword.control.');
  });

  it('generates operator pattern from non-alphabetic strings', () => {
    const result = JSON.parse(generateTextmate(createMiniLangDefinition()));
    expect(result.repository.operator).toBeDefined();
    expect(result.repository.operator.match).toContain('\\+');
    expect(result.repository.operator.match).toContain('-');
    expect(result.repository.operator.match).toContain('\\*');
    expect(result.repository.operator.name).toContain('keyword.operator.');
  });

  it('includes patterns in correct priority order', () => {
    const result = JSON.parse(generateTextmate(createMiniLangDefinition()));
    const includes = (result.patterns as Array<{ include: string }>).map(p => p.include);
    // Comment should come before keyword
    const commentIdx: number = includes.indexOf('#comment');
    const keywordIdx: number = includes.indexOf('#keyword');
    expect(commentIdx).toBeLessThan(keywordIdx);
  });

  it('uses word boundaries for keywords', () => {
    const result = JSON.parse(generateTextmate(createMiniLangDefinition()));
    const match = result.repository.keyword.match;
    expect(match).toMatch(/^\\b\(.+\)\\b$/);
  });

  it('handles language with no lsp definition', () => {
    const def: LanguageDefinition<'program' | 'identifier' | 'number'> = {
      name: 'Bare',
      fileExtensions: ['.bare'],
      entry: 'program',
      grammar: {
        program: r => r.repeat(r.choice(r.identifier, r.number)),
        identifier: r => r.token(/[a-zA-Z_]+/),
        number: r => r.token(/[0-9]+/),
      },
    };
    const result = JSON.parse(generateTextmate(def));
    expect(result.scopeName).toBe('source.bare');
    expect(result.repository.number).toBeDefined();
  });

  it('handles hash-style comments', () => {
    const def: LanguageDefinition<'program' | 'comment'> = {
      name: 'HashLang',
      fileExtensions: ['.hash'],
      entry: 'program',
      grammar: {
        program: r => r.repeat(r.comment),
        comment: r => r.token(/#.*/),
      },
    };
    const result = JSON.parse(generateTextmate(def));
    expect(result.repository.comment).toBeDefined();
    expect(result.repository.comment.name).toContain('comment.line.');
  });

  it('produces deterministic output', () => {
    const result1 = generateTextmate(createMiniLangDefinition());
    const result2 = generateTextmate(createMiniLangDefinition());
    expect(result1).toBe(result2);
  });

  it('escapes special regex characters in operators', () => {
    const result = JSON.parse(generateTextmate(createMiniLangDefinition()));
    const opMatch = result.repository.operator.match;
    // + and * should be escaped
    expect(opMatch).toContain('\\+');
    expect(opMatch).toContain('\\*');
  });
});
