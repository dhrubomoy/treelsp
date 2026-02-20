/**
 * Tree-sitter runtime backend
 *
 * Implements ParserBackendRuntime for Tree-sitter.
 * Used by the LSP server to create DocumentState instances.
 *
 * The codegen counterpart (ParserBackendCodegen) lives in
 * codegen/tree-sitter/codegen.ts and is used by the CLI.
 */

import type { ParserBackendRuntime } from '../backend.js';
import type { DocumentState, DocumentMetadata } from '../document-state.js';
import { createDocumentState } from './tree.js';

export class TreeSitterRuntime implements ParserBackendRuntime {
  readonly id = 'tree-sitter';

  async createDocumentState(
    parserPath: string,
    metadata: DocumentMetadata,
    text: string,
  ): Promise<DocumentState> {
    return createDocumentState(parserPath, metadata, text);
  }
}
