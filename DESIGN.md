# treelsp — Design Document

> **Purpose:** This document is the source of truth for the treelsp project design. It captures all architectural decisions, API shapes, and rationale. Use it as a reference when implementing.

---

## What Is treelsp?

treelsp is a Langium-style LSP generator that uses Tree-sitter as its parsing backend. You define a grammar in TypeScript → treelsp generates a full Language Server.

**Core value proposition:**
- Tree-sitter's parsing (fast, error-tolerant, incremental, battle-tested)
- Langium's developer experience (grammar-first, generates a full LSP)
- TypeScript throughout — no new DSLs to learn

**Incremental parsing**
- v1 strategy: keystroke → full Tree-sitter reparse → full AST rebuild → full scope rebuild
- v1 does NOT pass the old tree to `parser.parse()` — full reparse every time
  (passing old tree requires `tree.edit()` with byte-offset edit info, deferred to v2)
- AST and scope are full recompute on every change — simple and correct
- Internal `DocumentState.update()` method owns all three steps behind a clean boundary
- This boundary is intentionally designed so v2 can swap in incremental CST + AST + scope
  without any breaking changes to the public API
- Invalidation-based incremental (using tree.getChangedRanges()) is the v2 target
- Full persistent data structures (rust-analyzer style) explicitly out of scope

---

## Repository Structure

pnpm monorepo with 4 packages:

```
treelsp/
├── packages/
│   ├── treelsp/              # core — authoring API + codegen + runtime
│   ├── cli/                  # @treelsp/cli — CLI tool
│   ├── vscode/               # @treelsp/vscode — VS Code extension
│   └── examples/             # not published — mini-lang example
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

### Package: `treelsp`

```
src/
  index.ts                   # public API re-exports
  define.ts                  # defineLanguage() entry point
  definition/
    grammar.ts               # seq, choice, repeat, prec, rule, token, field...
    semantic.ts              # declares, references, scope kinds
    validation.ts            # ValidationContext, validator types
    lsp.ts                   # LspContext, hover, completion, symbol types
    index.ts
  defaults/
    hover.ts
    completion.ts
    validation.ts
    symbols.ts
    index.ts
  codegen/
    grammar.ts               # emit grammar.js for Tree-sitter
    ast-types.ts             # emit typed AST node interfaces
    server.ts                # emit treelsp.json manifest
    highlights.ts            # emit queries/highlights.scm
    locals.ts                # emit queries/locals.scm
  runtime/
    parser/
      node.ts                # ASTNode wrapper
      tree.ts                # document tree, incremental updates
      wasm.ts                # WASM loader — Node.js vs browser
    scope/
      scope.ts
      resolver.ts
      workspace.ts           # cross-file index
    lsp/
      server.ts
      documents.ts
      diagnostics.ts
      completion.ts
      hover.ts
      definition.ts
      references.ts
      rename.ts
      symbols.ts
      semantic-tokens.ts     # semantic token encoding for syntax highlighting
  cli/
    generate.ts
    build.ts
    watch.ts
    init.ts
```

`definition/` and `defaults/` are public API. `codegen/` and `runtime/` are internal — never imported directly by users.

### Package: `@treelsp/cli`

Thin CLI wrapper around treelsp's codegen. Dev tool only — never a runtime dependency.

Commands: `treelsp init`, `treelsp generate`, `treelsp build`, `treelsp watch`

Dependencies: `treelsp`, `commander`, `ora`, `prompts`, `picocolors`, `chokidar`

### Package: `@treelsp/vscode`

VS Code extension that launches generated LSP servers. Separate package because it has its own release lifecycle (VS Code Marketplace, not npm) and VS Code-specific dependencies.

### Dependency Graph

```
treelsp  ←  @treelsp/cli
         ←  @treelsp/vscode
         ←  examples
```

Clean and acyclic. `treelsp` has no internal package dependencies.

---

## Tech Stack

| Concern | Tool |
|---|---|
| Language | TypeScript 5.4+ |
| Package manager | pnpm |
| Build | tsdown |
| Testing | Vitest |
| Linting | ESLint 9 |
| Parser | Tree-sitter (web-tree-sitter for WASM) |
| LSP server | vscode-languageserver |
| Compilation target | Node.js + Browser (WASM) |

### tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are intentional — they catch real bugs in scope resolver and AST accessor code.

---

## Top-Level API

```typescript
import { defineLanguage } from 'treelsp';

