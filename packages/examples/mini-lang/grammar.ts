/**
 * mini-lang - Minimal example language for treelsp
 * A simple language with variables and basic expressions
 */

import { defineLanguage } from 'treelsp';

export default defineLanguage({
  name: 'MiniLang',
  fileExtensions: ['.mini'],
  entry: 'program',
  word: 'identifier',

  extras: r => [/\s+/, r.rule('comment')],

  grammar: {
    // Program is a sequence of statements
    program: r => r.repeat(r.rule('statement')),

    // Statements
    statement: r => r.choice(
      r.rule('variable_decl'),
      r.rule('expr_statement'),
    ),

    // Variable declaration: let name = value;
    variable_decl: r => r.seq(
      'let',
      r.field('name', r.rule('identifier')),
      '=',
      r.field('value', r.rule('expression')),
      ';',
    ),

    // Expression statement: expr;
    expr_statement: r => r.seq(
      r.field('expr', r.rule('expression')),
      ';',
    ),

    // Expressions
    expression: r => r.choice(
      r.rule('binary_expr'),
      r.rule('identifier'),
      r.rule('number'),
    ),

    // Binary expressions with precedence
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

    // Tokens
    identifier: r => r.token(/[a-zA-Z_][a-zA-Z0-9_]*/),
    number: r => r.token(/[0-9]+/),
    comment: r => r.token(/\/\/.*/),
  },

  semantic: {
    // Program creates global scope
    program: { scope: 'global' },

    // Variable declarations introduce names
    variable_decl: {
      declares: {
        field: 'name',
        scope: 'enclosing',
      },
    },

    // Identifiers in expressions are references
    identifier: {
      references: {
        field: 'name',
        to: 'variable_decl',
        onUnresolved: 'error',
      },
    },
  },

  validation: {
    // Ensure variable has an initializer
    variable_decl(node, ctx) {
      if (!node.field('value')) {
        ctx.error(node, 'Variable must have an initializer', {
          property: 'value',
        });
      }
    },
  },

  lsp: {
    // Keyword completions
    $keywords: {
      'let': { detail: 'Declare a variable' },
    },

    // Hover for variables
    variable_decl: {
      completionKind: 'Variable',
      symbol: {
        kind: 'Variable',
        label: n => n.field('name').text,
      },
      hover(node, ctx) {
        const name = node.field('name').text;
        return `**let** \`${name}\``;
      },
    },
  },
});
