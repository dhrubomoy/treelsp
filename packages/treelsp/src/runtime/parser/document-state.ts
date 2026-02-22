/**
 * DocumentState interface
 *
 * Represents a parsed document. All parser backends must produce
 * implementations that satisfy this interface.
 */

import type { ASTNode, Position } from './ast-node.js';

/**
 * Document metadata for LSP integration
 */
export interface DocumentMetadata {
  /** Document URI (file path or URL) */
  uri: string;

  /** Document version (incremented on each edit) */
  version: number;

  /** Language identifier (e.g., 'minilang', 'mylang') */
  languageId: string;
}

/**
 * Text document edit (LSP format)
 */
export interface TextEdit {
  range: {
    start: Position;
    end: Position;
  };
  newText: string;
}

/**
 * Content change for incremental updates (matches LSP TextDocumentContentChangeEvent)
 */
export interface ContentChange {
  /** Range being replaced */
  range: {
    start: Position;
    end: Position;
  };
  /** New text for the range */
  text: string;
}

/**
 * A byte range in the document that changed after an incremental parse.
 */
export interface ChangedRange {
  /** Start byte offset (inclusive) */
  startIndex: number;
  /** End byte offset (exclusive) */
  endIndex: number;
}

/**
 * Abstract document state interface
 *
 * Represents a parsed document with incremental update support.
 * All parser backends must provide implementations of this interface.
 */
export interface DocumentState {
  /** Root AST node of the parsed document. */
  readonly root: ASTNode;

  /**
   * Update document with new text (full replacement).
   * Use this when only the final text is known (no change ranges).
   */
  update(newText: string, newVersion?: number): void;

  /**
   * Update document with incremental content changes.
   * Changes are applied sequentially — each change is relative to text after the previous.
   */
  updateIncremental(changes: ContentChange[], newVersion?: number): void;

  /** Current source text. */
  readonly text: string;

  /** Document URI. */
  readonly uri: string;

  /** Document version. */
  readonly version: number;

  /** Language ID. */
  readonly languageId: string;

  /** Whether the document has parse errors. */
  readonly hasErrors: boolean;

  /**
   * Byte ranges that changed in the most recent incremental parse.
   * Undefined after initial parse or full-text update.
   * Enables downstream optimizations (e.g., smart cross-file rescoping).
   */
  readonly changedRanges: ChangedRange[] | undefined;

  /** Dispose resources (free parser memory). */
  dispose(): void;
}
