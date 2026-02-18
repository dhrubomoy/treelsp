/**
 * Document tree
 * Manages Tree-sitter tree and incremental updates
 */

import type Parser from 'web-tree-sitter';
import { ASTNode, type Position } from './node.js';
import { createParser } from './wasm.js';

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
 * Compute the character offset in text for a given Position.
 * Consistent with the codebase convention of treating tree-sitter
 * byte offsets as character offsets (works for ASCII; see node.ts:141).
 */
function charOffsetFromPosition(text: string, pos: Position): number {
  let line = 0;
  let i = 0;
  while (line < pos.line && i < text.length) {
    if (text.charCodeAt(i) === 10) { // '\n'
      line++;
    }
    i++;
  }
  return i + pos.character;
}

/**
 * Compute tree-sitter column (offset from line start) for a Position.
 */
function columnFromPosition(text: string, pos: Position): number {
  // For ASCII text, column == character. For consistency with the existing
  // codebase convention (node.ts toPosition), we use character directly.
  // A future UTF-8-aware version would compute byte offset within the line.
  return pos.character;
}

/**
 * Compute the new end Point after inserting text at a given start position.
 */
function computeNewEndPoint(
  startLine: number,
  startColumn: number,
  newText: string
): { row: number; column: number } {
  let row = startLine;
  let column = startColumn;
  for (let i = 0; i < newText.length; i++) {
    if (newText.charCodeAt(i) === 10) { // '\n'
      row++;
      column = 0;
    } else {
      column++;
    }
  }
  return { row, column };
}

/**
 * Document state with incremental parsing
 *
 * Parsing strategy:
 * - Keystroke → Tree-sitter incremental CST reparse → full AST rebuild → full scope rebuild
 * - When content changes are provided (via updateIncremental), tree.edit() is called
 *   before reparsing with the old tree, enabling Tree-sitter's incremental CST reuse
 * - When only full text is provided (via update), a full reparse is done
 * - AST and scope are always full recompute (simple and correct)
 * - DocumentState.update()/updateIncremental() own the boundary
 *
 * Memory management:
 * - Tree-sitter uses WASM memory that must be explicitly freed
 * - Call dispose() when done with the document
 */
export class DocumentState {
  /**
   * Document metadata
   */
  private metadata: DocumentMetadata;

  /**
   * Current source text
   */
  private sourceText: string;

  /**
   * Tree-sitter parser (owns the Language)
   */
  private parser: Parser;

  /**
   * Current parse tree (kept for incremental parsing)
   * Must be deleted when replaced to free WASM memory
   */
  private tree: Parser.Tree | null = null;

  /**
   * Root AST node (cached after parse)
   */
  private rootNode: ASTNode | null = null;

  constructor(
    parser: Parser,
    metadata: DocumentMetadata,
    initialText: string
  ) {
    this.parser = parser;
    this.metadata = metadata;
    this.sourceText = initialText;

    // Initial parse
    this.reparse();
  }

  /**
   * Parse or reparse the document
   *
   * @param oldTree Optional old tree for incremental parsing.
   *   When provided (after tree.edit() has been called), Tree-sitter
   *   reuses unchanged nodes for faster parsing.
   */
  private reparse(oldTree?: Parser.Tree): void {
    const newTree = this.parser.parse(this.sourceText, oldTree);

    // Delete old tree to free WASM memory
    if (this.tree) {
      this.tree.delete();
    }

    this.tree = newTree;

    // Wrap root node with source provider for efficient text access
    this.rootNode = new ASTNode(
      newTree.rootNode,
      () => this.sourceText
    );
  }

  /**
   * Get root AST node
   */
  get root(): ASTNode {
    if (!this.rootNode) {
      throw new Error('Document has not been parsed');
    }
    return this.rootNode;
  }

  /**
   * Update document with new text (full replacement, no incremental reuse)
   *
   * Use this when only the final text is known (no change ranges available).
   * For incremental parsing with Tree-sitter CST reuse, use updateIncremental().
   *
   * @param newText New source text
   * @param newVersion Document version after update (optional, will auto-increment)
   */
  update(newText: string, newVersion?: number): void {
    this.sourceText = newText;

    if (newVersion !== undefined) {
      this.metadata.version = newVersion;
    } else {
      this.metadata.version++;
    }

    // Full reparse — no incremental CST reuse
    this.reparse();
  }