export default defineLanguage({
  name: 'MyLang',
  fileExtensions: ['.mylang'],
  entry: 'program',
  word: 'identifier',         // keyword extraction — prevents keywords matching as identifiers

  conflicts: r => [           // explicit GLR conflict declarations
    [r.rule('expr_statement'), r.rule('variable_decl')],
  ],

  grammar: { ... },
  semantic: { ... },
  validation: { ... },
  lsp: { ... },
});
```

---

## Grammar Layer

### Design Decisions

- Rule builder function style: `r => r.seq(...)` — ergonomic, typed, no forward reference problem
- Method names match Tree-sitter exactly — users who know Tree-sitter are immediately at home
- `r.rule('name')` instead of `$.name` — same concept, but type-safe (typos are compile errors)
- No custom DSL — TypeScript is the grammar format

### Builder Methods — 1:1 with Tree-sitter

| Method | Tree-sitter equivalent |
|---|---|
| `r.seq(a, b, c)` | `seq(a, b, c)` |
| `r.choice(a, b)` | `choice(a, b)` |
| `r.optional(a)` | `optional(a)` |
| `r.repeat(a)` | `repeat(a)` |
| `r.repeat1(a)` | `repeat1(a)` |
| `r.field(name, rule)` | `field(name, rule)` |
| `r.prec(n, rule)` | `prec(n, rule)` |
| `r.prec.left(n, rule)` | `prec.left(n, rule)` |
| `r.prec.right(n, rule)` | `prec.right(n, rule)` |
| `r.prec.dynamic(n, rule)` | `prec.dynamic(n, rule)` |
| `r.token(regex)` | `token(regex)` |
| `r.token.immediate(rule)` | `token.immediate(rule)` |
| `r.alias(rule, name)` | `alias(rule, name)` |
| `r.rule(name)` | `$.rule_name` |

### Example

```typescript
grammar: {

  program: r => r.repeat(r.rule('statement')),

  statement: r => r.choice(
    r.rule('variable_decl'),
    r.rule('function_decl'),
    r.rule('expr_statement'),
  ),

  variable_decl: r => r.seq(
    'let',
    r.field('name', r.token('identifier')),
    r.optional(r.seq(':', r.field('type', r.rule('type_ref')))),
    '=',
    r.field('value', r.rule('expression')),
    ';',
  ),

  // Expressions — left recursion handled natively by Tree-sitter's GLR parser
  // Precedence numbers resolve ambiguity — higher number wins
  binary_expr: r => r.choice(
    r.prec.left(1, r.seq(r.field('left', r.rule('expression')), '||',  r.field('right', r.rule('expression')))),
    r.prec.left(2, r.seq(r.field('left', r.rule('expression')), '&&',  r.field('right', r.rule('expression')))),
    r.prec.left(3, r.seq(r.field('left', r.rule('expression')), '+',   r.field('right', r.rule('expression')))),
    r.prec.left(3, r.seq(r.field('left', r.rule('expression')), '-',   r.field('right', r.rule('expression')))),
    r.prec.left(4, r.seq(r.field('left', r.rule('expression')), '*',   r.field('right', r.rule('expression')))),
    r.prec.left(4, r.seq(r.field('left', r.rule('expression')), '/',   r.field('right', r.rule('expression')))),
    r.prec.right(5, r.seq(r.field('left', r.rule('expression')), '**', r.field('right', r.rule('expression')))),
  ),

  unary_expr: r => r.prec.right(6, r.seq(
    r.field('op', r.choice('!', '-')),
    r.field('operand', r.rule('expression')),
  )),

  call_expr: r => r.prec(7, r.seq(
    r.field('callee', r.rule('expression')),
    '(',
    r.field('args', r.optional(r.seq(
      r.rule('expression'),
      r.repeat(r.seq(',', r.rule('expression'))),
    ))),
    ')',
  )),

  expression: r => r.choice(
    r.rule('binary_expr'),
    r.rule('unary_expr'),
    r.rule('call_expr'),
    r.rule('identifier'),
    r.rule('literal'),
  ),

  identifier: r => r.token(/[a-zA-Z_][a-zA-Z0-9_]*/),
  number:     r => r.token(/[0-9]+(\.[0-9]+)?/),
  string:     r => r.token(/"([^"\\]|\\.)*"/),
  literal:    r => r.choice(r.rule('number'), r.rule('string')),

},
```

### Extras — Implicit Tokens

`extras` declares tokens that can appear anywhere without being listed in every rule. Most commonly whitespace and comments.

```typescript
export default defineLanguage({
  name: 'MyLang',
  extras: r => [/\s+/, r.rule('comment')],
  grammar: {
    comment: r => r.token(/\/\/.*/),
    // ...
  },
});
```

- Same builder function pattern as `conflicts` — top-level field, returns array
- Type-safe: `r.rule('comment')` autocompletes from grammar rule names
- If omitted, Tree-sitter defaults to `[/\s/]` (whitespace only)
- Maps directly to Tree-sitter's `extras: $ => [...]` in grammar.js

### Ambiguity Resolution — Tree-sitter's Model

Tree-sitter is a GLR parser. It forks parse state and pursues multiple interpretations simultaneously, resolving ambiguity through:

| Mechanism | Resolves | When to use |
|---|---|---|
| `prec(n)` | Which rule wins when both match | Mixed operator types, unary vs binary |
| `prec.left(n)` | Left vs right grouping | Most binary operators |
| `prec.right(n)` | Right vs left grouping | Exponentiation, assignment |
| `prec.dynamic(n)` | Context-sensitive priority | Dangling else, type-dependent parsing |
| `conflicts` | Intentional ambiguity | When semantic layer must resolve |
| `word` | Keyword vs identifier | Always — set for any language with keywords |

`conflicts` and `word` are top-level keys in `defineLanguage`, not inside `grammar`.

---

## Semantic Layer

Tree-sitter knows nothing about name meaning, references, or scope. The semantic layer is how you describe that. It drives go-to-definition, find references, rename, and completion automatically.

### Three Concepts

**Declarations** — this node introduces a name into scope
**References** — this node refers to a name declared elsewhere
**Scopes** — this node creates a new scope boundary

### Declarations

```typescript
semantic: {
  variable_decl: {
    declares: {
      field: 'name',            // which field holds the declared name
      scope: 'enclosing',       // where to declare it
      visibility: node =>       // optional — public or private
        node.hasChild('export') ? 'public' : 'private',
      strategy: 'if-not-declared',  // 'always' | 'if-not-declared'
      order: 'after-references',    // 'after-references' | 'before-references'
    },
  },
},
```

#### Scope Targets

| Value | Meaning |
|---|---|
| `'local'` | Immediately enclosing scope node |
| `'enclosing'` | Nearest enclosing scope boundary |
| `'global'` | Root scope |

#### Strategy (for declare + reference on same node)

| Value | Meaning |
|---|---|
| `'if-not-declared'` | Only declare if name not already visible in scope (default) |
| `'always'` | Always declare, shadowing any existing binding |

#### Order (for declare + reference on same node)

| Value | Meaning |
|---|---|
| `'after-references'` | RHS evaluated before declaration registered (default — Python-style) |
| `'before-references'` | Declaration visible to its own value (let rec style) |

### References

```typescript
semantic: {
  name_ref: {
    references: {
      field: 'name',
      to: ['variable_decl', 'param', 'function_decl'],  // one or many
      onUnresolved: 'error',    // 'error' | 'warning' | 'ignore'
    },
  },

  // Custom resolver — for member access, imports, generics etc.
  member_expr: {
    references: {
      field: 'member',
      to: 'field_decl',
      resolve(ref, ctx) {
        const objectType = ctx.typeOf(ref.node.childForFieldName('object'));
        return objectType
          ? ctx.scopeOf(objectType).lookup(ref.text, 'field_decl')
          : null;
      },
    },
  },
},
```

### Scopes

```typescript
semantic: {
  program:       { scope: 'global' },
  block:         { scope: 'lexical' },
  function_decl: { scope: 'lexical' },
},
```

#### Scope Kinds

| Kind | Meaning |
|---|---|
| `'global'` | Root scope, one per document |
| `'lexical'` | Standard block scope, inherits from parent |
| `'isolated'` | No access to parent scope (module boundaries) |

### Declare + Reference on Same Node

Supported in v1. Useful for Python-style implicit declaration:

```typescript
semantic: {
  assignment: {
    declares: {
      field: 'name',
      scope: 'enclosing',
      strategy: 'if-not-declared',
      order: 'after-references',
    },
    references: {
      field: 'name',
      to: ['variable_decl', 'assignment'],
      optional: true,           // ok if nothing found — means fresh declaration
    },
  },
},
```

### Cross-file Resolution

```typescript
semantic: {
  import_decl: {
    declares: {
      field: 'alias',
      scope: 'enclosing',
      resolve(decl, ctx) {
        const path = decl.node.childForFieldName('path').text;
        return ctx.resolveModule(path);
      },
    },
  },
},
```

### V1 Scope

| Feature | Status |
|---|---|
| Single-field declarations | ✅ In |
| Multi-field / qualified names | ❌ V2 |
| Visibility / export | ✅ In |
| Cross-file resolution | ✅ In |
| Declaration merging | ❌ V2 |
| Types in semantic layer | ❌ V2 (handle in lsp layer) |
| `onUnresolved` policy | ✅ In |
| Declare + reference on same node | ✅ In |
| Escape hatch resolver functions | ✅ In |

---

## Validation Layer

Validators run after parsing and scope resolution. Inspired by Langium but simpler — no registry, no DI, just functions.

### Shape

```typescript
validation: {

  // Single function
  variable_decl(node, ctx) {
    if (!node.field('type') && !node.field('value')) {
      ctx.error(node, 'Variable must have a type or an initializer');
    }
  },

  // Array of functions — all run, concerns stay separated
  function_decl: [
    checkDuplicateParams,
    checkBodyNotEmpty,
  ],

  // Document-level validator — runs once per document
  $document(ctx) {
    if (ctx.document.declarations({ visibility: 'public' }).length === 0) {
      ctx.warning(ctx.document.root, 'Module exports nothing');
    }
  },

  // Workspace-level validator — runs when any file changes
  $workspace(ctx) {
    const circular = ctx.workspace.findCircularImports();
    for (const cycle of circular) {
      ctx.error(cycle.node, `Circular import: ${cycle.path.join(' → ')}`);
    }
  },

},
```

### ValidationContext

```typescript
interface ValidationContext {
  error(node: ASTNode, message: string, options?: DiagnosticOptions): void;
  warning(node: ASTNode, message: string, options?: DiagnosticOptions): void;
  info(node: ASTNode, message: string, options?: DiagnosticOptions): void;
  hint(node: ASTNode, message: string, options?: DiagnosticOptions): void;
  resolve(node: ASTNode): ASTNode | null;
  scopeOf(node: ASTNode): Scope;
  declarationsOf(node: ASTNode): ASTNode[];
  referencesTo(node: ASTNode): ASTNode[];
  document: Document;
  workspace: Workspace;
}
```

### DiagnosticOptions

```typescript
interface DiagnosticOptions {
  at?: ASTNode;             // report on specific child node
  property?: string;        // Langium-style: highlight named field (e.g. 'params')
  index?: number;           // if property is array, which element
  fix?: {
    label: string;
    edits: TextEdit[];
  };
  code?: string;
  url?: string;
}
```

### Multiple Validators Per File

```typescript
// validators/structural.ts
export const structuralChecks = {
  function_decl: [checkDuplicateParams, checkBodyNotEmpty],
  variable_decl: [checkHasTypeOrValue],
};

