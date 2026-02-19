/**
 * LSP server transport for Node.js stdio
 *
 * Provides startStdioServer() that wires a LanguageService to a
 * vscode-languageserver connection over stdio. Separate from treelsp/runtime
 * to keep the runtime browser-compatible.
 */

import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  SymbolKind as LspSymbolKind,
  CompletionItemKind as LspCompletionItemKind,
  type DocumentSymbol as LspDocumentSymbol,
  type CompletionItem as LspCompletionItem,
} from 'vscode-languageserver/lib/node/main.js';
import { createServer, createDocumentState, SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS } from '../runtime/index.js';
import { COMPLETION_KIND_MAP } from '../runtime/lsp/completion.js';
import type { LanguageDefinition } from '../definition/index.js';
import type { DocumentState, ContentChange } from '../runtime/parser/tree.js';
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

interface LspPosition {
  line: number;
  character: number;
}

function getRangeStr(start: LspPosition, end: LspPosition) {
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
 *
 * Uses incremental text document sync to enable Tree-sitter's incremental
 * CST reuse on each keystroke.
 */
export function startStdioServer(options: StdioServerOptions): void {
  const { definition, wasmPath } = options;
  const langId = definition.name.toLowerCase();

  const connection = createConnection(ProposedFeatures.all);
  const service = createServer(definition);
  const documentStates = new Map<string, DocumentState>();
  // Promise cache prevents duplicate WASM init calls when concurrent requests
  // arrive before the first createDocumentState completes.
  const pendingInits = new Map<string, Promise<DocumentState>>();
  // Tracks WASM load failure so we don't retry on every keystroke
  let wasmError: string | null = null;

  async function initDocumentState(
    uri: string,
    version: number,
    text: string
  ): Promise<DocumentState | null> {
    const existing = documentStates.get(uri);
    if (existing) return existing;

    // If WASM already failed, don't retry on every request.
    // User must fix the issue and restart the server.
    if (wasmError) return null;

    // Deduplicate: reuse in-flight init for the same URI
    let promise = pendingInits.get(uri);
    if (!promise) {
      promise = createDocumentState(wasmPath, {
        uri,
        version,
        languageId: langId,
      }, text);
      pendingInits.set(uri, promise);
    }

    try {
      const state = await promise;
      documentStates.set(uri, state);
      pendingInits.delete(uri);
      return state;
    } catch (error) {
      pendingInits.delete(uri);
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

  function validateDocument(uri: string, version: number): void {
    const state = documentStates.get(uri);
    if (!state) {
      // Show a diagnostic so the user sees the problem in the editor
      if (wasmError) {
        void connection.sendDiagnostics({
          uri,
          version,
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
      uri,
      version,
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
  connection.onInitialize(() => {
    const capabilities: Record<string, unknown> = {
      textDocumentSync: TextDocumentSyncKind.Incremental,
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
    };
    if (service.signatureTriggerCharacters.length > 0) {
      capabilities.signatureHelpProvider = {
        triggerCharacters: service.signatureTriggerCharacters,
      };
    }
    return { capabilities };
  });

  // Document open — receive full text
  connection.onDidOpenTextDocument((params) => {
    const { uri, version, text } = params.textDocument;
    connection.console.log(`[open] ${uri} v${version}`);
    void initDocumentState(uri, version, text).then((state) => {
      if (state) {
        service.documents.open(state);
      }
      validateDocument(uri, version);
      connection.console.log(`[open] done ${uri}`);
    });
  });

  // Document change — receive incremental content changes
  connection.onDidChangeTextDocument((params) => {
    const { uri, version } = params.textDocument;
    connection.console.log(`[change] ${uri} v${version}`);
    const state = documentStates.get(uri);
    if (!state) return;

    // Check if this is a full-text change (no range = full replacement)
    const firstChange = params.contentChanges[0];
    if (firstChange && !('range' in firstChange)) {
      // Full content change — use non-incremental update
      state.update(firstChange.text, version);
    } else {
      // Incremental changes — use tree.edit() + incremental reparse
      const changes: ContentChange[] = params.contentChanges
        .filter((c): c is typeof c & { range: { start: LspPosition; end: LspPosition } } => 'range' in c)
        .map(c => ({
          range: c.range,
          text: c.text,
        }));
      state.updateIncremental(changes, version);
    }

    service.documents.change(state);
    validateDocument(uri, version);
  });

  // Document close
  connection.onDidCloseTextDocument((params) => {
    const uri = params.textDocument.uri;
    const state = documentStates.get(uri);
    if (state) {
      service.documents.close(uri);
      state.dispose();
      documentStates.delete(uri);
    }
    void connection.sendDiagnostics({ uri, diagnostics: [] });
  });

  // Hover
  connection.onHover((params) => {
    try {
      const state = documentStates.get(params.textDocument.uri);
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
  connection.onDefinition((params) => {
    const state = documentStates.get(params.textDocument.uri);
    if (!state) {
      connection.console.log(`[definition] no state for ${params.textDocument.uri}`);
      return null;
    }
    try {
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
  connection.onReferences((params) => {
    const state = documentStates.get(params.textDocument.uri);
    if (!state) {
      connection.console.log(`[references] no state for ${params.textDocument.uri}`);
      return [];
    }
    try {
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
  connection.onCompletion((params) => {
    try {
      const state = documentStates.get(params.textDocument.uri);
      if (!state) return [];
      const items = service.provideCompletion(state, params.position);
      return items.map(toLspCompletionItem);
    } catch (e) {
      connection.console.error(`[completion] error: ${String(e)}`);
      return [];
    }
  });

  // Signature help
  connection.onSignatureHelp((params) => {
    try {
      const state = documentStates.get(params.textDocument.uri);
      if (!state) return null;
      return service.provideSignatureHelp(state, params.position);
    } catch (e) {
      connection.console.error(`[signatureHelp] error: ${String(e)}`);
      return null;
    }
  });

  // Prepare rename
  connection.onPrepareRename((params) => {
    try {
      const state = documentStates.get(params.textDocument.uri);
      if (!state) return null;
      return service.prepareRename(state, params.position);
    } catch (e) {
      connection.console.error(`[prepareRename] error: ${String(e)}`);
      return null;
    }
  });

  // Rename
  connection.onRenameRequest((params) => {
    try {
      const state = documentStates.get(params.textDocument.uri);
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
  connection.onDocumentSymbol((params) => {
    try {
      const state = documentStates.get(params.textDocument.uri);
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
  connection.languages.semanticTokens.on((params) => {
    try {
      const state = documentStates.get(params.textDocument.uri);
      if (!state) return { data: [] };
      return service.provideSemanticTokensFull(state);
    } catch (e) {
      connection.console.error(`[semanticTokens] error: ${String(e)}`);
      return { data: [] };
    }
  });

  // Start listening
  connection.listen();
}
