/**
 * LSP server implementation
 * Wires all handlers together into a language service object
 */

import type { Position } from '../parser/ast-node.js';
import type { DocumentState } from '../parser/document-state.js';
import type { LanguageDefinition } from '../../definition/index.js';
import { DocumentManager } from './documents.js';
import { computeDiagnostics, type Diagnostic } from './diagnostics.js';
import { provideHover, type HoverResult } from './hover.js';
import { provideDefinition, type DefinitionResult } from './definition.js';
import { provideReferences, type ReferenceLocation } from './references.js';
import { provideCompletion, getCompletionTriggerCharacters } from './completion.js';
import { prepareRename, provideRename, type PrepareRenameResult, type RenameResult } from './rename.js';
import { provideSymbols, type DocumentSymbol } from './symbols.js';
import { provideSemanticTokensFull, type SemanticTokensResult } from './semantic-tokens.js';
import { provideSignatureHelp, getSignatureTriggerCharacters, type SignatureHelpResult } from './signature-help.js';
import { provideCodeActions, type CodeAction } from './code-actions.js';
import { provideFoldingRanges, type FoldingRange } from './folding-ranges.js';
import { provideWorkspaceSymbols, type WorkspaceSymbol } from './workspace-symbols.js';
import { provideDocumentFormatting, type FormattingOptions } from './formatting.js';
import type { CompletionItem, FormattingEdit } from '../../definition/lsp.js';

/**
 * Language service — provides all LSP handler methods
 *
 * This is NOT an LSP server transport. It's a language service object
 * with methods matching LSP requests. The actual transport (stdio, WebSocket)
 * is set up by the VS Code extension or CLI.
 */
export interface LanguageService {
  /** Document lifecycle */
  documents: DocumentManager;

  /** Diagnostics */
  computeDiagnostics(document: DocumentState): Diagnostic[];

  /** Hover */
  provideHover(document: DocumentState, position: Position): HoverResult | null;

  /** Go-to-definition */
  provideDefinition(document: DocumentState, position: Position): DefinitionResult | null;

  /** Find references */
  provideReferences(document: DocumentState, position: Position): ReferenceLocation[];

  /** Completion */
  provideCompletion(document: DocumentState, position: Position): CompletionItem[];

  /** Prepare rename (check if rename is possible) */
  prepareRename(document: DocumentState, position: Position): PrepareRenameResult | null;

  /** Rename */
  provideRename(document: DocumentState, position: Position, newName: string): RenameResult | null;

  /** Document symbols */
  provideSymbols(document: DocumentState): DocumentSymbol[];

  /** Semantic tokens (full document) */
  provideSemanticTokensFull(document: DocumentState): SemanticTokensResult;

  /** Signature help */
  provideSignatureHelp(document: DocumentState, position: Position): SignatureHelpResult | null;

  /** Code actions (quick fixes from diagnostics) */
  provideCodeActions(document: DocumentState, range: { start: Position; end: Position }): CodeAction[];

  /** Folding ranges */
  provideFoldingRanges(document: DocumentState): FoldingRange[];

  /** Workspace symbols (search across all open documents) */
  provideWorkspaceSymbols(query: string): WorkspaceSymbol[];

  /** Document formatting */
  provideDocumentFormatting(document: DocumentState, options: FormattingOptions): FormattingEdit[];

  /** Whether the language definition has a custom formatter */
  hasFormatter: boolean;

  /** Signature help trigger characters (from lsp config) */
  signatureTriggerCharacters: string[];

  /** Completion trigger characters (from lsp config) */
  completionTriggerCharacters: string[];
}

/**
 * Create language service from language definition
 *
 * @param definition The language definition from defineLanguage()
 * @returns LanguageService with all LSP handler methods
 */
export function createServer(definition: LanguageDefinition): LanguageService {
  const semantic = definition.semantic ?? {};
  const lsp = definition.lsp;
  const validation = definition.validation;

  const documents = new DocumentManager(semantic);
  const triggerChars = getSignatureTriggerCharacters(lsp);
  const completionTriggers = getCompletionTriggerCharacters(lsp);

  function getDocScope(document: DocumentState) {
    const wsDoc = documents.get(document.uri);
    if (wsDoc) {
      // If the workspace has a different DocumentState (e.g., recreated after a race),
      // re-register so the scope matches the current AST.
      if (wsDoc.document !== document) {
        return documents.change(document);
      }
      return wsDoc.scope;
    }
    // Auto-register if not already in workspace
    return documents.open(document);
  }

  return {
    documents,

    computeDiagnostics(document: DocumentState): Diagnostic[] {
      const docScope = getDocScope(document);
      return computeDiagnostics(
        document, docScope, semantic, lsp, validation, documents.getWorkspace()
      );
    },

    provideHover(document: DocumentState, position: Position): HoverResult | null {
      const docScope = getDocScope(document);
      return provideHover(
        document, position, docScope, semantic, lsp, documents.getWorkspace()
      );
    },

    provideDefinition(document: DocumentState, position: Position): DefinitionResult | null {
      const docScope = getDocScope(document);
      return provideDefinition(document, position, docScope, documents.getWorkspace());
    },

    provideReferences(document: DocumentState, position: Position): ReferenceLocation[] {
      const docScope = getDocScope(document);
      return provideReferences(
        document, position, docScope, documents.getWorkspace()
      );
    },

    provideCompletion(document: DocumentState, position: Position): CompletionItem[] {
      const docScope = getDocScope(document);
      return provideCompletion(
        document, position, docScope, semantic, lsp, documents.getWorkspace()
      );
    },

    prepareRename(document: DocumentState, position: Position): PrepareRenameResult | null {
      const docScope = getDocScope(document);
      return prepareRename(document, position, docScope);
    },

    provideRename(document: DocumentState, position: Position, newName: string): RenameResult | null {
      const docScope = getDocScope(document);
      return provideRename(
        document, position, newName, docScope, documents.getWorkspace()
      );
    },

    provideSymbols(document: DocumentState): DocumentSymbol[] {
      const docScope = getDocScope(document);
      return provideSymbols(docScope, lsp);
    },

    provideSemanticTokensFull(document: DocumentState): SemanticTokensResult {
      const docScope = getDocScope(document);
      return provideSemanticTokensFull(document, docScope, semantic, lsp);
    },

    provideSignatureHelp(document: DocumentState, position: Position): SignatureHelpResult | null {
      const docScope = getDocScope(document);
      return provideSignatureHelp(document, position, docScope, lsp, documents.getWorkspace());
    },

    provideCodeActions(document: DocumentState, range: { start: Position; end: Position }): CodeAction[] {
      const diagnostics = this.computeDiagnostics(document);
      return provideCodeActions(diagnostics, range, document.uri);
    },

    provideFoldingRanges(document: DocumentState): FoldingRange[] {
      return provideFoldingRanges(document, lsp);
    },

    provideWorkspaceSymbols(query: string): WorkspaceSymbol[] {
      return provideWorkspaceSymbols(query, documents, lsp);
    },

    provideDocumentFormatting(document: DocumentState, options: FormattingOptions): FormattingEdit[] {
      return provideDocumentFormatting(document, options, lsp);
    },

    hasFormatter: !!lsp?.$format,

    signatureTriggerCharacters: triggerChars,
    completionTriggerCharacters: completionTriggers,
  };
}
