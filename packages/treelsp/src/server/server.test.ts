/**
 * Tests for startStdioServer
 * Mocks vscode-languageserver to verify handler wiring
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LanguageDefinition } from '../definition/index.js';

// Mock connection object
const mockConnection = {
  onInitialize: vi.fn(),
  onDidOpenTextDocument: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidCloseTextDocument: vi.fn(),
  onHover: vi.fn(),
  onDefinition: vi.fn(),
  onReferences: vi.fn(),
  onCompletion: vi.fn(),
  onSignatureHelp: vi.fn(),
  onCodeAction: vi.fn(),
  onPrepareRename: vi.fn(),
  onRenameRequest: vi.fn(),
  onDocumentSymbol: vi.fn(),
  onFoldingRanges: vi.fn(),
  onWorkspaceSymbol: vi.fn(),
  onDocumentFormatting: vi.fn(),
  sendDiagnostics: vi.fn(),
  listen: vi.fn(),
  console: { log: vi.fn(), error: vi.fn() },
  window: { showErrorMessage: vi.fn() },
  languages: {
    semanticTokens: {
      on: vi.fn(),
    },
  },
};

vi.mock('vscode-languageserver/lib/node/main.js', () => ({
  createConnection: vi.fn(function () { return mockConnection; }),
  ProposedFeatures: { all: [] },
  TextDocumentSyncKind: { Full: 1, Incremental: 2 },
  DiagnosticSeverity: { Error: 1, Warning: 2, Information: 3, Hint: 4 },
  SymbolKind: {},
  CompletionItemKind: {},
}));

// Minimal definition for testing
function createTestDefinition(): LanguageDefinition<'program' | 'identifier'> {
  return {
    name: 'TestLang',
    fileExtensions: ['.test'],
    entry: 'program',
    word: 'identifier',
    grammar: {
      program: r => r.repeat(r.rule('identifier')),
      identifier: r => r.token(/[a-z]+/),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('startStdioServer', () => {
  // Dynamic import to ensure mocks are applied first
  async function startServer(def?: LanguageDefinition) {
    const { startStdioServer } = await import('./index.js');
    startStdioServer({
      definition: def ?? createTestDefinition(),
      wasmPath: '/tmp/grammar.wasm',
    });
  }

  it('creates connection and starts listening', async () => {
    await startServer();
    expect(mockConnection.listen).toHaveBeenCalled();
  });

  it('registers onInitialize handler with incremental sync', async () => {
    await startServer();
    expect(mockConnection.onInitialize).toHaveBeenCalledOnce();

    // Call the handler to check capabilities
    const handler = mockConnection.onInitialize.mock.calls[0]![0] as () => unknown;
    const result = handler() as { capabilities: Record<string, unknown> };
    expect(result.capabilities.textDocumentSync).toBe(2); // TextDocumentSyncKind.Incremental
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.definitionProvider).toBe(true);
    expect(result.capabilities.referencesProvider).toBe(true);
    expect(result.capabilities.renameProvider).toEqual({ prepareProvider: true });
    expect(result.capabilities.documentSymbolProvider).toBe(true);
    expect(result.capabilities.completionProvider).toEqual({ resolveProvider: false });
    expect(result.capabilities.foldingRangeProvider).toBe(true);
    expect(result.capabilities.workspaceSymbolProvider).toBe(true);
    expect(result.capabilities.semanticTokensProvider).toBeDefined();
  });

  it('registers all LSP request handlers', async () => {
    await startServer();
    expect(mockConnection.onHover).toHaveBeenCalledOnce();
    expect(mockConnection.onDefinition).toHaveBeenCalledOnce();
    expect(mockConnection.onReferences).toHaveBeenCalledOnce();
    expect(mockConnection.onCompletion).toHaveBeenCalledOnce();
    expect(mockConnection.onCodeAction).toHaveBeenCalledOnce();
    expect(mockConnection.onPrepareRename).toHaveBeenCalledOnce();
    expect(mockConnection.onRenameRequest).toHaveBeenCalledOnce();
    expect(mockConnection.onDocumentSymbol).toHaveBeenCalledOnce();
    expect(mockConnection.onFoldingRanges).toHaveBeenCalledOnce();
    expect(mockConnection.onWorkspaceSymbol).toHaveBeenCalledOnce();
    expect(mockConnection.onDocumentFormatting).toHaveBeenCalledOnce();
  });

  it('registers document lifecycle handlers on connection', async () => {
    await startServer();
    expect(mockConnection.onDidOpenTextDocument).toHaveBeenCalledOnce();
    expect(mockConnection.onDidChangeTextDocument).toHaveBeenCalledOnce();
    expect(mockConnection.onDidCloseTextDocument).toHaveBeenCalledOnce();
  });
});
