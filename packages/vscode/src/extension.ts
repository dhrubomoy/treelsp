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
} from 'vscode-languageclient/node';

/** treelsp.json manifest shape */
interface TreelspManifest {
  name: string;
  languageId: string;
  fileExtensions: string[];
  server: string;
}

/** Language contribution in package.json */
interface LanguageContribution {
  id: string;
  extensions: string[];
  aliases: string[];
}

/** Active language client per manifest path */
const clients = new Map<string, LanguageClient>();

export async function activate(context: vscode.ExtensionContext) {
  // Discover treelsp projects in all workspace folders
  const manifests = await discoverManifests();

  // Register languages in package.json if needed (requires reload)
  const needsReload = await syncLanguageContributions(manifests.map(m => m.manifest), context);
  if (needsReload) {
    const action = await vscode.window.showInformationMessage(
      'treelsp discovered new languages. Reload window to activate language support.',
      'Reload Window'
    );
    if (action === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
    return;
  }

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
 * Sync discovered languages into the extension's package.json contributes.languages.
 * VS Code only recognizes languages declared in package.json — there's no dynamic API.
 * Returns true if package.json was updated (reload needed).
 */
async function syncLanguageContributions(
  manifests: TreelspManifest[],
  context: vscode.ExtensionContext
): Promise<boolean> {
  const pkgPath = path.join(context.extensionPath, 'package.json');

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return false;
  }

  const contributes = (pkg['contributes'] ?? {}) as Record<string, unknown>;
  const existing = (contributes['languages'] ?? []) as LanguageContribution[];
  const existingIds = new Set(existing.map(l => l.id));

  const newLanguages: LanguageContribution[] = [];
  for (const manifest of manifests) {
    if (!existingIds.has(manifest.languageId)) {
      newLanguages.push({
        id: manifest.languageId,
        extensions: manifest.fileExtensions,
        aliases: [manifest.name],
      });
    }
  }

  if (newLanguages.length === 0) {
    return false;
  }

  // Update package.json with new language contributions
  contributes['languages'] = [...existing, ...newLanguages];
  pkg['contributes'] = contributes;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  return true;
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
    },
  };

  // Use both language ID and pattern selectors for maximum compatibility
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

  clients.set(manifestPath, client);
  context.subscriptions.push(client);

  await client.start();
}