// validators/types.ts
export const typeChecks = {
  function_decl: [checkReturnType],
  binary_expr: [checkOperandTypes],
};

// grammar.ts
import { mergeValidation } from 'treelsp';
export default defineLanguage({
  validation: mergeValidation(structuralChecks, typeChecks),
});
```

`mergeValidation` merges arrays per rule key. No registry needed.

### Execution Order

1. Parsing (Tree-sitter)
2. Scope resolution (semantic layer)
3. Built-in checks (unresolved references, duplicate declarations)
4. Custom node validators
5. `$document` validators
6. `$workspace` validators

---

## LSP Layer

Describes editor behaviour — hover, completion, symbols, signature help. Purely presentational — everything else is handled automatically.

### Shape

```typescript
lsp: {

  $keywords: {
    'let':    { detail: 'Declare a variable' },
    'fn':     { detail: 'Declare a function' },
    'return': { detail: 'Return from function' },
  },

  $unresolved(node, ctx) {
    return `Cannot resolve \`${node.text}\``;
  },

  variable_decl: {
    completionKind: 'Variable',
    symbol: { kind: 'Variable', label: n => n.field('name').text },
    hover(node, ctx) {
      const name = node.field('name').text;
      const type = node.field('type')?.text ?? 'unknown';
      return `**let** \`${name}\`: \`${type}\``;
    },
  },

  function_decl: {
    completionKind: 'Function',
    symbol: {
      kind: 'Function',
      label: n => n.field('name').text,
      detail: n => `(${n.fields('params').map(p => p.field('type').text).join(', ')})`,
    },
    hover(node, ctx) {
      const name = node.field('name').text;
      const params = node.fields('params')
        .map(p => `${p.field('name').text}: ${p.field('type').text}`)
        .join(', ');
      return `**fn** \`${name}\`(${params})`;
    },
    signature: {
      trigger: ['(', ','],
      label: n => `${n.field('name').text}(...)`,
      params: n => n.fields('params').map(p => ({
        label: `${p.field('name').text}: ${p.field('type').text}`,
      })),
      activeParam: (n, i) => Math.min(i, n.fields('params').length - 1),
    },
  },

  // Custom completion — for member access, imports etc.
  member_expr: {
    complete(node, ctx) {
      const type = ctx.typeOf(node.field('object'));
      return type?.members().map(m => ({
        label: m.name,
        kind: 'Field',
        detail: m.type,
      })) ?? [];
    },
  },

},
```

### LspContext

```typescript
interface LspContext {
  resolve(node: ASTNode): ASTNode | null;
  typeOf(node: ASTNode): TypeInfo | null;
  scopeOf(node: ASTNode): Scope;
  document: Document;
  workspace: Workspace;
}
```

### What Is Automatic

These LSP features work with zero configuration once the semantic layer is defined:

| Feature | Source |
|---|---|
| Go-to-definition | Fully automatic from semantic layer |
| Find references | Fully automatic from semantic layer |
| Rename | Fully automatic from semantic layer |
| Scope-based completion | Automatic from `completionKind` annotations |
| Keyword completion | Automatic from grammar + `$keywords` |
| Hover on references | Automatic — resolves to declaration, calls `hover` |
| Unresolved reference diagnostics | Automatic from `onUnresolved` policy |
| Syntax highlighting | Automatic — keywords, operators, declarations, literals classified from grammar + semantic |
| Semantic tokens | Automatic — LSP `textDocument/semanticTokens/full` from grammar + semantic + `completionKind` |
| Document sync + incremental reparse | Automatic via Tree-sitter |

---

## Defaults System

Three levels of engagement for every feature:

```
Level 1 — Zero config     works automatically from grammar + semantic
Level 2 — Configure       tweak with simple options
Level 3 — Override        replace with your own function, optionally calling defaults
```

### Usage

```typescript
import { defineLanguage, defaults } from 'treelsp';

