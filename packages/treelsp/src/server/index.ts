/**
 * LSP server transport for Node.js stdio
 *
 * Provides startStdioServer() that wires a LanguageService to a
 * vscode-languageserver connection over stdio. Separate from treelsp/runtime
 * to keep the runtime browser-compatible.
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  SymbolKind as LspSymbolKind,
  CompletionItemKind as LspCompletionItemKind,
  type DocumentSymbol as LspDocumentSymbol,
  type CompletionItem as LspCompletionItem,
} from 'vscode-languageserver/lib/node/main.js';
import { Position, TextDocument } from 'vscode-languageserver-textdocument';
import { createServer, createDocumentState, SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS } from '../runtime/index.js';
import { COMPLETION_KIND_MAP } from '../runtime/lsp/completion.js';
import type { LanguageDefinition } from '../definition/index.js';
import type { DocumentState } from '../runtime/parser/tree.js';
import type { CompletionItem as InternalCompletionItem } from '../definition/lsp.js';

/**
 * Convert internal CompletionItem to LSP protocol CompletionItem
 */
function toLspCompletionItem(item: InternalCompletionItem): LspCompletionItem {
  const lspItem: LspCompletionItem = {
    label: item.label,
  };
  if (item.kind) {
    lspItem.kind = COMPLETION_KIND_MAP[item.kind] as LspCompletionItemKind;
  }
  if (item.detail) {
    lspItem.detail = item.detail;
  }
  if (item.documentation) {
    lspItem.documentation = item.documentation;
  }
  if (item.insertText) {
    lspItem.insertText = item.insertText;
  }
  return lspItem;
}

function getRangeStr(start: Position, end: Position) {
  return `${start.line}:${start.character}-${end.line}:${end.character}`;
}

/**
 * Options for starting a stdio LSP server
 */
export interface StdioServerOptions {
  /** Language definition from defineLanguage() */
  definition: LanguageDefinition;
  /** Absolute path to grammar.wasm file */
  wasmPath: string;
}

/**
 * Start an LSP server over stdio transport
 *
 * Creates a vscode-languageserver connection, wires all LSP protocol handlers
 * to a LanguageService, and starts listening. This is the main entry point
 * for generated LSP servers.
 */
