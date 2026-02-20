/**
 * VS Code extension for treelsp
 * Discovers and launches treelsp-generated LSP servers
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

/** treelsp.json manifest shape */
interface TreelspManifest {
  name: string;
  languageId: string;
  fileExtensions: string[];
  server: string;
  queries?: {
    highlights: string;
    locals: string;
  };
  textmateGrammar?: string;
}

/** VS Code package.json contributes shape */
interface PackageJsonContributes {
  languages?: Array<{
    id: string;
    extensions: string[];
    aliases: string[];
  }>;
  grammars?: Array<{
    language: string;
    scopeName: string;
    path: string;
  }>;
  configuration?: unknown;
}

interface PackageJson {
  contributes?: PackageJsonContributes;
  [key: string]: unknown;
}

/** Active language client + manifest per manifest path */
const clients = new Map<string, { client: LanguageClient; manifest: TreelspManifest }>();

/** Track which file extension patterns already have an active client */
const activeExtensions = new Set<string>();

/** Stop and remove a client by manifest path */
async function stopClient(key: string): Promise<void> {
  const entry = clients.get(key);
  if (!entry) return;
  await entry.client.stop();
  for (const ext of entry.manifest.fileExtensions) {
    activeExtensions.delete(ext);
  }
  clients.delete(key);
}

export async function activate(context: vscode.ExtensionContext) {
  // Discover treelsp projects in all workspace folders
  const manifests = await discoverManifests();

  // Register TextMate grammars for discovered languages
  const needsReload = registerTextMateGrammars(manifests, context);

  for (const { manifest, manifestPath } of manifests) {
    await startLanguageClient(manifest, manifestPath, context);
  }

  if (needsReload) {
    const action = await vscode.window.showInformationMessage(
      'treelsp: New language syntax detected. Reload window to enable syntax highlighting.',
      'Reload',
    );
    if (action === 'Reload') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }

  // Watch for new manifests appearing (both tree-sitter and lezer output dirs)
  const watcher = vscode.workspace.createFileSystemWatcher('**/generated/treelsp.json');
  const lezerWatcher = vscode.workspace.createFileSystemWatcher('**/generated-lezer/treelsp.json');

  for (const w of [watcher, lezerWatcher]) {
    w.onDidCreate(async (uri) => {
      const data = await readManifest(uri.fsPath);
      if (data) {
        const registered = registerTextMateGrammars(
          [{ manifest: data, manifestPath: uri.fsPath }],
          context,
        );
        await startLanguageClient(data, uri.fsPath, context);
        if (registered) {
          const action = await vscode.window.showInformationMessage(
            `treelsp: ${data.name} syntax detected. Reload window to enable syntax highlighting.`,
            'Reload',
          );
          if (action === 'Reload') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        }
      }
    });
    w.onDidChange(async (uri) => {
      await stopClient(uri.fsPath);
      const data = await readManifest(uri.fsPath);
      if (data) {
        const registered = registerTextMateGrammars(
          [{ manifest: data, manifestPath: uri.fsPath }],
          context,
        );
        await startLanguageClient(data, uri.fsPath, context);
        if (registered) {
          const action = await vscode.window.showInformationMessage(
            `treelsp: ${data.name} syntax updated. Reload window to refresh syntax highlighting.`,
            'Reload',
          );
          if (action === 'Reload') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        }
      }
    });
    w.onDidDelete(async (uri) => {
      await stopClient(uri.fsPath);
    });
    context.subscriptions.push(w);
  }
}

export async function deactivate(): Promise<void> {
  const stops = [...clients.values()].map(e => e.client.stop());
  await Promise.all(stops);
  clients.clear();
  activeExtensions.clear();
}

/**
 * Register TextMate grammars for discovered languages.
 *
 * VS Code has no public API to register TextMate grammars at runtime.
 * They must be declared in `contributes.grammars` in the extension's package.json.
 * This function patches the extension's package.json and copies grammar files
 * to the extension directory.
 *
 * Returns true if new grammars were registered (requiring a reload).
 */
function registerTextMateGrammars(
  manifests: Array<{ manifest: TreelspManifest; manifestPath: string }>,
  context: vscode.ExtensionContext,
): boolean {
  const extensionDir = context.extension.extensionPath;
  const packageJsonPath = path.join(extensionDir, 'package.json');

  let packageJson: PackageJson;
  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    packageJson = JSON.parse(content) as PackageJson;
  } catch {
    return false;
  }

  if (!packageJson.contributes) {
    packageJson.contributes = {};
  }
  const contributes = packageJson.contributes;
  if (!contributes.languages) {
    contributes.languages = [];
  }
  if (!contributes.grammars) {
    contributes.grammars = [];
  }

  const grammarsDir = path.join(extensionDir, 'grammars');
  let changed = false;

  for (const { manifest, manifestPath } of manifests) {
    if (!manifest.textmateGrammar) continue;

    const languageId = manifest.languageId;

    // Check if already registered
    const alreadyRegistered = contributes.languages.some(l => l.id === languageId);
    if (alreadyRegistered) continue;

    // Read the TextMate grammar from the generated directory
    const generatedDir = path.dirname(manifestPath);
    const grammarSourcePath = path.resolve(generatedDir, manifest.textmateGrammar);
    if (!fs.existsSync(grammarSourcePath)) continue;

    // Copy grammar to extension's grammars/ directory
    if (!fs.existsSync(grammarsDir)) {
      fs.mkdirSync(grammarsDir, { recursive: true });
    }
    const grammarDestPath = path.join(grammarsDir, `${languageId}.tmLanguage.json`);
    fs.copyFileSync(grammarSourcePath, grammarDestPath);

    // Add language contribution
    contributes.languages.push({
      id: languageId,
      extensions: manifest.fileExtensions,
      aliases: [manifest.name],
    });

    // Add grammar contribution
    contributes.grammars.push({
      language: languageId,
      scopeName: `source.${languageId}`,
      path: `./grammars/${languageId}.tmLanguage.json`,
    });

    changed = true;
  }

  if (changed) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
  }

  return changed;
}

