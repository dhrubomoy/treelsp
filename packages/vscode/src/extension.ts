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
}

/** Active language client per manifest path */
const clients = new Map<string, LanguageClient>();

export async function activate(context: vscode.ExtensionContext) {
  // Discover treelsp projects in all workspace folders
  const manifests = await discoverManifests();

  for (const { manifest, manifestPath } of manifests) {
    await startLanguageClient(manifest, manifestPath, context);
  }

  // Watch for new manifests appearing (both tree-sitter and lezer output dirs)
  const watcher = vscode.workspace.createFileSystemWatcher('**/generated/treelsp.json');
  const lezerWatcher = vscode.workspace.createFileSystemWatcher('**/generated-lezer/treelsp.json');
  watcher.onDidCreate(async (uri) => {
    const data = await readManifest(uri.fsPath);
    if (data) {
      await startLanguageClient(data, uri.fsPath, context);
    }
  });
  watcher.onDidChange(async (uri) => {
    // Restart client on manifest change
    const key = uri.fsPath;
    const existing = clients.get(key);
    if (existing) {
      await existing.stop();
      clients.delete(key);
    }
    const data = await readManifest(uri.fsPath);
    if (data) {
      await startLanguageClient(data, uri.fsPath, context);
    }
  });
  watcher.onDidDelete(async (uri) => {
    const key = uri.fsPath;
    const existing = clients.get(key);
    if (existing) {
      await existing.stop();
      clients.delete(key);
    }
  });
  context.subscriptions.push(watcher);

  // Lezer watcher — same handlers
  lezerWatcher.onDidCreate(async (uri) => {
    const data = await readManifest(uri.fsPath);
    if (data) {
      await startLanguageClient(data, uri.fsPath, context);
    }
  });
  lezerWatcher.onDidChange(async (uri) => {
    const key = uri.fsPath;
    const existing = clients.get(key);
    if (existing) {
      await existing.stop();
      clients.delete(key);
    }
    const data = await readManifest(uri.fsPath);
    if (data) {
      await startLanguageClient(data, uri.fsPath, context);
    }
  });
  lezerWatcher.onDidDelete(async (uri) => {
    const key = uri.fsPath;
    const existing = clients.get(key);
    if (existing) {
      await existing.stop();
      clients.delete(key);
    }
  });
  context.subscriptions.push(lezerWatcher);
}

export async function deactivate(): Promise<void> {
  const stops = [...clients.values()].map(c => c.stop());
  await Promise.all(stops);
  clients.clear();
}

/**
 * Scan workspace for generated/treelsp.json manifests
 */
async function discoverManifests(): Promise<{ manifest: TreelspManifest; manifestPath: string }[]> {
  const results: { manifest: TreelspManifest; manifestPath: string }[] = [];

  // Discover manifests in both generated/ and generated-lezer/ directories
  const patterns = ['**/generated/treelsp.json', '**/generated-lezer/treelsp.json'];
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

  // Pattern-only selectors — no registered language ID needed
  const documentSelector = manifest.fileExtensions.map(ext => ({
    scheme: 'file' as const,
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

  clients.set(manifestPath, client);
  context.subscriptions.push(client);

  try {
    await client.start();
  } catch (e) {
    clients.delete(manifestPath);
    void vscode.window.showErrorMessage(
      `treelsp: Failed to start ${manifest.name} language server: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