export default defineLanguage({
  validation: {
    // Level 2 — extend the default
    function_decl: [
      defaults.validation.function_decl,  // run default first
      myExtraCheck,                        // then run yours
    ],

    // Level 3 — replace entirely
    variable_decl(node, ctx) {
      // default is ignored
    },
  },

  lsp: {
    // Level 2 — extend hover
    variable_decl: {
      hover(node, ctx) {
        const base = defaults.lsp.hover(node, ctx);
        return `${base}\n\n${lookupDocs(node.field('name').text)}`;
      },
    },

    // Level 3 — replace completion, suppress defaults
    function_decl: {
      complete(node, ctx) {
        return {
          items: myCompletions,
          replace: true,   // don't merge with scope-based defaults
        };
      },
    },
  },
});
```

### The `defaults` Object

```typescript
import { defaults } from 'treelsp';

defaults.validation.$references    // unresolved reference checker
defaults.validation.$declarations  // duplicate declaration checker
defaults.lsp.hover                 // generic hover from grammar shape
defaults.lsp.symbol                // generic symbol from name field
defaults.lsp.complete              // scope + keyword completions
defaults.lsp.definition            // resolve reference → declaration location
defaults.lsp.references            // find all references to declaration
defaults.lsp.rename                // rename all references
```

All are plain functions — call them, wrap them, compose them.

---

## Minimal Working Example

A complete language definition that works out of the box with no LSP configuration:

```typescript
import { defineLanguage } from 'treelsp';