  /**
   * Update document with incremental content changes
   *
   * Applies tree.edit() for each change before reparsing with the old tree,
   * enabling Tree-sitter's incremental CST reuse. Changes are applied
   * sequentially — each change is relative to the text after the previous change.
   *
   * @param changes Content changes (matches LSP TextDocumentContentChangeEvent with range)
   * @param newVersion Document version after update (optional, will auto-increment)
   */
  updateIncremental(changes: ContentChange[], newVersion?: number): void {
    if (!this.tree) {
      throw new Error('Cannot update incrementally: no existing tree');
    }

    if (newVersion !== undefined) {
      this.metadata.version = newVersion;
    } else {
      this.metadata.version++;
    }

    // Apply each change sequentially to both the tree and source text
    for (const change of changes) {
      const startCharOffset = charOffsetFromPosition(this.sourceText, change.range.start);
      const endCharOffset = charOffsetFromPosition(this.sourceText, change.range.end);

      const startColumn = columnFromPosition(this.sourceText, change.range.start);
      const endColumn = columnFromPosition(this.sourceText, change.range.end);

      const newEndPoint = computeNewEndPoint(
        change.range.start.line,
        startColumn,
        change.text
      );

      this.tree.edit({
        startIndex: startCharOffset,
        oldEndIndex: endCharOffset,
        newEndIndex: startCharOffset + change.text.length,
        startPosition: { row: change.range.start.line, column: startColumn },
        oldEndPosition: { row: change.range.end.line, column: endColumn },
        newEndPosition: newEndPoint,
      });

      // Apply the text change
      this.sourceText =
        this.sourceText.slice(0, startCharOffset) +
        change.text +
        this.sourceText.slice(endCharOffset);
    }

    // Reparse with old tree for incremental CST reuse
    this.reparse(this.tree);
  }

  /**
   * Get current source text
   */
  get text(): string {
    return this.sourceText;
  }

  /**
   * Get document URI
   */
  get uri(): string {
    return this.metadata.uri;
  }

  /**
   * Get document version
   */
  get version(): number {
    return this.metadata.version;
  }

  /**
   * Get language ID
   */
  get languageId(): string {
    return this.metadata.languageId;
  }

  /**
   * Check if document has parse errors
   * Tree-sitter is error-tolerant - always returns a tree
   * Check this to detect ERROR nodes
   */
  get hasErrors(): boolean {
    return this.root.isError;
  }

  /**
   * Dispose resources (free WASM memory)
   * Call this when done with the document
   *
   * @example
   * ```typescript
   * const doc = await createDocumentState(...);
   * try {
   *   // Use document
   * } finally {
   *   doc.dispose();
   * }
   * ```
   */
  dispose(): void {
    if (this.tree) {
      this.tree.delete();
      this.tree = null;
    }
    this.rootNode = null;
  }
}

/**
 * Create a new document state
 *
 * @param wasmPath Path to grammar WASM file (e.g., './generated/grammar.wasm')
 * @param metadata Document metadata
 * @param initialText Initial document text
 * @returns Promise<DocumentState>
 *
 * @example
 * ```typescript
 * const doc = await createDocumentState(
 *   './generated/grammar.wasm',
 *   { uri: 'file:///test.mylang', version: 1, languageId: 'mylang' },
 *   'let x = 42;'
 * );
 *
 * const root = doc.root;
 * console.log(root.type); // 'program'
 *
 * doc.update('let y = 99;');
 * console.log(doc.version); // 2
 *
 * doc.dispose(); // Free WASM memory
 * ```
 */
export async function createDocumentState(
  wasmPath: string,
  metadata: DocumentMetadata,
  initialText: string
): Promise<DocumentState> {
  const parser = await createParser(wasmPath);
  return new DocumentState(parser, metadata, initialText);
}
