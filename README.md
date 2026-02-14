# treelsp

A Langium-style LSP generator using Tree-sitter as the parsing backend.

**Status:** Early development - core API design phase

## What Is treelsp?

treelsp lets you define a programming language in TypeScript and automatically generates a full Language Server Protocol (LSP) implementation. You get:

- **Tree-sitter's parsing** — fast, error-tolerant, incremental, battle-tested
- **Langium's developer experience** — grammar-first, generates a full LSP
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
    // ... more rules
  },

  semantic: {
    program: { scope: 'global' },
    variable_decl: {
      declares: { field: 'name', scope: 'enclosing' },
    },
    identifier: {
      references: { field: 'name', to: 'variable_decl', onUnresolved: 'error' },
    },
  },
});
```

Out of the box this gives you: parse errors, unresolved reference diagnostics, go-to-definition, find references, rename, scope-based completion, keyword completion, generic hover, and document symbols.

## Repository Structure

This is a pnpm monorepo with 4 packages:

- **treelsp** — core authoring API + codegen + runtime
- **@treelsp/cli** — CLI tool for code generation
- **@treelsp/vscode** — VS Code extension
- **examples** — example languages (mini-lang)

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 9+
- Tree-sitter CLI (for compiling grammars to WASM)

### Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run in watch mode
pnpm dev
```

### Project Commands

```bash
pnpm build       # Build all packages
pnpm test        # Run all tests
pnpm lint        # Lint all packages
pnpm dev         # Watch mode for all packages
pnpm clean       # Clean all build artifacts
```

### CLI Commands

```bash
treelsp init      # Scaffold a new language project
treelsp generate  # Generate grammar.js, AST types, server
treelsp build     # Compile grammar to WASM
treelsp watch     # Watch mode - re-run generate + build
```

## Documentation

- [DESIGN.md](./DESIGN.md) — Complete design document (source of truth)
- [CLAUDE.md](./CLAUDE.md) — Project instructions and conventions
- [examples/mini-lang](./packages/examples/mini-lang) — Minimal working example

## Tech Stack

| Concern | Tool |
|---|---|
| Language | TypeScript 5.4+ |
| Package manager | pnpm |
| Build | tsdown |
| Testing | Vitest |
| Linting | ESLint 9 |
| Parser | Tree-sitter |
| LSP server | vscode-languageserver |
| Target | Node.js + Browser (WASM) |

## Implementation Status

Currently implementing in this order (see DESIGN.md § Implementation Order):

1. ✅ Project setup and monorepo structure
2. ✅ Definition layer types (grammar, semantic, validation, lsp)
3. ⏳ Grammar codegen (emit grammar.js)
4. ⏳ CLI tooling
5. ⏳ Runtime parser (Tree-sitter WASM loading, ASTNode wrapper)
6. ⏳ Scope resolution
7. ⏳ LSP handlers
8. ⏳ End-to-end validation

## Key Design Decisions

- **Grammar builder**: `r => r.seq(...)` function style (type-safe, ergonomic)
- **Method names**: Match Tree-sitter exactly (familiar for Tree-sitter users)
- **Forward references**: `r.rule('name')` instead of `$.name` (type-safe)
- **No custom DSL**: TypeScript is the grammar format
- **Strict TypeScript**: `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`
- **Build tool**: tsdown (not tsup - unmaintained)

## License

MIT

## Related Projects

- [Tree-sitter](https://tree-sitter.github.io) — The parsing engine
- [Langium](https://langium.org) — Prior art for grammar-first LSP generation
- [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web) — WASM bindings