export default defineLanguage({
  name: 'MyLang',
  fileExtensions: ['.mylang'],
  entry: 'program',
  word: 'identifier',

  grammar: {
    program:       r => r.repeat(r.rule('statement')),
    statement:     r => r.choice(r.rule('variable_decl'), r.rule('expr_statement')),
    variable_decl: r => r.seq('let', r.field('name', r.token('identifier')), '=', r.field('value', r.rule('expression')), ';'),
    expr_statement: r => r.seq(r.field('expr', r.rule('expression')), ';'),
    expression:    r => r.choice(r.rule('identifier'), r.rule('number')),
    identifier:    r => r.token(/[a-zA-Z_][a-zA-Z0-9_]*/),
    number:        r => r.token(/[0-9]+/),
  },

  semantic: {
    program:       { scope: 'global' },
    variable_decl: { declares: { field: 'name', scope: 'enclosing' } },
    identifier:    { references: { field: 'name', to: 'variable_decl', onUnresolved: 'error' } },
  },
});
```

Out of the box this gives you: parse errors, unresolved reference diagnostics, duplicate declaration diagnostics, go-to-definition, find references, rename, scope-based completion, keyword completion, generic hover, document symbols.

---

## Codegen Pipeline

From one `defineLanguage(...)` call, treelsp generates:

```
generated/
  grammar.js          ← Tree-sitter grammar (input to tree-sitter CLI)
  grammar.wasm        ← compiled parser (via tree-sitter generate + compile)
  ast.ts              ← typed AST node interfaces with field() overloads
  treelsp.json        ← manifest for VS Code extension discovery
  queries/
    highlights.scm    ← syntax highlighting queries (Tree-sitter format)
    locals.scm        ← scope queries (Tree-sitter format)
