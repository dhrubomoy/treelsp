/**
 * Tests for startStdioServer
 * Mocks vscode-languageserver to verify handler wiring
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LanguageDefinition } from '../definition/index.js';

// Mock connection object
const mockConnection = {
  onInitialize: vi.fn(),
  onHover: vi.fn(),
  onDefinition: vi.fn(),
  onReferences: vi.fn(),
  onCompletion: vi.fn(),
  onRenameRequest: vi.fn(),
  onDocumentSymbol: vi.fn(),
  sendDiagnostics: vi.fn(),
  listen: vi.fn(),
};

// Mock TextDocuments
const mockTextDocuments = {
  onDidOpen: vi.fn(),
  onDidChangeContent: vi.fn(),
  onDidClose: vi.fn(),
  listen: vi.fn(),
  get: vi.fn(),
};

vi.mock('vscode-languageserver/lib/node/main.js', () => ({
  createConnection: vi.fn(() => mockConnection),
  TextDocuments: vi.fn(() => mockTextDocuments),
  ProposedFeatures: { all: [] },
  TextDocumentSyncKind: { Full: 1 },
  DiagnosticSeverity: { Error: 1, Warning: 2, Information: 3, Hint: 4 },
  SymbolKind: {},
  CompletionItemKind: {},
}));

vi.mock('vscode-languageserver-textdocument', () => ({
  TextDocument: class {},
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
    expect(mockTextDocuments.listen).toHaveBeenCalledWith(mockConnection);
    expect(mockConnection.listen).toHaveBeenCalled();
  });

  it('registers onInitialize handler', async () => {
    await startServer();
    expect(mockConnection.onInitialize).toHaveBeenCalledOnce();

    // Call the handler to check capabilities
    const handler = mockConnection.onInitialize.mock.calls[0]![0] as () => unknown;
    const result = handler() as { capabilities: Record<string, unknown> };
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.definitionProvider).toBe(true);
    expect(result.capabilities.referencesProvider).toBe(true);
    expect(result.capabilities.renameProvider).toBe(true);
    expect(result.capabilities.documentSymbolProvider).toBe(true);
    expect(result.capabilities.completionProvider).toEqual({ resolveProvider: false });
  });

  it('registers all LSP request handlers', async () => {
    await startServer();
    expect(mockConnection.onHover).toHaveBeenCalledOnce();
    expect(mockConnection.onDefinition).toHaveBeenCalledOnce();
    expect(mockConnection.onReferences).toHaveBeenCalledOnce();
    expect(mockConnection.onCompletion).toHaveBeenCalledOnce();
    expect(mockConnection.onRenameRequest).toHaveBeenCalledOnce();
    expect(mockConnection.onDocumentSymbol).toHaveBeenCalledOnce();
  });

  it('registers document lifecycle handlers', async () => {
    await startServer();
    expect(mockTextDocuments.onDidOpen).toHaveBeenCalledOnce();
    expect(mockTextDocuments.onDidChangeContent).toHaveBeenCalledOnce();
    expect(mockTextDocuments.onDidClose).toHaveBeenCalledOnce();
  });
});
