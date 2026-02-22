/**
 * indent-lang — A Python-like language with indentation-based blocks
 * Demonstrates treelsp's `externals` support for external scanners
 */

import { defineLanguage } from 'treelsp';

export default defineLanguage({
  name: 'IndentLang',
  fileExtensions: ['.indent'],
  entry: 'program',
  word: 'identifier',

  // Horizontal whitespace only — newlines are significant (handled by external scanner)
  extras: r => [/[ \t]/, r.comment],

  // External scanner tokens for indentation-sensitive parsing
  externals: r => [r.indent, r.dedent, r.newline],

  grammar: {
    // Program is a sequence of statements separated by newlines
    program: r => r.repeat(r.choice(r.statement, r.newline)),

    // Statements
    statement: r => r.choice(
      r.function_def,
      r.if_stmt,
      r.return_stmt,
      r.assignment,
      r.expr_stmt,
    ),

    // Assignment: name = value\n
    assignment: r => r.seq(
      r.field('name', r.identifier),
      '=',
      r.field('value', r.expression),
      r.newline,
    ),

    // Function definition: def name(params):\n indent body dedent
    function_def: r => r.seq(
      'def',
      r.field('name', r.identifier),
      '(',
      r.field('params', r.optional(r.parameter_list)),
      ')',
      ':',
      r.field('body', r.block),
    ),

    // If statement: if condition:\n indent body dedent
    if_stmt: r => r.seq(
      'if',
      r.field('condition', r.expression),
      ':',
      r.field('body', r.block),
    ),

    // Return statement: return value\n
    return_stmt: r => r.seq(
      'return',
      r.field('value', r.expression),
      r.newline,
    ),

    // Expression statement: expression\n
    expr_stmt: r => r.seq(
      r.field('expr', r.expression),
      r.newline,
    ),

    // Indented block: newline indent statements dedent
    block: r => r.seq(
      r.newline,
      r.indent,
      r.repeat1(r.statement),
      r.dedent,
    ),

    // Comma-separated parameter list
    parameter_list: r => r.seq(
      r.parameter,
      r.repeat(r.seq(',', r.parameter)),
    ),

    // Single parameter
    parameter: r => r.field('name', r.identifier),

    // Expressions
    expression: r => r.choice(
      r.binary_expr,
      r.call_expr,
      r.identifier,
      r.number,
      r.string_literal,
    ),

    // Function call: callee(args)
    call_expr: r => r.prec(3, r.seq(
      r.field('callee', r.identifier),
      '(',
      r.field('args', r.optional(r.argument_list)),
      ')',
    )),

    // Comma-separated argument list
    argument_list: r => r.seq(
      r.expression,
      r.repeat(r.seq(',', r.expression)),
    ),

    // Binary expressions with precedence
    binary_expr: r => r.choice(
      r.prec.left(1, r.seq(
        r.field('left', r.expression),
        r.field('op', '+'),
        r.field('right', r.expression),
      )),
      r.prec.left(1, r.seq(
        r.field('left', r.expression),
        r.field('op', '-'),
        r.field('right', r.expression),
      )),
      r.prec.left(2, r.seq(
        r.field('left', r.expression),
        r.field('op', '*'),
        r.field('right', r.expression),
      )),
      r.prec.left(2, r.seq(
        r.field('left', r.expression),
        r.field('op', '/'),
        r.field('right', r.expression),
      )),
    ),

    // Tokens
    identifier: r => r.token(/[a-zA-Z_][a-zA-Z0-9_]*/),
    number: r => r.token(/[0-9]+/),
    string_literal: r => r.token(/"[^"]*"/),
    comment: r => r.token(/#.*/),
  },

  semantic: {
    // Program creates global scope
    program: { scope: 'global' },

    // Assignment declares a variable
    assignment: {
      declares: {
        field: 'name',
        scope: 'enclosing',
        visibility: 'public',
        strategy: 'if-not-declared',
      },
    },

    // Function definition creates scope and declares name
    function_def: {
      scope: 'lexical',
      declares: {
        field: 'name',
        scope: 'enclosing',
        visibility: 'public',
      },
    },

    // Parameters declare in local (function) scope
    parameter: {
      declares: {
        field: 'name',
        scope: 'local',
      },
    },

    // Identifiers in expressions are references
    identifier: {
      references: {
        field: 'name',
        to: ['assignment', 'function_def', 'parameter'],
        onUnresolved: 'warning',
      },
    },
  },

  lsp: {
    // Keyword completions
    $keywords: {
      'def': { detail: 'Define a function' },
      'if': { detail: 'Conditional statement' },
      'return': { detail: 'Return a value' },
    },

    // Hover and symbols for assignments
    assignment: {
      completionKind: 'Variable',
      symbol: {
        kind: 'Variable',
        label: n => n.field('name').text,
      },
      hover(node) {
        const name = node.field('name').text;
        return `**variable** \`${name}\``;
      },
    },

    // Hover and symbols for functions
    function_def: {
      completionKind: 'Function',
      symbol: {
        kind: 'Function',
        label: n => n.field('name').text,
      },
      hover(node) {
        const name = node.field('name').text;
        const paramList = node.field('params');
        if (!paramList) return `**def** \`${name}()\``;
        const names = paramList.namedChildren
          .filter((c: any) => c.type === 'parameter')
          .map((p: any) => p.field('name').text);
        return `**def** \`${name}(${names.join(', ')})\``;
      },
    },

    // Parameters
    parameter: {
      completionKind: 'Variable',
      semanticToken: 'parameter',
    },
  },
});
