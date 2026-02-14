# mini-lang

Minimal example language for treelsp.

## Features

- Variable declarations: `let x = 42;`
- Basic arithmetic: `+`, `-`, `*`, `/`
- References to declared variables

## Example

```mini
let x = 10;
let y = 20;
let z = x + y * 2;
```

## Generated Files

After running `treelsp generate && treelsp build`:

- `generated/grammar.js` - Tree-sitter grammar
- `generated/grammar.wasm` - Compiled parser
- `generated/ast.ts` - Typed AST node interfaces
- `generated/server.ts` - LSP server entry point
