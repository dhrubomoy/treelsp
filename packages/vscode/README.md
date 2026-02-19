# @treelsp/vscode

VS Code extension for [treelsp](https://github.com/dhrubomoy/treelsp)-based language servers.

## What It Does

This extension automatically discovers treelsp-generated language servers in your workspace and launches them. Any language built with treelsp gets full editor support — diagnostics, completion, hover, go-to-definition, rename, syntax highlighting — without any per-language configuration.

## How It Works

1. The extension activates when it finds a `generated/treelsp.json` manifest in your workspace
2. It reads the manifest to find the server bundle and file extensions
3. It launches a `LanguageClient` that connects to the bundled server via stdio
4. A `FileSystemWatcher` monitors manifests — new languages are picked up automatically, and changes trigger a server restart

No hardcoded language IDs. No reload prompts. Add a new treelsp language to your workspace and it just works.

## Prerequisites

Your treelsp language project must be built before the extension can start the server:

```bash
treelsp generate    # generates treelsp.json manifest + grammar
treelsp build       # compiles WASM parser + bundles server
```

The extension expects this structure in your project:

```
your-language/
  generated/
    treelsp.json         # manifest (points to server bundle + file extensions)
    server.bundle.cjs    # language server
    grammar.wasm         # compiled parser
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `treelsp.trace.server` | `off` | Trace communication between VS Code and the language server (`off`, `messages`, `verbose`) |

## Development

```bash
pnpm build       # build the extension
pnpm package     # package as .vsix
```

## License

MIT
