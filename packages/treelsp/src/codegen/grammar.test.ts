import { describe, it, expect } from 'vitest';
import { generateGrammar } from './grammar.js';
import type { LanguageDefinition } from '../definition/index.js';

describe('generateGrammar', () => {
  it('generates complete grammar for mini-lang-like example', () => {
    // This test demonstrates a complete example similar to mini-lang
    const definition: LanguageDefinition<
      | 'program' | 'statement' | 'variable_decl' | 'expr_statement'
      | 'expression' | 'binary_expr' | 'identifier' | 'number'
    > = {
      name: 'MiniLang',
      fileExtensions: ['.mini'],
      entry: 'program',
      word: 'identifier',

      grammar: {
        program: r => r.repeat(r.rule('statement')),

        statement: r => r.choice(
          r.rule('variable_decl'),
          r.rule('expr_statement'),
        ),

        variable_decl: r => r.seq(
          'let',
          r.field('name', r.rule('identifier')),
          '=',
          r.field('value', r.rule('expression')),
          ';',
        ),

        expr_statement: r => r.seq(
          r.field('expr', r.rule('expression')),
          ';',
        ),

        expression: r => r.choice(
          r.rule('binary_expr'),
          r.rule('identifier'),
          r.rule('number'),
        ),

        binary_expr: r => r.choice(
          r.prec.left(1, r.seq(
            r.field('left', r.rule('expression')),
            r.field('op', '+'),
            r.field('right', r.rule('expression')),
          )),
          r.prec.left(1, r.seq(
            r.field('left', r.rule('expression')),
            r.field('op', '-'),
            r.field('right', r.rule('expression')),
          )),
          r.prec.left(2, r.seq(
            r.field('left', r.rule('expression')),
            r.field('op', '*'),
            r.field('right', r.rule('expression')),
          )),
          r.prec.left(2, r.seq(
            r.field('left', r.rule('expression')),
            r.field('op', '/'),
            r.field('right', r.rule('expression')),
          )),
        ),

        identifier: r => r.token(/[a-zA-Z_][a-zA-Z0-9_]*/),
        number: r => r.token(/[0-9]+/),
      },
    };

    const result = generateGrammar(definition);

    // Verify it's a valid Tree-sitter grammar structure
    expect(result).toContain('module.exports = grammar({');
    expect(result).toContain('name: "MiniLang"');
    expect(result).toContain('word: $ => $.identifier');
    expect(result).toContain('rules: {');

    // Verify all rules are present
    expect(result).toContain('program: $ => repeat($.statement)');
    expect(result).toContain('statement: $ => choice(');
    expect(result).toContain('variable_decl: $ => seq(');
    expect(result).toContain('expr_statement: $ => seq(');
    expect(result).toContain('expression: $ => choice(');
    expect(result).toContain('binary_expr: $ => choice(');
    expect(result).toContain('identifier: $ => token(/[a-zA-Z_][a-zA-Z0-9_]*/)');
    expect(result).toContain('number: $ => token(/[0-9]+/)');

    // Verify field usage
    expect(result).toContain('field("name", $.identifier)');
    expect(result).toContain('field("value", $.expression)');
    expect(result).toContain('field("left", $.expression)');
    expect(result).toContain('field("right", $.expression)');
    expect(result).toContain('field("op", "+")');

    // Verify precedence
    expect(result).toContain('prec.left(1,');
    expect(result).toContain('prec.left(2,');

    // Log the full output for manual inspection
    console.log('\n' + '='.repeat(80));
    console.log('Generated grammar.js:');
    console.log('='.repeat(80));
    console.log(result);
    console.log('='.repeat(80) + '\n');
  });

  it('generates a basic grammar.js', () => {
    const definition: LanguageDefinition<'program' | 'statement' | 'identifier' | 'number'> = {
      name: 'TestLang',
      fileExtensions: ['.test'],
      entry: 'program',
      word: 'identifier',

      grammar: {
        program: r => r.repeat(r.rule('statement')),
        statement: r => r.rule('identifier'),
        identifier: r => r.token(/[a-zA-Z]+/),
        number: r => r.token(/[0-9]+/),
      },
    };

    const result = generateGrammar(definition);

    // Should have module.exports and grammar function
    expect(result).toContain('module.exports = grammar({');
    expect(result).toContain('name: "TestLang"');

    // Should include word config
    expect(result).toContain('word: $ => $.identifier');

    // Should have rules
    expect(result).toContain('program: $ => repeat($.statement)');
    expect(result).toContain('identifier: $ => token(/[a-zA-Z]+/)');
    expect(result).toContain('number: $ => token(/[0-9]+/)');
  });

  it('generates seq rules', () => {
    const definition: LanguageDefinition<'rule1' | 'rule2'> = {
      name: 'SeqTest',
      fileExtensions: ['.seq'],
      entry: 'rule1',

      grammar: {
        rule1: r => r.seq('let', r.rule('rule2'), ';'),
        rule2: r => r.token(/[a-z]+/),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('rule1: $ => seq(');
    expect(result).toContain('"let"');
    expect(result).toContain('$.rule2');
    expect(result).toContain('";"');
  });

  it('generates choice rules', () => {
    const definition: LanguageDefinition<'expr' | 'a' | 'b'> = {
      name: 'ChoiceTest',
      fileExtensions: ['.choice'],
      entry: 'expr',

      grammar: {
        expr: r => r.choice(r.rule('a'), r.rule('b')),
        a: r => r.token('a'),
        b: r => r.token('b'),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('expr: $ => choice(');
    expect(result).toContain('$.a');
    expect(result).toContain('$.b');
  });

  it('generates field rules', () => {
    const definition: LanguageDefinition<'decl' | 'name'> = {
      name: 'FieldTest',
      fileExtensions: ['.field'],
      entry: 'decl',

      grammar: {
        decl: r => r.seq(
          'let',
          r.field('name', r.rule('name')),
          ';'
        ),
        name: r => r.token(/[a-z]+/),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('field("name", $.name)');
  });

  it('generates precedence rules', () => {
    const definition: LanguageDefinition<'expr' | 'binary'> = {
      name: 'PrecTest',
      fileExtensions: ['.prec'],
      entry: 'expr',

      grammar: {
        expr: r => r.choice(r.rule('binary')),
        binary: r => r.choice(
          r.prec.left(1, r.seq(r.rule('expr'), '+', r.rule('expr'))),
          r.prec.left(2, r.seq(r.rule('expr'), '*', r.rule('expr'))),
        ),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('prec.left(1,');
    expect(result).toContain('prec.left(2,');
  });

  it('generates conflicts config', () => {
    const definition: LanguageDefinition<'rule1' | 'rule2'> = {
      name: 'ConflictTest',
      fileExtensions: ['.conflict'],
      entry: 'rule1',

      conflicts: r => [
        [r.rule('rule1'), r.rule('rule2')],
      ],

      grammar: {
        rule1: r => r.token('a'),
        rule2: r => r.token('b'),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('conflicts: $ => [');
    expect(result).toContain('$.rule1');
    expect(result).toContain('$.rule2');
  });

  it('generates extras config with regex', () => {
    const definition: LanguageDefinition<'program' | 'identifier'> = {
      name: 'ExtrasRegexTest',
      fileExtensions: ['.extras'],
      entry: 'program',

      extras: _r => [/\s+/],

      grammar: {
        program: r => r.repeat(r.rule('identifier')),
        identifier: r => r.token(/[a-zA-Z]+/),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('extras: $ => [');
    expect(result).toContain('/\\s+/');
  });

  it('generates extras config with rule reference', () => {
    const definition: LanguageDefinition<'program' | 'identifier' | 'comment'> = {
      name: 'ExtrasRuleTest',
      fileExtensions: ['.extras'],
      entry: 'program',

      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      extras: r => [/\s+/, r.rule('comment')],

      grammar: {
        program: r => r.repeat(r.rule('identifier')),
        identifier: r => r.token(/[a-zA-Z]+/),
        comment: r => r.token(/\/\/.*/),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('extras: $ => [');
    expect(result).toContain('/\\s+/');
    expect(result).toContain('$.comment');
  });

  it('does not emit extras when not specified', () => {
    const definition: LanguageDefinition<'program'> = {
      name: 'NoExtrasTest',
      fileExtensions: ['.noextras'],
      entry: 'program',

      grammar: {
        program: r => r.token('x'),
      },
    };

    const result = generateGrammar(definition);
    expect(result).not.toContain('extras');
  });

  it('handles optional, repeat, and repeat1', () => {
    const definition: LanguageDefinition<'program' | 'item'> = {
      name: 'RepeatTest',
      fileExtensions: ['.repeat'],
      entry: 'program',

      grammar: {
        program: r => r.seq(
          r.repeat(r.rule('item')),
          r.repeat1(r.rule('item')),
          r.optional(r.rule('item'))
        ),
        item: r => r.token('x'),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('repeat($.item)');
    expect(result).toContain('repeat1($.item)');
    expect(result).toContain('optional($.item)');
  });

  it('handles alias', () => {
    const definition: LanguageDefinition<'rule1'> = {
      name: 'AliasTest',
      fileExtensions: ['.alias'],
      entry: 'rule1',

      grammar: {
        rule1: r => r.alias(r.token('foo'), 'bar'),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('alias(');
    expect(result).toContain('"bar"');
  });

  it('handles prec, prec.right, prec.dynamic', () => {
    const definition: LanguageDefinition<'rule1'> = {
      name: 'PrecVariantsTest',
      fileExtensions: ['.precvar'],
      entry: 'rule1',

      grammar: {
        rule1: r => r.choice(
          r.prec(5, r.token('a')),
          r.prec.right(3, r.token('b')),
          r.prec.dynamic(1, r.token('c'))
        ),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('prec(5,');
    expect(result).toContain('prec.right(3,');
    expect(result).toContain('prec.dynamic(1,');
  });

  it('handles token.immediate', () => {
    const definition: LanguageDefinition<'rule1'> = {
      name: 'TokenImmediateTest',
      fileExtensions: ['.tokimm'],
      entry: 'rule1',

      grammar: {
        rule1: r => r.token.immediate(r.token(/x/)),
      },
    };

    const result = generateGrammar(definition);
    expect(result).toContain('token.immediate(');
  });

  it('throws when entry rule does not exist in grammar', () => {
    const definition = {
      name: 'Test',
      fileExtensions: ['.test'],
      entry: 'nonexistent',
      grammar: {
        program: (r: any) => r.token('x'),
      },
    } as LanguageDefinition;

    expect(() => generateGrammar(definition))
      .toThrow("Entry rule 'nonexistent' is not defined in grammar");
  });

  it('throws when word rule does not exist in grammar', () => {
    const definition = {
      name: 'Test',
      fileExtensions: ['.test'],
      entry: 'program',
      word: 'identifieer',
      grammar: {
        program: (r: any) => r.token('x'),
        identifier: (r: any) => r.token(/[a-z]+/),
      },
    } as LanguageDefinition;

    expect(() => generateGrammar(definition))
      .toThrow("Word rule 'identifieer' is not defined in grammar");
  });

  it('throws when word rule is not a token rule', () => {
    const definition = {
      name: 'Test',
      fileExtensions: ['.test'],
      entry: 'program',
      word: 'expression',
      grammar: {
        program: (r: any) => r.repeat(r.rule('expression')),
        expression: (r: any) => r.choice(r.rule('identifier'), r.rule('number')),
        identifier: (r: any) => r.token(/[a-z]+/),
        number: (r: any) => r.token(/[0-9]+/),
      },
    } as LanguageDefinition;

    expect(() => generateGrammar(definition))
      .toThrow("Word rule 'expression' must be a token rule");
  });
});
