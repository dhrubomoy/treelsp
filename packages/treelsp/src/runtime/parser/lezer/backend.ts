/**
 * Lezer runtime backend
 *
 * Implements ParserBackendRuntime for Lezer.
 * Used by the LSP server to create DocumentState instances.
 *
 * Unlike the tree-sitter backend which loads a .wasm file at runtime,
 * the Lezer backend receives the parser directly in its constructor
 * (bundled into the server by esbuild during the build step).
 */

import type { LRParser } from '@lezer/lr';
import type { ParserBackendRuntime } from '../backend.js';
import type { DocumentState, DocumentMetadata } from '../document-state.js';
import type { ParserMeta } from '../../../codegen/lezer/field-map.js';
import { LezerDocumentState } from './tree.js';

export class LezerRuntime implements ParserBackendRuntime {
  readonly id = 'lezer';

  private parser: LRParser;
  private meta: ParserMeta;

  constructor(parser: LRParser, meta: ParserMeta) {
    this.parser = parser;
    this.meta = meta;
  }

  async createDocumentState(
    _parserPath: string,
    metadata: DocumentMetadata,
    text: string,
  ): Promise<DocumentState> {
    // parserPath is ignored — the parser was provided in the constructor
    // (it was bundled into the server entry by esbuild)
    return new LezerDocumentState(this.parser, metadata, text, this.meta);
  }
}
