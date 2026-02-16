/**
 * mini-lang - Minimal example language for treelsp
 * A simple language with variables, functions, and basic expressions
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
      r.rule('function_decl'),
      r.rule('return_statement'),
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

    // Function declaration: fn name(params) { body }
    function_decl: r => r.seq(
      'fn',
      r.field('name', r.rule('identifier')),
      '(',
      r.field('params', r.optional(r.rule('parameter_list'))),
      ')',
      r.field('body', r.rule('block')),
    ),

    // Comma-separated parameter list
    parameter_list: r => r.seq(
      r.rule('parameter'),
      r.repeat(r.seq(',', r.rule('parameter'))),
    ),

    // Single parameter
    parameter: r => r.field('name', r.rule('identifier')),

    // Block: { statement* }
    block: r => r.seq(
      '{',
      r.repeat(r.rule('statement')),
      '}',
    ),

    // Return statement: return expr;
    return_statement: r => r.seq(
      'return',
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
      r.rule('call_expr'),
      r.rule('identifier'),
      r.rule('number'),
      r.rule('string_literal'),
    ),

    // Function call: name(args)
    call_expr: r => r.prec(3, r.seq(
      r.field('callee', r.rule('identifier')),
      '(',
      r.field('args', r.optional(r.rule('argument_list'))),
      ')',
    )),

    // Comma-separated argument list
    argument_list: r => r.seq(
      r.rule('expression'),
      r.repeat(r.seq(',', r.rule('expression'))),
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
    string_literal: r => r.token(/"[^"]*"/),
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

    // Function declarations introduce names and create scope
    function_decl: {
      scope: 'lexical',
      declares: {
        field: 'name',
        scope: 'enclosing',
      },
    },

    // Parameters introduce names in function scope
    parameter: {
      declares: {
        field: 'name',
        scope: 'local',
      },
    },

    // Block creates a lexical scope
    block: { scope: 'lexical' },

    // Identifiers in expressions are references
    identifier: {
      references: {
        field: 'name',
        to: ['variable_decl', 'function_decl', 'parameter'],
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
      'fn': { detail: 'Declare a function' },
      'return': { detail: 'Return a value' },
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

    // Hover for functions
    function_decl: {
      completionKind: 'Function',
      symbol: {
        kind: 'Function',
        label: n => n.field('name').text,
      },
      hover(node, ctx) {
        const name = node.field('name').text;
        return `**fn** \`${name}\``;
      },
    },

    // Hover for parameters
    parameter: {
      completionKind: 'Variable',
    },
  },
});