/**
 * Scan workspace for generated/treelsp.json manifests
 */
async function discoverManifests(): Promise<{ manifest: TreelspManifest; manifestPath: string }[]> {
  const results: { manifest: TreelspManifest; manifestPath: string }[] = [];

  // TREELSP_BACKEND env var can restrict which backend is discovered (for debugging).
  // Values: "tree-sitter" (only generated/), "lezer" (only generated-lezer/), unset = both.
  const backendFilter = process.env['TREELSP_BACKEND'];
  const allPatterns: string[] = [];
  if (!backendFilter || backendFilter === 'tree-sitter') {
    allPatterns.push('**/generated/treelsp.json');
  }
  if (!backendFilter || backendFilter === 'lezer') {
    allPatterns.push('**/generated-lezer/treelsp.json');
  }
  const patterns = allPatterns;
  for (const pattern of patterns) {
    const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
    for (const uri of uris) {
      const data = await readManifest(uri.fsPath);
      if (data) {
        results.push({ manifest: data, manifestPath: uri.fsPath });
      }
    }
  }

  return results;
}

/**
 * Read and validate a treelsp.json manifest
 */
async function readManifest(fsPath: string): Promise<TreelspManifest | null> {
  try {
    const doc = await vscode.workspace.openTextDocument(fsPath);
    const data = JSON.parse(doc.getText()) as TreelspManifest;

    if (!data.name || !data.languageId || !data.fileExtensions || !data.server) {
      void vscode.window.showWarningMessage(
        `treelsp: Invalid manifest at ${fsPath} — missing required fields. Run "treelsp generate".`
      );
      return null;
    }

    return data;
  } catch (e) {
    void vscode.window.showWarningMessage(
      `treelsp: Failed to read manifest at ${fsPath}: ${e instanceof Error ? e.message : String(e)}`
    );
    return null;
  }
}

/**
 * Start a LanguageClient for a discovered treelsp language
 */
async function startLanguageClient(
  manifest: TreelspManifest,
  manifestPath: string,
  context: vscode.ExtensionContext
): Promise<void> {
  // Don't start duplicate clients
  if (clients.has(manifestPath)) {
    return;
  }

  // Don't start a client if another client already handles the same extensions
  const hasConflict = manifest.fileExtensions.some(ext => activeExtensions.has(ext));
  if (hasConflict) {
    return;
  }

  const generatedDir = path.dirname(manifestPath);
  const serverModule = path.resolve(generatedDir, manifest.server);

  // Check server bundle exists before attempting to start
  if (!fs.existsSync(serverModule)) {
    void vscode.window.showErrorMessage(
      `treelsp: Server bundle not found for ${manifest.name}. Run "treelsp build" to generate it.`
    );
    return;
  }

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.stdio,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      options: {
        execArgv: ['--nolazy', '--inspect=6009'],
      },
    },
  };

  // Use language ID if registered, otherwise fall back to pattern-only selectors
  const documentSelector = manifest.fileExtensions.map(ext => ({
    scheme: 'file' as const,
    language: manifest.languageId,
    pattern: `**/*${ext}`,
  }));

  const clientOptions: LanguageClientOptions = {
    documentSelector,
    diagnosticCollectionName: manifest.languageId,
    outputChannelName: `treelsp: ${manifest.name}`,
  };

  const client = new LanguageClient(
    `treelsp-${manifest.languageId}`,
    `treelsp: ${manifest.name}`,
    serverOptions,
    clientOptions
  );

  // Detect unexpected server crashes
  client.onDidChangeState((event) => {
    if (event.oldState === State.Running && event.newState === State.Stopped) {
      void vscode.window.showWarningMessage(
        `treelsp: ${manifest.name} language server stopped unexpectedly. Check the "treelsp: ${manifest.name}" output channel for details.`
      );
    }
  });

  clients.set(manifestPath, { client, manifest });
  for (const ext of manifest.fileExtensions) {
    activeExtensions.add(ext);
  }
  context.subscriptions.push(client);

  try {
    await client.start();
  } catch (e) {
    clients.delete(manifestPath);
    for (const ext of manifest.fileExtensions) {
      activeExtensions.delete(ext);
    }
    void vscode.window.showErrorMessage(
      `treelsp: Failed to start ${manifest.name} language server: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
