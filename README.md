# treelsp

Define a programming language in TypeScript. Get a full Language Server for free.

treelsp is a grammar-first LSP generator powered by [Tree-sitter](https://tree-sitter.github.io).

- **Tree-sitter's parsing** — fast, error-tolerant, incremental, battle-tested
- **Grammar-first DX** — define grammar + semantics, get a full LSP
- **TypeScript throughout** — no new DSLs to learn

## Quick Example

```typescript
import { defineLanguage } from 'treelsp';

export default defineLanguage({
  name: 'MyLang',
  fileExtensions: ['.mylang'],
  entry: 'program',
  word: 'identifier',

  grammar: {
    program:        r => r.repeat(r.rule('statement')),
    statement:      r => r.choice(r.rule('variable_decl'), r.rule('expr_statement')),
    variable_decl:  r => r.seq('let', r.field('name', r.rule('identifier')), '=', r.field('value', r.rule('expression')), ';'),
    expr_statement: r => r.seq(r.field('expr', r.rule('expression')), ';'),
    expression:     r => r.choice(r.rule('identifier'), r.rule('number')),
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

That's it. Out of the box you get: parse error diagnostics, unresolved reference diagnostics, go-to-definition, find references, rename, scope-based completion, keyword completion, hover, document symbols, and syntax highlighting.

## How It Works

From one `defineLanguage()` call, treelsp generates:

```
generated/
  grammar.js           # Tree-sitter grammar
  grammar.wasm         # compiled parser
  ast.ts               # typed AST node interfaces
  treelsp.json         # manifest for VS Code extension
  server.bundle.cjs    # self-contained language server
  queries/
    highlights.scm     # syntax highlighting (Tree-sitter editors)
    locals.scm         # scope queries (Tree-sitter editors)
```

The language server handles LSP features automatically. The `.scm` query files provide native syntax highlighting in Tree-sitter editors (Neovim, Helix, Zed). For VS Code, the server provides equivalent highlighting via LSP semantic tokens.

## Getting Started

```bash
npm install -D treelsp @treelsp/cli

treelsp init           # scaffold a new language project
treelsp generate       # generate grammar, AST types, queries, manifest
treelsp build          # compile WASM parser + bundle server
treelsp watch          # watch mode — regenerate on changes
```

### Prerequisites

- Node.js 18+
- [tree-sitter CLI](https://github.com/tree-sitter/tree-sitter/blob/master/cli/README.md) for compiling grammars to WASM

## The Four Layers

### Grammar — what the syntax looks like

Builder methods match Tree-sitter exactly (`seq`, `choice`, `repeat`, `field`, `prec.left`, etc.). Forward references use `r.rule('name')` — type-safe, no Proxy magic.

```typescript
grammar: {
  binary_expr: r => r.prec.left(3, r.seq(
    r.field('left', r.rule('expression')),
    '+',
    r.field('right', r.rule('expression')),
  )),
}
```

### Semantic — what names mean

Three concepts: **declarations** (introduce names), **references** (use names), **scopes** (boundaries). This drives go-to-definition, find references, rename, and completion automatically.

```typescript
semantic: {
  program:       { scope: 'global' },
  function_decl: { scope: 'lexical', declares: { field: 'name', scope: 'enclosing' } },
  variable_decl: { declares: { field: 'name', scope: 'enclosing' } },
  identifier:    { references: { field: 'name', to: ['variable_decl', 'function_decl'], onUnresolved: 'error' } },
}
```

### Validation — custom error checking

Validators are plain functions. Run after parsing and scope resolution.

```typescript
validation: {
  variable_decl(node, ctx) {
    if (!node.field('type') && !node.field('value')) {
      ctx.error(node, 'Variable must have a type or an initializer');
    }
  },
}
```

### LSP — editor presentation

Hover, completion detail, document symbols. Everything else is automatic.

```typescript
lsp: {
  variable_decl: {
    completionKind: 'Variable',
    symbol: { kind: 'Variable', label: n => n.field('name').text },
    hover(node) {
      return `**let** \`${node.field('name').text}\``;
    },
  },
}
```

## Defaults System

Three levels of engagement for every feature:

1. **Zero config** — works automatically from grammar + semantic
2. **Configure** — tweak with simple options
3. **Override** — replace with your own function, optionally calling defaults

```typescript
import { defineLanguage, defaults } from 'treelsp';

export default defineLanguage({
  lsp: {
    variable_decl: {
      hover(node, ctx) {
        const base = defaults.lsp.hover(node, ctx);
        return `${base}\n\n${lookupDocs(node.field('name').text)}`;
      },
    },
  },
});
```

## Repository Structure

pnpm monorepo with 4 packages:

| Package | Description |
|---------|-------------|
| [`treelsp`](./packages/treelsp) | Core — authoring API, codegen, runtime |
| [`@treelsp/cli`](./packages/cli) | CLI tool — `init`, `generate`, `build`, `watch` |
| [`@treelsp/vscode`](./packages/vscode) | VS Code extension — discovers and launches language servers |
| [`examples`](./packages/examples) | Example languages — [mini-lang](./packages/examples/mini-lang), [schema-lang](./packages/examples/schema-lang) |

## Development

```bash
pnpm install          # install dependencies
pnpm build            # build all packages
pnpm test             # run all tests
pnpm lint             # lint all packages
pnpm -r dev           # watch mode
```

## Tech Stack

| Concern | Tool |
|---------|------|
| Language | TypeScript (strict mode) |
| Package manager | pnpm |
| Build | tsdown |
| Testing | Vitest |
| Linting | ESLint 9 |
| Parser | Tree-sitter (web-tree-sitter) |
| LSP | vscode-languageserver |
| Target | Node.js + Browser (WASM) |

## Documentation

- [DESIGN.md](./DESIGN.md) — full design document (source of truth for all decisions)
- [@treelsp/cli README](./packages/cli/README.md) — CLI usage and configuration

## Related Projects

- [Tree-sitter](https://tree-sitter.github.io) — the parsing engine
- [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web) — WASM bindings

## License

MIT