```

### Generated Queries

**highlights.scm** — maps grammar elements to highlight captures:
- Alphabetic string literals (e.g. `"let"`, `"fn"`) and `$keywords` → `@keyword`
- Bracket-like strings → `@punctuation.bracket`
- Delimiters (`;`, `,`, `.`, `:`) → `@punctuation.delimiter`
- Remaining string literals → `@operator`
- Declaration name fields → capture based on `completionKind` (Variable→`@variable`, Function→`@function`, Class→`@type`)
- Token rules classified by name heuristic (`number`→`@number`, `string`→`@string`, `comment`→`@comment`)
- Word rule (e.g. `identifier`) → `@variable` (fallback)

**locals.scm** — maps semantic rules to scope queries:
- Rules with `scope` → `@local.scope`
- Rules with `declares` → `@local.definition` (with field pattern)
- Rules with `references` → `@local.reference`

These queries are used by Tree-sitter editors (Neovim, Helix, Zed) for native syntax highlighting and scope resolution. For VS Code, the LSP semantic tokens handler provides equivalent highlighting via the LSP protocol.

### CLI Commands

```bash
treelsp init          # scaffold a new language project
treelsp generate      # generate grammar.js + ast.ts + queries + treelsp.json
treelsp build         # compile grammar.js → grammar.wasm
treelsp watch         # re-run generate + build on grammar.ts changes
```

---

## Implementation Order

Built in this order — each step was testable before the next:

1. ✅ `src/definition/` — types and builder functions (no logic, just data structures)
2. ✅ `src/codegen/grammar.ts` — emit `grammar.js` from definition
3. ✅ `@treelsp/cli generate` — wire codegen, call tree-sitter CLI to compile WASM
4. ✅ `src/runtime/parser/` — Tree-sitter WASM loading, ASTNode wrapper
5. ✅ `src/runtime/scope/` — scope chain, resolver, workspace index
6. ✅ `src/runtime/lsp/` — LSP handlers (diagnostics, hover, definition, references, completion, rename, symbols, semantic tokens)
7. ✅ `src/codegen/server.ts` — manifest + `src/server/index.ts` — stdio transport
8. ✅ `examples/mini-lang/` — validate full pipeline end to end
9. ✅ `@treelsp/vscode` — VS Code extension with dynamic language discovery
10. ✅ `src/codegen/highlights.ts` + `locals.ts` — Tree-sitter query generation
11. ✅ `src/runtime/lsp/semantic-tokens.ts` — LSP semantic tokens for VS Code highlighting
12. ✅ `extras` declaration — whitespace and comments in grammar definition
13. ✅ Publish pipeline — changesets, GitHub Actions CI/CD, npm + VS Code Marketplace

---

## Key External References

- Tree-sitter grammar API: https://tree-sitter.github.io/tree-sitter/creating-parsers
- web-tree-sitter: https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web
- vscode-languageserver: https://github.com/microsoft/vscode-languageserver-node
- LSP specification: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
- Langium (prior art): https://langium.org


## Decisions & Open Questions

This section tells Claude Code what is settled and what still needs discussion.
**Never make a call on an open question without asking the user first.**

---

### Settled — Do Not Revisit

**Project shape**
- Monorepo with 4 packages: `treelsp`, `@treelsp/cli`, `@treelsp/vscode`, `examples`
- pnpm workspaces
- tsdown for building (tsup is unmaintained)
- TypeScript strict mode + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`
- Vitest for testing, ESLint 9 for linting
- Target: Node.js + Browser (WASM via web-tree-sitter)

