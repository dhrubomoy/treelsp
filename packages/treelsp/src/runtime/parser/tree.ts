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
 * V2 preview: not used in v1 but API is ready
 */
export interface TextEdit {
  range: {
    start: Position;
    end: Position;
  };
  newText: string;
}

/**
 * Document state with incremental parsing
 *
 * V1 strategy (DESIGN.md lines 16-24):
 * - Keystroke → Tree-sitter incremental CST reparse → full AST rebuild → full scope rebuild
 * - Tree-sitter's CST reparse is incremental automatically (via oldTree)
 * - AST and scope are full recompute (simple and correct)
 * - DocumentState.update() owns the boundary, designed for v2 incremental upgrade
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
   * V1 strategy: Always parse from scratch (no incremental CST reuse).
   * Tree-sitter's incremental parsing requires calling tree.edit() with
   * precise byte-offset edit info before passing the old tree. Without it,
   * tree-sitter reuses old nodes at wrong positions, producing garbled ASTs.
   * V2 will add proper edit tracking to enable incremental parsing.
   */
  private reparse(): void {
    const newTree = this.parser.parse(this.sourceText);

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
   * Update document with new text (full replacement)
   *
   * V1 API: Simple full text replacement
   * Tree-sitter does incremental CST reparse automatically via oldTree
   * We rebuild the full AST wrapper (simple and correct for v1)
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

    // Full reparse (v1 strategy — no incremental CST, no tree.edit())
    this.reparse();
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
