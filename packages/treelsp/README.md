# treelsp

Define a programming language in TypeScript. Get a full Language Server for free.

treelsp is a grammar-first LSP generator powered by [Tree-sitter](https://tree-sitter.github.io). You describe your language's syntax and semantics in TypeScript — treelsp generates a Tree-sitter grammar, typed AST, syntax highlighting queries, and a complete LSP server.

## Installation

```bash
npm install treelsp
npm install -D @treelsp/cli
```

The core `treelsp` package is a runtime dependency. The CLI (`@treelsp/cli`) is used during development to generate and build your language.

## Usage

Create a `grammar.ts` file:

```typescript
import { defineLanguage } from 'treelsp';

export default defineLanguage({
  name: 'MyLang',
  fileExtensions: ['.mylang'],
  entry: 'program',
  word: 'identifier',

  grammar: {
    program:        r => r.repeat(r.statement),
    statement:      r => r.choice(r.variable_decl, r.expr_statement),
    variable_decl:  r => r.seq('let', r.field('name', r.identifier), '=', r.field('value', r.expression), ';'),
    expr_statement: r => r.seq(r.field('expr', r.expression), ';'),
    expression:     r => r.choice(r.identifier, r.number),
    identifier:     r => r.token(/[a-zA-Z_][a-zA-Z0-9_]*/),
    number:         r => r.token(/[0-9]+/),
  },

  semantic: {
    program:       { scope: 'global' },
    variable_decl: { declares: { field: 'name', scope: 'enclosing' } },
    identifier:    { references: { field: 'name', to: 'variable_decl', onUnresolved: 'error' } },
  },
});
```

Then generate and build:

```bash
treelsp generate    # emit grammar.js, AST types, queries, manifest
treelsp build       # compile WASM parser + bundle server
```

## What You Get

With just grammar + semantic, these LSP features work automatically:

- Parse error diagnostics
- Unresolved reference diagnostics
- Go-to-definition
- Find all references
- Rename (across files)
- Scope-based completion
- Keyword completion
- Hover (resolves references to declarations)
- Document symbols
- Syntax highlighting (semantic tokens + Tree-sitter `.scm` queries)

## API

### `defineLanguage(config)`

The main entry point. Takes a configuration object with four layers:

| Layer | Purpose | Required |
|-------|---------|----------|
| `grammar` | Syntax rules — what the language looks like | Yes |
| `semantic` | Name resolution — declarations, references, scopes | Yes |
| `validation` | Custom error checking — runs after scope resolution | No |
| `lsp` | Editor presentation — hover text, completion detail, symbols | No |

### Grammar Builder

Builder methods match Tree-sitter exactly:

| Method | Tree-sitter equivalent |
|--------|------------------------|
| `r.seq(a, b, c)` | `seq(a, b, c)` |
| `r.choice(a, b)` | `choice(a, b)` |
| `r.optional(a)` | `optional(a)` |
| `r.repeat(a)` | `repeat(a)` |
| `r.repeat1(a)` | `repeat1(a)` |
| `r.field(name, rule)` | `field(name, rule)` |
| `r.prec(n, rule)` | `prec(n, rule)` |
| `r.prec.left(n, rule)` | `prec.left(n, rule)` |
| `r.prec.right(n, rule)` | `prec.right(n, rule)` |
| `r.token(rule)` | `token(rule)` |
| `r.name` | `$.name` |

### Top-Level Options

Beyond `grammar`, `semantic`, `validation`, and `lsp`, `defineLanguage` accepts these options:

| Option | Purpose |
|--------|---------|
| `word` | Token rule for keyword extraction. When set, string literals like `"let"` and `"if"` are treated as reserved keywords that won't match as identifiers. Should point to your identifier rule. |
| `extras` | Tokens that can appear anywhere (typically whitespace and comments). Defaults to `[/\s/]`. |
| `conflicts` | GLR conflict declarations for ambiguous grammars — needed when the parser can't decide between two rules without extra lookahead. |
| `externals` | External scanner tokens for context-sensitive lexing (e.g., indent/dedent for Python-style languages). |

```typescript
export default defineLanguage({
  name: 'MyLang',
  fileExtensions: ['.mylang'],
  entry: 'program',
  word: 'identifier',
  extras: r => [/\s/, r.comment],
  conflicts: r => [[r.expression, r.type_expression]],
  externals: r => [r.indent, r.dedent, r.newline],

  grammar: { /* ... */ },
});
```

### Semantic Layer

Three concepts drive all name resolution:

- **Scopes** — `{ scope: 'global' | 'lexical' | 'isolated' }`
- **Declarations** — `{ declares: { field, scope, visibility?, strategy? } }`
- **References** — `{ references: { field, to, onUnresolved? } }`

### Defaults

Every feature has three levels: zero config, configure, or override with full control.

```typescript
import { defineLanguage, defaults } from 'treelsp';

export default defineLanguage({
  lsp: {
    variable_decl: {
      hover(node, ctx) {
        const base = defaults.lsp.hover(node, ctx);
        return `${base}\n\nSee docs for more info.`;
      },
    },
  },
});
```

## Exports

| Path | Contents |
|------|----------|
| `treelsp` | `defineLanguage`, definition types, `defaults` |
| `treelsp/runtime` | Shared runtime interfaces (ASTNode, DocumentState, scope, LSP handlers) |
| `treelsp/codegen` | Shared code generation (AST types, manifest, TextMate grammar) |
| `treelsp/codegen/tree-sitter` | Tree-sitter grammar/highlights/locals codegen |
| `treelsp/codegen/lezer` | Lezer grammar codegen |
| `treelsp/backend/tree-sitter` | Tree-sitter runtime (parser, document state) |
| `treelsp/backend/lezer` | Lezer runtime (parser, document state) |
| `treelsp/server` | LSP stdio transport (used by generated servers) |

## License

MIT
