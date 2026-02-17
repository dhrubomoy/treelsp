/**
 * VS Code extension for treelsp
 * Discovers and launches treelsp-generated LSP servers
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
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

  // Watch for new manifests appearing
  const watcher = vscode.workspace.createFileSystemWatcher('**/generated/treelsp.json');
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

  const uris = await vscode.workspace.findFiles('**/generated/treelsp.json', '**/node_modules/**');
  for (const uri of uris) {
    const data = await readManifest(uri.fsPath);
    if (data) {
      results.push({ manifest: data, manifestPath: uri.fsPath });
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
      return null;
    }

    return data;
  } catch {
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

  clients.set(manifestPath, client);
  context.subscriptions.push(client);

  await client.start();
}
