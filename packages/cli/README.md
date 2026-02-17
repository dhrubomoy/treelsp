# @treelsp/cli

CLI tool for [treelsp](https://github.com/dhrubomoy/treelsp) — generate Tree-sitter grammars, WASM parsers, and language servers from TypeScript definitions.

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

Prompts for a language name and file extension, then creates a project directory with:
- `grammar.ts` — language definition template
- `package.json` — dependencies and scripts
- `tsconfig.json` — TypeScript configuration
- `.gitignore`

### `treelsp generate`

Generate grammar.js, AST types, manifest, and syntax highlighting queries from a language definition.

```
Usage: treelsp generate [options]

Options:
  -f, --file <file>  path to treelsp-config.json or package.json with treelsp field
  -w, --watch        watch for changes
```

**Output files** (written to the output directory, default `generated/`):
- `grammar.js` — Tree-sitter grammar (CommonJS)
- `ast.ts` — typed AST interfaces
- `treelsp.json` — manifest for VS Code extension discovery
- `queries/highlights.scm` — Tree-sitter syntax highlighting
- `queries/locals.scm` — Tree-sitter scope/locals

### `treelsp build`

Compile the generated grammar to WASM and bundle the language server.

```
Usage: treelsp build [options]

Options:
  -f, --file <file>  path to treelsp-config.json or package.json with treelsp field
```

Requires the [tree-sitter CLI](https://github.com/tree-sitter/tree-sitter/blob/master/cli/README.md) to be installed (`npm install -g tree-sitter-cli` or `cargo install tree-sitter-cli`).

**Output files:**
- `grammar.wasm` — compiled WebAssembly parser
- `server.bundle.cjs` — self-contained language server bundle
- `tree-sitter.wasm` — web-tree-sitter runtime

### `treelsp watch`

Watch mode — re-runs `generate` + `build` automatically when grammar files change.

```
Usage: treelsp watch [options]

Options:
  -f, --file <file>  path to treelsp-config.json or package.json with treelsp field
```

## Configuration

By default, treelsp looks for `grammar.ts` in the current directory and outputs to `generated/`. For multi-language projects, create a config file to specify all languages.

### Config discovery order

When `-f` is not provided, the CLI searches from the current directory upward for:

1. `treelsp-config.json`
2. A `"treelsp"` field in `package.json`
3. Falls back to legacy mode (`grammar.ts` in cwd)

### `treelsp-config.json`

```json
{
  "languages": [
    { "grammar": "mini-lang/grammar.ts" },
    { "grammar": "schema-lang/grammar.ts" }
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

## Typical Workflow

**Single language (no config needed):**

```bash
treelsp init           # scaffold project
cd my-lang
npm install
treelsp generate       # generate grammar.js, ast.ts, etc.
treelsp build          # compile WASM + bundle server
```

**Multi-language monorepo:**

```bash
# treelsp-config.json at repo root
treelsp generate       # generates all languages
treelsp build          # builds all languages
treelsp watch          # watches all grammar files
```
