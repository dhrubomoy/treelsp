# treelsp

Define a programming language in TypeScript. Get a full Language Server for free.

treelsp is a grammar-first LSP generator with pluggable parser backends. You define a grammar in TypeScript — treelsp generates a full Language Server. The default backend is [Tree-sitter](https://tree-sitter.github.io), with [Lezer](https://lezer.codemirror.net/) as an alternative. The architecture supports adding more backends by implementing one interface.

- **Pluggable parser backends** — Tree-sitter by default, Lezer also supported
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

The grammar definition is **backend-agnostic** — the same `defineLanguage()` call works with both Tree-sitter and Lezer. The builder methods (`r.seq()`, `r.choice()`, `r.repeat()`, `r.field()`, `r.prec.left()`, etc.) map to the appropriate backend constructs during code generation.

## How It Works

From one `defineLanguage()` call, treelsp generates all the files needed for a working language server. The output depends on which parser backend you choose:

**Tree-sitter** (default):
```
generated/
  grammar.js           # Tree-sitter grammar
  grammar.wasm         # compiled WASM parser
  tree-sitter.wasm     # Tree-sitter runtime
  ast.ts               # typed AST node interfaces
  treelsp.json         # manifest for VS Code extension
  server.bundle.cjs    # self-contained language server
  syntax.tmLanguage.json
  queries/
    highlights.scm     # syntax highlighting (Tree-sitter editors)
    locals.scm         # scope queries (Tree-sitter editors)
```

**Lezer**:
```
generated-lezer/
  grammar.lezer        # Lezer grammar specification
  parser.js            # compiled Lezer parser
  parser.bundle.js     # self-contained parser bundle
  parser-meta.json     # field/node metadata
  ast.ts               # typed AST node interfaces
  treelsp.json         # manifest for VS Code extension
  server.bundle.cjs    # self-contained language server
  syntax.tmLanguage.json
```

Both backends produce a `server.bundle.cjs` that speaks the LSP protocol over stdio. The VS Code extension discovers the `treelsp.json` manifest and launches the server — no backend-specific configuration needed on the editor side.

The Tree-sitter backend also generates `.scm` query files for native syntax highlighting in Tree-sitter editors (Neovim, Helix, Zed). For VS Code, the server provides equivalent highlighting via LSP semantic tokens regardless of backend.

## Getting Started

```bash
treelsp init           # prompts for name, file extension, and parser backend
cd my-lang
pnpm install
pnpm build             # generate + compile + bundle server
```

Press F5 in VS Code to launch the extension and test your language.

### Prerequisites

- Node.js 20+
- **Tree-sitter backend**: [tree-sitter CLI](https://github.com/tree-sitter/tree-sitter/blob/master/cli/README.md) (`npm install -g tree-sitter-cli`)
- **Lezer backend**: no additional tools required (pure JavaScript compilation)

### CLI Commands

```bash
treelsp init           # scaffold a new language project
treelsp generate       # generate grammar, AST types, queries, manifest
treelsp build          # compile parser + bundle language server
treelsp watch          # watch mode — regenerate on changes
```

All commands read from `treelsp-config.json` (or `"treelsp"` field in `package.json`). Use `-f <file>` to specify a config file explicitly.

### Choosing a Backend

By default, treelsp uses Tree-sitter. To use Lezer, set `"backend": "lezer"` in your config. You can even generate both backends from the same grammar:

```json
{
  "languages": [
    { "grammar": "packages/language/grammar.ts" },
    { "grammar": "packages/language/grammar.ts", "backend": "lezer", "out": "packages/language/generated-lezer" }
  ]
}
```

| | Tree-sitter | Lezer |
|---|---|---|
| **External CLI** | Required (`tree-sitter-cli`) | None (pure JS) |
| **Compilation** | C → WebAssembly | JavaScript |
| **Build speed** | Slower (WASM compilation) | Faster |
| **Query files** | `highlights.scm`, `locals.scm` | None |
| **Indentation** | C scanner file | Built-in ExternalTokenizer |
| **Editor support** | Neovim, Helix, Zed (native) + VS Code (LSP) | VS Code (LSP) |

## Top-Level Options

| Option | Purpose |
|---|---|
| `entry` | Entry rule name (required) |
| `word` | Keyword extraction rule — prevents keywords matching as identifiers |
| `extras` | Tokens that can appear anywhere: `extras: r => [/\s+/, r.rule('comment')]` |
| `conflicts` | Explicit GLR conflict declarations |
| `externals` | External scanner tokens: `externals: r => [r.rule('indent'), r.rule('dedent')]` |

## The Four Layers

### Grammar — what the syntax looks like

Builder methods are backend-agnostic (`seq`, `choice`, `repeat`, `field`, `prec.left`, etc.). Forward references use `r.rule('name')` — type-safe, no Proxy magic.

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
| [`treelsp`](./packages/treelsp) | Core — authoring API, codegen (Tree-sitter + Lezer), runtime |
| [`@treelsp/cli`](./packages/cli) | CLI tool — `init`, `generate`, `build`, `watch` |
| [`@treelsp/vscode`](./packages/vscode) | VS Code extension — discovers and launches language servers |
| [`examples`](./packages/examples) | Example languages — [mini-lang](./packages/examples/mini-lang), [schema-lang](./packages/examples/schema-lang), [indent-lang](./packages/examples/indent-lang) |

### Export Paths

| Path | Purpose |
|---|---|
| `treelsp` | Public API: `defineLanguage`, types, defaults |
| `treelsp/codegen` | CLI-only: shared codegen (ast-types, manifest) |
| `treelsp/codegen/tree-sitter` | CLI-only: `TreeSitterCodegen` class |
| `treelsp/codegen/lezer` | CLI-only: `LezerCodegen` class |
| `treelsp/runtime` | Runtime: interfaces, scope, LSP handlers |
| `treelsp/backend/tree-sitter` | Server bundle: `TreeSitterRuntime` class |
| `treelsp/backend/lezer` | Server bundle: `LezerRuntime` class |
| `treelsp/server` | Server bundle: `startStdioServer()` |

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
| Parsers | Tree-sitter (web-tree-sitter), Lezer (@lezer/lr) |
| LSP | vscode-languageserver |
| Target | Node.js + Browser (WASM) |

## Documentation

- [DESIGN.md](./DESIGN.md) — full design document (source of truth for all decisions)
- [@treelsp/cli README](./packages/cli/README.md) — CLI usage and configuration

## Related Projects

- [Tree-sitter](https://tree-sitter.github.io) — incremental parsing engine
- [Lezer](https://lezer.codemirror.net/) — CodeMirror's parser system
- [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web) — WASM bindings

## License

MIT
