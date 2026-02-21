/**
 * Init command - scaffold a new two-package language project
 *
 * Creates a pnpm monorepo with:
 * - packages/language/ — grammar definition + generated files
 * - packages/extension/ — VS Code extension that launches the language server
 */

import prompts from 'prompts';
import ora from 'ora';
import pc from 'picocolors';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Read the CLI package version at runtime so scaffolded projects
 * always pin to the version of the CLI that created them.
 */
async function getCliVersion(): Promise<string> {
  try {
    const distDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(distDir, '..', 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.1';
  }
}

export async function init() {
  console.log(pc.bold('treelsp init\n'));

  const answers = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Language name:',
      initial: 'my-lang',
      validate: (value: string) => value.length > 0 || 'Name is required',
    },
    {
      type: 'text',
      name: 'extension',
      message: 'File extension:',
      initial: '.mylang',
      validate: (value: string) => {
        if (!value.startsWith('.')) return 'Extension must start with a dot';
        if (value.length < 2) return 'Extension is too short';
        return true;
      },
    },
  ]) as { name?: string; extension?: string };

  // Handle user cancellation (Ctrl+C)
  if (!answers.name || !answers.extension) {
    console.log(pc.dim('\nCancelled'));
    process.exit(0);
  }

  const { name, extension } = answers as { name: string; extension: string };

  const capitalizedName = name
    .split('-')
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

  const languageId = name.replace(/-/g, '').toLowerCase();

  const spinner = ora('Creating project structure...').start();

  try {
    const projectDir = resolve(process.cwd(), name);

    // Check if directory already exists
    if (existsSync(projectDir)) {
      spinner.fail(`Directory "${name}" already exists`);
      console.log(pc.dim('\nChoose a different name or remove the existing directory'));
      process.exit(1);
    }

    // Create all directories
    await mkdir(resolve(projectDir, '.vscode'), { recursive: true });
    await mkdir(resolve(projectDir, 'packages', 'language'), { recursive: true });
    await mkdir(resolve(projectDir, 'packages', 'extension', 'src'), { recursive: true });

    const version = await getCliVersion();
    const versionRange = `^${version}`;

    // Write all files
    const files: Array<[string, string]> = [
      // Root files
      ['pnpm-workspace.yaml', pnpmWorkspaceYaml()],
      ['package.json', rootPackageJson(name, versionRange)],
      ['treelsp-config.json', treelspConfigJson()],
      ['.gitignore', rootGitignore()],
      ['README.md', rootReadme(capitalizedName)],
      ['.vscode/launch.json', vscodeLaunchJson()],
      ['.vscode/tasks.json', vscodeTasksJson()],
      // Language package
      ['packages/language/package.json', languagePackageJson(name, versionRange)],
      ['packages/language/tsconfig.json', languageTsconfig()],
      ['packages/language/grammar.ts', grammarTemplate(capitalizedName, extension)],
      // Extension package
      ['packages/extension/package.json', extensionPackageJson(name, capitalizedName, languageId, extension)],
      ['packages/extension/tsconfig.json', extensionTsconfig()],
      ['packages/extension/tsdown.config.ts', extensionTsdownConfig()],
      ['packages/extension/.vscodeignore', extensionVscodeignore()],
      ['packages/extension/src/extension.ts', extensionTs(capitalizedName, languageId)],
    ];

    for (const [filePath, content] of files) {
      await writeFile(resolve(projectDir, filePath), content, 'utf-8');
    }

    spinner.succeed('Project created!');

    console.log(pc.dim('\nNext steps:'));
    console.log(pc.dim(`  cd ${name}`));
    console.log(pc.dim('  pnpm install'));
    console.log(pc.dim('  Edit packages/language/grammar.ts to define your language'));
    console.log(pc.dim('  pnpm build'));
    console.log(pc.dim('  Press F5 in VS Code to launch the extension'));

  } catch (error) {
    spinner.fail('Failed to create project');

    if (error instanceof Error) {
      console.error(pc.red(`\n${error.message}`));
    }

    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Template functions
// ---------------------------------------------------------------------------

function pnpmWorkspaceYaml(): string {
  return `packages:\n  - 'packages/*'\n`;
}

function rootPackageJson(name: string, versionRange: string): string {
  const pkg = {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      generate: 'treelsp generate',
      build: 'treelsp generate && treelsp build',
      'build:extension': `pnpm --filter ${name}-extension build`,
      watch: 'treelsp watch',
    },
    devDependencies: {
      '@treelsp/cli': versionRange,
      typescript: '^5.7.3',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

function treelspConfigJson(): string {
  const config = {
    languages: [
      { grammar: 'packages/language/grammar.ts' },
    ],
  };
  return JSON.stringify(config, null, 2) + '\n';
}

function rootGitignore(): string {
  return `node_modules
dist
generated/
generated-lezer/
*.wasm
*.log
*.tsbuildinfo
.DS_Store
`;
}

function rootReadme(capitalizedName: string): string {
  return `# ${capitalizedName}

A language powered by [treelsp](https://github.com/dhrubomoy/treelsp).

## Getting Started

Install dependencies:

\`\`\`bash
pnpm install
\`\`\`

Generate grammar and build parser:

\`\`\`bash
pnpm build
\`\`\`

Launch the VS Code extension for development:

\`\`\`
Press F5 in VS Code, or:
pnpm build:extension
\`\`\`

Development workflow:

\`\`\`bash
pnpm watch     # Auto-rebuild grammar on changes
\`\`\`

## Project Structure

- \`packages/language/grammar.ts\` - Language definition (grammar, semantics, validation, LSP)
- \`packages/language/generated/\` - Generated files (parser, AST types, server bundle)
- \`packages/extension/\` - VS Code extension that launches the language server

## License

MIT
`;
}

function vscodeLaunchJson(): string {
  const config = {
    version: '0.2.0',
    configurations: [
      {
        name: 'Launch Extension',
        type: 'extensionHost',
        request: 'launch',
        args: [
          '--extensionDevelopmentPath=${workspaceFolder}/packages/extension',
          '${workspaceFolder}/packages/language',
        ],
        outFiles: [
          '${workspaceFolder}/packages/extension/dist/**/*.js',
        ],
        preLaunchTask: 'build',
      },
    ],
  };
  return JSON.stringify(config, null, 2) + '\n';
}

function vscodeTasksJson(): string {
  const config = {
    version: '2.0.0',
    tasks: [
      {
        label: 'build',
        type: 'shell',
        command: 'pnpm build && pnpm build:extension',
        group: 'build',
        problemMatcher: [] as string[],
      },
    ],
  };
  return JSON.stringify(config, null, 2) + '\n';
}

function languagePackageJson(name: string, versionRange: string): string {
  const pkg = {
    name: `${name}-language`,
    version: '0.1.0',
    private: true,
    type: 'module',
    dependencies: {
      treelsp: versionRange,
    },
    devDependencies: {
      typescript: '^5.7.3',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

function languageTsconfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      outDir: './dist',
    },
    include: ['grammar.ts'],
  };
  return JSON.stringify(config, null, 2) + '\n';
}

function grammarTemplate(capitalizedName: string, extension: string): string {
  return `/**
 * ${capitalizedName} - Language definition for treelsp
 */

import { defineLanguage } from 'treelsp';

export default defineLanguage({
  name: '${capitalizedName}',
  fileExtensions: ['${extension}'],
  entry: 'program',
  word: 'identifier',

  grammar: {
    // Program is a sequence of statements
    program: r => r.repeat(r.rule('statement')),

    // Define your language's statement types
    statement: r => r.choice(
      r.rule('variable_decl'),
      r.rule('expr_statement'),
    ),

    // Variable declaration: let name = value;
    variable_decl: r => r.seq(
      'let',
      r.field('name', r.rule('identifier')),
      '=',
      r.field('value', r.rule('expression')),
      ';',
    ),

    // Expression statement: expr;
    expr_statement: r => r.seq(
      r.field('expr', r.rule('expression')),
      ';',
    ),

    // Define your language's expressions
    expression: r => r.choice(
      r.rule('identifier'),
      r.rule('number'),
    ),

    // Tokens
    identifier: r => r.token(/[a-zA-Z_][a-zA-Z0-9_]*/),
    number: r => r.token(/[0-9]+/),
  },

  semantic: {
    // Program creates global scope
    program: { scope: 'global' },

    // Variable declarations introduce names
    variable_decl: {
      declares: {
        field: 'name',
        scope: 'enclosing',
      },
    },

    // Identifiers in expressions are references
    identifier: {
      references: {
        field: 'name',
        to: 'variable_decl',
        onUnresolved: 'error',
      },
    },
  },

  validation: {
    // Add your custom validation rules here
  },

  lsp: {
    // Keyword completions
    $keywords: {
      'let': { detail: 'Declare a variable' },
    },

    // Hover for variables
    variable_decl: {
      completionKind: 'Variable',
      symbol: {
        kind: 'Variable',
        label: n => n.field('name').text,
      },
      hover(node, ctx) {
        const name = node.field('name').text;
        return \`**let** \\\`\${name}\\\`\`;
      },
    },
  },
});
`;
}

function extensionPackageJson(
  name: string,
  capitalizedName: string,
  languageId: string,
  extension: string,
): string {
  const pkg = {
    name: `${name}-extension`,
    displayName: capitalizedName,
    description: `VS Code extension for ${capitalizedName}`,
    version: '0.1.0',
    private: true,
    publisher: name,
    engines: {
      vscode: '^1.80.0',
    },
    categories: ['Programming Languages'],
    activationEvents: [
      'workspaceContains:**/generated/treelsp.json',
      'workspaceContains:**/generated-lezer/treelsp.json',
    ],
    main: './dist/extension.js',
    contributes: {
      languages: [
        {
          id: languageId,
          extensions: [extension],
          aliases: [capitalizedName],
        },
      ],
    },
    scripts: {
      build: 'tsdown',
      dev: 'tsdown --watch',
      package: 'vsce package',
    },
    dependencies: {
      'vscode-languageclient': '^9.0.1',
    },
    devDependencies: {
      '@types/vscode': '^1.80.0',
      tsdown: '^0.2.17',
      typescript: '^5.7.3',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

function extensionTsconfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      outDir: './dist',
      rootDir: './src',
      lib: ['ES2022'],
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  };
  return JSON.stringify(config, null, 2) + '\n';
}

function extensionTsdownConfig(): string {
  return `import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  dts: false,
  clean: true,
  platform: 'node',
  external: ['vscode'],
});
`;
}

function extensionVscodeignore(): string {
  return `src/
node_modules/
.gitignore
tsconfig.json
tsdown.config.ts
*.tsbuildinfo
`;
}

function extensionTs(capitalizedName: string, languageId: string): string {
  return `/**
 * ${capitalizedName} - VS Code Extension
 * Discovers and launches the treelsp-generated language server.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  State,
} from 'vscode-languageclient/node';

interface TreelspManifest {
  name: string;
  languageId: string;
  fileExtensions: string[];
  server: string;
  textmateGrammar?: string;
}

const clients = new Map<string, LanguageClient>();

export async function activate(context: vscode.ExtensionContext) {
  const manifests = await discoverManifests();

  for (const { manifest, manifestPath } of manifests) {
    await startLanguageClient(manifest, manifestPath, context);
  }

  // Watch for new or updated manifests
  for (const pattern of ['**/generated/treelsp.json', '**/generated-lezer/treelsp.json']) {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(async (uri) => {
      const data = await readManifest(uri.fsPath);
      if (data) await startLanguageClient(data, uri.fsPath, context);
    });
    watcher.onDidChange(async (uri) => {
      await stopClient(uri.fsPath);
      const data = await readManifest(uri.fsPath);
      if (data) await startLanguageClient(data, uri.fsPath, context);
    });
    watcher.onDidDelete(async (uri) => {
      await stopClient(uri.fsPath);
    });
    context.subscriptions.push(watcher);
  }
}

export async function deactivate(): Promise<void> {
  const stops = [...clients.values()].map(c => c.stop());
  await Promise.all(stops);
  clients.clear();
}

async function discoverManifests(): Promise<Array<{ manifest: TreelspManifest; manifestPath: string }>> {
  const results: Array<{ manifest: TreelspManifest; manifestPath: string }> = [];
  for (const pattern of ['**/generated/treelsp.json', '**/generated-lezer/treelsp.json']) {
    const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
    for (const uri of uris) {
      const data = await readManifest(uri.fsPath);
      if (data) results.push({ manifest: data, manifestPath: uri.fsPath });
    }
  }
  return results;
}

async function readManifest(fsPath: string): Promise<TreelspManifest | null> {
  try {
    const doc = await vscode.workspace.openTextDocument(fsPath);
    const data = JSON.parse(doc.getText()) as TreelspManifest;
    if (!data.name || !data.languageId || !data.fileExtensions || !data.server) return null;
    return data;
  } catch {
    return null;
  }
}

async function startLanguageClient(
  manifest: TreelspManifest,
  manifestPath: string,
  context: vscode.ExtensionContext,
): Promise<void> {
  if (clients.has(manifestPath)) return;

  const generatedDir = path.dirname(manifestPath);
  const serverModule = path.resolve(generatedDir, manifest.server);

  if (!fs.existsSync(serverModule)) {
    void vscode.window.showErrorMessage(
      '${capitalizedName}: Server bundle not found. Run "pnpm build" first.',
    );
    return;
  }

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: manifest.fileExtensions.map(ext => ({
      scheme: 'file' as const,
      language: manifest.languageId,
      pattern: \`**/*\${ext}\`,
    })),
    outputChannelName: '${capitalizedName} Language Server',
  };

  const client = new LanguageClient(
    '${languageId}',
    '${capitalizedName} Language Server',
    serverOptions,
    clientOptions,
  );

  client.onDidChangeState((event) => {
    if (event.oldState === State.Running && event.newState === State.Stopped) {
      void vscode.window.showWarningMessage(
        '${capitalizedName}: Language server stopped unexpectedly.',
      );
    }
  });

  clients.set(manifestPath, client);
  context.subscriptions.push(client);

  try {
    await client.start();
  } catch (e) {
    clients.delete(manifestPath);
    void vscode.window.showErrorMessage(
      \`${capitalizedName}: Failed to start language server: \${e instanceof Error ? e.message : String(e)}\`,
    );
  }
}

async function stopClient(key: string): Promise<void> {
  const client = clients.get(key);
  if (!client) return;
  await client.stop();
  clients.delete(key);
}
`;
}
