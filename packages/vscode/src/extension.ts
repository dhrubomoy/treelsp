/**
 * VS Code extension for treelsp
 * Launches generated LSP servers
 */

import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext) {
  // TODO: Discover and launch treelsp language servers
  // This is a generic extension that can work with any treelsp-generated server

  console.log('treelsp extension activated');
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