export function startStdioServer(options: StdioServerOptions): void {
  const { definition, wasmPath } = options;
  const langId = definition.name.toLowerCase();

  const connection = createConnection(ProposedFeatures.all);
  const textDocuments = new TextDocuments(TextDocument);
  const service = createServer(definition);
  const documentStates = new Map<string, DocumentState>();
  // Promise cache prevents duplicate WASM init calls when concurrent requests
  // arrive before the first createDocumentState completes.
  const pendingInits = new Map<string, Promise<DocumentState>>();
  // Tracks WASM load failure so we don't retry on every keystroke
  let wasmError: string | null = null;

  async function getDocumentState(textDoc: TextDocument): Promise<DocumentState | null> {
    const existing = documentStates.get(textDoc.uri);
    if (existing) return existing;

    // If WASM already failed, don't retry on every request.
    // User must fix the issue and restart the server.
    if (wasmError) return null;

    // Deduplicate: reuse in-flight init for the same URI
    let promise = pendingInits.get(textDoc.uri);
    if (!promise) {
      promise = createDocumentState(wasmPath, {
        uri: textDoc.uri,
        version: textDoc.version,
        languageId: langId,
      }, textDoc.getText());
      pendingInits.set(textDoc.uri, promise);
    }

    try {
      const state = await promise;
      documentStates.set(textDoc.uri, state);
      pendingInits.delete(textDoc.uri);
      return state;
    } catch (error) {
      pendingInits.delete(textDoc.uri);
      const msg = error instanceof Error ? error.message : String(error);
      wasmError = msg;
      connection.console.error(`[treelsp] Failed to load grammar: ${msg}`);
      void connection.window.showErrorMessage(
        `treelsp: Failed to load grammar. Run "treelsp build" to generate grammar.wasm.`
      );
      return null;
    }
  }

  const severityMap = {
    error: DiagnosticSeverity.Error,
    warning: DiagnosticSeverity.Warning,
    info: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
  } as const;

  async function validateDocument(textDoc: TextDocument): Promise<void> {
    const state = await getDocumentState(textDoc);
    if (!state) {
      // Show a diagnostic so the user sees the problem in the editor
      if (wasmError) {
        void connection.sendDiagnostics({
          uri: textDoc.uri,
          version: textDoc.version,
          diagnostics: [{
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            severity: DiagnosticSeverity.Error,
            message: `Grammar not loaded. Run "treelsp build" to generate grammar.wasm.`,
            source: langId,
          }],
        });
      }
      return;
    }
    const diagnostics = service.computeDiagnostics(state);
    connection.console.log(`[validation] ${diagnostics.map(d => `range=${getRangeStr(d.range.start, d.range.end)} message=${d.message}`).join(', ')}`)
    void connection.sendDiagnostics({
      uri: textDoc.uri,
      version: textDoc.version,
      diagnostics: diagnostics.map(d => {
        const lspDiag: { range: typeof d.range; severity: typeof severityMap[typeof d.severity]; message: string; code?: string; source: string } = {
          range: d.range,
          severity: severityMap[d.severity],
          message: d.message,
          source: d.source ?? langId,
        };
        if (d.code) {
          lspDiag.code = d.code;
        }
        return lspDiag;
      }),
    });
  }

  // Initialize
  connection.onInitialize(() => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      completionProvider: { resolveProvider: false },
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes: [...SEMANTIC_TOKEN_TYPES],
          tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
        },
        full: true,
      },
    },
  }));

  // Document open
  textDocuments.onDidOpen(async (event) => {
    connection.console.log(`[open] ${event.document.uri} v${event.document.version}`);
    await validateDocument(event.document);
    connection.console.log(`[open] done ${event.document.uri}`);
  });

  // Document change
  textDocuments.onDidChangeContent(async (event) => {
    connection.console.log(`[change] ${event.document.uri} v${event.document.version}`);
    const state = await getDocumentState(event.document);
    if (!state) return;
    state.update(event.document.getText(), event.document.version);
    service.documents.change(state);
    await validateDocument(event.document);
  });

  // Document close
  textDocuments.onDidClose((event) => {
    const state = documentStates.get(event.document.uri);
    if (state) {
      service.documents.close(event.document.uri);
      state.dispose();
      documentStates.delete(event.document.uri);
    }
    void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });

  // Hover
  connection.onHover(async (params) => {
    try {
      const textDoc = textDocuments.get(params.textDocument.uri);
      if (!textDoc) return null;
      const state = await getDocumentState(textDoc);
      if (!state) return null;
      const result = service.provideHover(state, params.position);
      if (!result) return null;
      return {
        contents: { kind: 'markdown' as const, value: result.contents },
        range: result.range,
      };
    } catch (e) {
      connection.console.error(`[hover] error: ${String(e)}`);
      return null;
    }
  });

  // Definition
  connection.onDefinition(async (params) => {
    const textDoc = textDocuments.get(params.textDocument.uri);
    if (!textDoc) {
      connection.console.log(`[definition] no textDoc for ${params.textDocument.uri}`);
      return null;
    }
    try {
      const state = await getDocumentState(textDoc);
      if (!state) return null;
      const pos = params.position;
      const node = state.root.descendantForPosition(pos);
      connection.console.log(`[definition] pos=${pos.line}:${pos.character} node=${node.type} "${node.text}" range=${getRangeStr(node.startPosition, node.endPosition)}`);
      const result = service.provideDefinition(state, params.position);
      connection.console.log(`[definition] result=${result ? `${result.uri} ${result.range.start.line}:${result.range.start.character}` : 'null'}`);
      if (!result) return null;
      return { uri: result.uri, range: result.range };
    } catch (e) {
      connection.console.error(`[definition] error: ${String(e)}`);
      return null;
    }
  });

  // References
  connection.onReferences(async (params) => {
    const textDoc = textDocuments.get(params.textDocument.uri);
    if (!textDoc) {
      connection.console.log(`[references] no textDoc for ${params.textDocument.uri}`);
      return [];
    }
    try {
      const state = await getDocumentState(textDoc);
      if (!state) return [];
      const pos = params.position;
      const node = state.root.descendantForPosition(pos);
      connection.console.log(`[references] pos=${pos.line}:${pos.character} node=${node.type} "${node.text}" range=${node.startPosition.line}:${node.startPosition.character}-${node.endPosition.line}:${node.endPosition.character}`);
      const results = service.provideReferences(state, params.position);
      connection.console.log(`[references] found ${results.length} references`);
      return results.map(r => ({ uri: r.uri, range: r.range }));
    } catch (e) {
      connection.console.error(`[references] error: ${String(e)}`);
      return [];
    }
  });

  // Completion
  connection.onCompletion(async (params) => {
    try {
      const textDoc = textDocuments.get(params.textDocument.uri);
      if (!textDoc) return [];
      const state = await getDocumentState(textDoc);
      if (!state) return [];
      const items = service.provideCompletion(state, params.position);
      return items.map(toLspCompletionItem);
    } catch (e) {
      connection.console.error(`[completion] error: ${String(e)}`);
      return [];
    }
  });

  // Prepare rename
  connection.onPrepareRename(async (params) => {
    try {
      const textDoc = textDocuments.get(params.textDocument.uri);
      if (!textDoc) return null;
      const state = await getDocumentState(textDoc);
      if (!state) return null;
      return service.prepareRename(state, params.position);
    } catch (e) {
      connection.console.error(`[prepareRename] error: ${String(e)}`);
      return null;
    }
  });

  // Rename
  connection.onRenameRequest(async (params) => {
    try {
      const textDoc = textDocuments.get(params.textDocument.uri);
      if (!textDoc) return null;
      const state = await getDocumentState(textDoc);
      if (!state) return null;
      const result = service.provideRename(state, params.position, params.newName);
      if (!result) return null;
      const changes: Record<string, Array<{ range: typeof result.changes[string][number]['range']; newText: string }>> = {};
      for (const [uri, edits] of Object.entries(result.changes)) {
        changes[uri] = edits.map(e => ({ range: e.range, newText: e.newText }));
      }
      return { changes };
    } catch (e) {
      connection.console.error(`[rename] error: ${String(e)}`);
      return null;
    }
  });

  // Document symbols
  connection.onDocumentSymbol(async (params) => {
    try {
      const textDoc = textDocuments.get(params.textDocument.uri);
      if (!textDoc) return [];
      const state = await getDocumentState(textDoc);
      if (!state) return [];
      const symbols = service.provideSymbols(state);
      return symbols.map((s): LspDocumentSymbol => {
        const sym: LspDocumentSymbol = {
          name: s.name,
          kind: s.kindNumber as LspSymbolKind,
          range: s.range,
          selectionRange: s.selectionRange,
          children: [],
        };
        if (s.detail) {
          sym.detail = s.detail;
        }
        return sym;
      });
    } catch (e) {
      connection.console.error(`[symbols] error: ${String(e)}`);
      return [];
    }
  });

  // Semantic tokens
  connection.languages.semanticTokens.on(async (params) => {
    try {
      const textDoc = textDocuments.get(params.textDocument.uri);
      if (!textDoc) return { data: [] };
      const state = await getDocumentState(textDoc);
      if (!state) return { data: [] };
      return service.provideSemanticTokensFull(state);
    } catch (e) {
      connection.console.error(`[semanticTokens] error: ${String(e)}`);
      return { data: [] };
    }
  });

  // Start listening
  textDocuments.listen(connection);
  connection.listen();
}
