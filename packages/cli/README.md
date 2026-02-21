# @treelsp/cli

CLI tool for [treelsp](https://github.com/dhrubomoy/treelsp) — generate parsers and language servers from TypeScript grammar definitions. Supports Tree-sitter and Lezer backends.

## Installation

```bash
npm install -D @treelsp/cli
# or
pnpm add -D @treelsp/cli
```

## Commands

### `treelsp init`

Scaffold a new language project interactively.

```bash
treelsp init
```

Prompts for a language name and file extension, then creates a pnpm monorepo with two packages:
- `packages/language/` — grammar definition (`grammar.ts`) and generated files
- `packages/extension/` — VS Code extension that launches the language server

Also generates root config files (`treelsp-config.json`, `pnpm-workspace.yaml`, `.vscode/launch.json`).

### `treelsp generate`

Generate grammar files, AST types, manifest, and syntax highlighting queries from a language definition.

```
Usage: treelsp generate [options]

Options:
  -f, --file <file>  path to treelsp-config.json or package.json with treelsp field
  -w, --watch        watch for changes
```

**Output files** depend on the backend:

**Tree-sitter** (default, written to `generated/`):
- `grammar.js` — Tree-sitter grammar (CommonJS)
- `ast.ts` — typed AST interfaces
- `treelsp.json` — manifest for VS Code extension discovery
- `syntax.tmLanguage.json` — TextMate grammar
- `queries/highlights.scm` — Tree-sitter syntax highlighting
- `queries/locals.scm` — Tree-sitter scope/locals

**Lezer** (written to `generated-lezer/` or custom `out` path):
- `grammar.lezer` — Lezer grammar specification
- `parser-meta.json` — field/node metadata
- `ast.ts` — typed AST interfaces
- `treelsp.json` — manifest for VS Code extension discovery
- `syntax.tmLanguage.json` — TextMate grammar

### `treelsp build`

Compile the generated grammar and bundle the language server.

```
Usage: treelsp build [options]

Options:
  -f, --file <file>  path to treelsp-config.json or package.json with treelsp field
```

**Tree-sitter backend** requires the [tree-sitter CLI](https://github.com/tree-sitter/tree-sitter/blob/master/cli/README.md) (`npm install -g tree-sitter-cli` or `cargo install tree-sitter-cli`).

**Lezer backend** requires no external tools (pure JavaScript compilation).

**Output files:**

Tree-sitter:
- `grammar.wasm` — compiled WebAssembly parser
- `server.bundle.cjs` — self-contained language server bundle
- `tree-sitter.wasm` — web-tree-sitter runtime

Lezer:
- `parser.js` — compiled Lezer parser
- `parser.bundle.js` — self-contained parser bundle (includes @lezer/lr)
- `server.bundle.cjs` — self-contained language server bundle

### `treelsp watch`

Watch mode — re-runs `generate` + `build` automatically when grammar files change.

```
Usage: treelsp watch [options]

Options:
  -f, --file <file>  path to treelsp-config.json or package.json with treelsp field
```

## Configuration

By default, treelsp looks for `grammar.ts` in the current directory and outputs to `generated/` using the Tree-sitter backend. For multi-language or multi-backend projects, create a config file.

### Config discovery order

When `-f` is not provided, the CLI searches from the current directory upward for:

1. `treelsp-config.json`
2. A `"treelsp"` field in `package.json`
3. Falls back to legacy mode (`grammar.ts` in cwd)

### `treelsp-config.json`

```json
{
  "languages": [
    { "grammar": "packages/language/grammar.ts" },
    { "grammar": "packages/language/grammar.ts", "backend": "lezer", "out": "packages/language/generated-lezer" }
  ]
}
```

### `package.json`

```json
{
  "treelsp": {
    "languages": [
      { "grammar": "src/grammar.ts", "out": "src/generated" }
    ]
  }
}
```

### Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `languages` | array | yes | List of language projects |
| `languages[].grammar` | string | yes | Path to `grammar.ts`, relative to the config file |
| `languages[].out` | string | no | Output directory (default: `<grammar dir>/generated`) |
| `languages[].backend` | string | no | Parser backend: `"tree-sitter"` (default) or `"lezer"` |

## Typical Workflow

**New project:**

```bash
treelsp init           # scaffold project with language + extension packages
cd my-lang
pnpm install
pnpm build             # generate + compile + bundle
# Press F5 in VS Code to launch the extension
```

**Generate for both backends:**

```json
{
  "languages": [
    { "grammar": "packages/language/grammar.ts" },
    { "grammar": "packages/language/grammar.ts", "backend": "lezer", "out": "packages/language/generated-lezer" }
  ]
}
```

```bash
treelsp generate       # generates for all configured backends
treelsp build          # builds all configured backends
treelsp watch          # watches all grammar files
```
