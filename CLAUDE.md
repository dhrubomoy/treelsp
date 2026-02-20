# CLAUDE.md

## What This Project Is
treelsp — a grammar-first LSP generator with pluggable parser backends (Tree-sitter, Lezer).
Read DESIGN.md for the full design. It is the source of truth for all decisions.

## How To Work On This Project
- Read DESIGN.md before implementing any module
- Follow the implementation order in DESIGN.md § Implementation Order exactly
- Only src/definition/ and src/defaults/ are public API — never expose codegen/ or runtime/ directly
- Ask before making any design decision not explicitly covered in DESIGN.md
- Prefer simple and explicit over clever

## After Every Change
- Add or update unit tests to cover the change (if applicable)
- Run `pnpm test` and make sure all tests pass
- Run `pnpm build` and make sure there are no errors or warnings
- Run `pnpm lint` and make sure there are no errors

## Monorepo Commands
pnpm build           # build all packages
pnpm test            # run all tests
pnpm lint            # lint all packages
pnpm -r dev          # watch mode for all packages
pnpm --filter treelsp build   # build a single package

## Package Responsibilities
- treelsp         — authoring API + codegen + runtime (the core)
- @treelsp/cli    — CLI only, dev tool, never a runtime dependency
- @treelsp/vscode — VS Code extension, separate release lifecycle
- examples        — not published, used for end-to-end validation

## Decisions Already Made — Do Not Revisit
- Grammar builder uses r => function style: r.seq(), r.choice(), r.repeat() etc.
- Builder method names are inspired by Tree-sitter (seq, choice, repeat, prec, field...) but serve as a backend-agnostic grammar API — each backend's codegen maps them appropriately
- r.rule('name') is used instead of $.name — same concept, type-safe
- No custom DSL — TypeScript is the grammar definition format
- 4 packages: treelsp, @treelsp/cli, @treelsp/vscode, examples
- Build tool is tsdown — not tsup (tsup is unmaintained)
- pnpm workspaces
- TypeScript strict mode + exactOptionalPropertyTypes + noUncheckedIndexedAccess
- Vitest for testing, ESLint 9 for linting
- Target: Node.js + Browser (WASM via web-tree-sitter)
- No $ proxy — forward references solved by r.rule() string references

## Key External Docs
- Tree-sitter grammar API: https://tree-sitter.github.io/tree-sitter/creating-parsers
- web-tree-sitter: https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web
- vscode-languageserver: https://github.com/microsoft/vscode-languageserver-node
- LSP spec: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/