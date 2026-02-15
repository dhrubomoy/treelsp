/**
 * LSP server implementation
 * Wires all handlers together into a language service object
 */

import type { Position } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type { LanguageDefinition } from '../../definition/index.js';
import { DocumentManager } from './documents.js';
import { computeDiagnostics, type Diagnostic } from './diagnostics.js';
import { provideHover, type HoverResult } from './hover.js';
import { provideDefinition, type DefinitionResult } from './definition.js';
import { provideReferences, type ReferenceLocation } from './references.js';
import { provideCompletion } from './completion.js';
import { provideRename, type RenameResult } from './rename.js';
import { provideSymbols, type DocumentSymbol } from './symbols.js';
import type { CompletionItem } from '../../definition/lsp.js';

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

  /** Rename */
  provideRename(document: DocumentState, position: Position, newName: string): RenameResult | null;

  /** Document symbols */
  provideSymbols(document: DocumentState): DocumentSymbol[];
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

  function getDocScope(document: DocumentState) {
    const wsDoc = documents.get(document.uri);
    if (wsDoc) {
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
      return provideDefinition(document, position, docScope);
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
  };
}