**Grammar layer**
- Rule builder function style: each rule is `r => r.seq(...)` not a plain object
- Builder method names match Tree-sitter exactly: `seq`, `choice`, `optional`, `repeat`, `repeat1`, `field`, `prec`, `prec.left`, `prec.right`, `prec.dynamic`, `token`, `alias`
- `r.rule('name')` instead of `$.name` — same concept, type-safe, no Proxy needed
- No custom DSL — TypeScript is the grammar format
- `word`, `conflicts`, and `extras` are top-level keys in `defineLanguage`, not inside `grammar`
- `extras` follows the same builder function pattern as `conflicts`: `extras: r => [/\s+/, r.rule('comment')]`
- Left recursion is handled natively by Tree-sitter's GLR parser — no special abstraction needed
- Tree-sitter's precedence model is exposed directly — no `r.binary()` helper abstraction

**Semantic layer**
- Three concepts: declarations, references, scopes
- Scope kinds: `global`, `lexical`, `isolated`
- Declaration scope targets: `local`, `enclosing`, `global`
- `onUnresolved` policy per reference: `error` | `warning` | `ignore`
- Visibility / export supported in v1 via `visibility` field on declares
- Cross-file resolution supported in v1 via `ctx.resolveModule()`
- A single rule can both declare and reference (Python-style implicit declaration)
- Declaration ordering controlled by `order`: `after-references` | `before-references`
- Declaration strategy controlled by `strategy`: `if-not-declared` | `always`
- Escape hatch: `resolve()` function on both declares and references

**Validation layer**
- Validators are plain functions — no classes, no registry, no DI
- Each rule accepts a single function or an array of functions
- `mergeValidation(...maps)` merges validator maps from multiple files
- `$document` and `$workspace` special keys for document/workspace-level validators
- Langium-style `property` + `index` targeting on diagnostics
- Execution order: parse → scope resolution → built-in checks → node validators → $document → $workspace

**LSP layer**
- Hover returns a markdown string — runtime wraps it in LSP Hover response
- Hover on a reference node automatically resolves to its declaration — no user code needed
- Scope-based completions are automatic from `completionKind` annotations
- Keyword completions are automatic from grammar + `$keywords`
- Custom `complete()` functions are additive by default — set `replace: true` to suppress defaults
- `signature` on a declaration node — triggering logic is automatic if `call` is annotated in semantic
- Go-to-definition, find references, rename are fully automatic from semantic layer
- `$unresolved` special key for customising unresolved reference hover message

**Defaults system**
- Three levels: zero config → configure → override
- `defaults` object exported from `treelsp` — all entries are plain callable functions
- Calling `defaults.lsp.hover(node, ctx)` from inside your own hover gives you the generic output to extend

- Incremental parsing: Tree-sitter handles CST incrementally; AST + scope is full recompute in v1,
  designed for incremental upgrade in v2 without API changes

**Publishing**
- Changesets for version management and changelogs
- `treelsp` and `@treelsp/cli` linked versioning (bump together)
- GitHub Actions: CI on push/PR (lint, build, test), release via changesets/action
- npm publish for `treelsp` and `@treelsp/cli`, VS Code Marketplace for `@treelsp/vscode`
- Secrets required: `NPM_TOKEN`, `VSCE_PAT`

---

### Open Questions — Ask Before Implementing

**Semantic layer**
- Multi-field / qualified names (e.g. `Foo.Bar`) — punted to v2, but what does the v1 API need to avoid closing that door?
- Declaration merging (TypeScript interface merging) — punted to v2, same question
- Should `ctx.typeOf()` exist in v1 at all, or is it purely a v2 concern?
  Currently referenced in LSP and validation contexts but not defined

**Runtime**
- Should the runtime support multiple language grammars in one LSP server (e.g. embedded languages)?
  Not designed — Tree-sitter supports this natively but it's complex

**User projects**
- Should `grammar.wasm` be committed to user repos?
  Leaning yes (it's a build artifact users need, like a lock file) — but not decided