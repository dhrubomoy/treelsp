/**
 * Lezer DocumentState implementation
 * Manages Lezer tree and incremental updates
 */

import type { Tree } from '@lezer/common';
import type { LRParser } from '@lezer/lr';
import { TreeFragment } from '@lezer/common';
import { LezerASTNode } from './node.js';
import type { ASTNode } from '../ast-node.js';
import type { DocumentMetadata, ContentChange } from '../document-state.js';
import type { ParserMeta } from '../../../codegen/lezer/field-map.js';
import type { Position } from '../ast-node.js';

/**
 * Compute the character offset in text for a given Position.
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
 * Lezer document state with incremental parsing
 *
 * Parsing strategy:
 * - Initial parse creates a full Lezer tree
 * - Incremental updates use TreeFragment for partial reparse
 * - AST and scope are always full recompute (V1: simple and correct)
 */
export class LezerDocumentState {
  private metadata: DocumentMetadata;
  private sourceText: string;
  private parser: LRParser;
  private tree: Tree;
  private rootNode: ASTNode | null = null;
  private meta: ParserMeta;
  private wrapperNodeSet: Set<string>;
  private fragments: readonly TreeFragment[] = [];
  private disposed = false;

  /**
   * Byte ranges that changed in the most recent incremental parse.
   * Computed as the complement of preserved fragment ranges.
   * Undefined after initial parse or full-text update.
   */
  private _changedRanges: import('../document-state.js').ChangedRange[] | undefined;

  constructor(
    parser: LRParser,
    metadata: DocumentMetadata,
    initialText: string,
    meta: ParserMeta,
  ) {
    this.parser = parser;
    this.metadata = metadata;
    this.sourceText = initialText;
    this.meta = meta;
    this.wrapperNodeSet = new Set(meta.wrapperNodes ?? []);

    // Initial parse
    this.tree = this.parser.parse(initialText);
    this.fragments = TreeFragment.addTree(this.tree);
    this.rebuildRoot();
  }

  private rebuildRoot(): void {
    this.rootNode = new LezerASTNode(
      this.tree.topNode,
      () => this.sourceText,
      this.meta,
      this.wrapperNodeSet,
    );
  }

  get root(): ASTNode {
    if (!this.rootNode) {
      throw new Error('Document has not been parsed');
    }
    return this.rootNode;
  }

  get changedRanges(): import('../document-state.js').ChangedRange[] | undefined {
    return this._changedRanges;
  }

  update(newText: string, newVersion?: number): void {
    if (this.disposed) return;

    this.sourceText = newText;
    this._changedRanges = undefined;

    if (newVersion !== undefined) {
      this.metadata.version = newVersion;
    } else {
      this.metadata.version++;
    }

    // Full reparse
    this.tree = this.parser.parse(newText);
    this.fragments = TreeFragment.addTree(this.tree);
    this.rebuildRoot();
  }

  updateIncremental(changes: ContentChange[], newVersion?: number): void {
    if (this.disposed) return;
    if (newVersion !== undefined) {
      this.metadata.version = newVersion;
    } else {
      this.metadata.version++;
    }

    // Apply each change to the source text and update fragments
    for (const change of changes) {
      const startOffset = charOffsetFromPosition(this.sourceText, change.range.start);
      const endOffset = charOffsetFromPosition(this.sourceText, change.range.end);

      // Update fragments for incremental reparse
      this.fragments = TreeFragment.applyChanges(this.fragments, [{
        fromA: startOffset,
        toA: endOffset,
        fromB: startOffset,
        toB: startOffset + change.text.length,
      }]);

      // Apply the text change
      this.sourceText =
        this.sourceText.slice(0, startOffset) +
        change.text +
        this.sourceText.slice(endOffset);
    }

    // Capture fragments BEFORE addTree() — they represent unchanged regions.
    // Changed ranges are the complement of these fragments within the document.
    const preservedFragments = this.fragments;

    // Incremental reparse using fragments
    this.tree = this.parser.parse(this.sourceText, this.fragments);
    this.fragments = TreeFragment.addTree(this.tree, this.fragments);

    // Compute changed ranges as complement of preserved fragment ranges
    this._changedRanges = complementRanges(
      preservedFragments.map(f => ({ from: f.from, to: f.to })),
      this.sourceText.length,
    );

    this.rebuildRoot();
  }

  get text(): string {
    return this.sourceText;
  }

  get uri(): string {
    return this.metadata.uri;
  }

  get version(): number {
    return this.metadata.version;
  }

  get languageId(): string {
    return this.metadata.languageId;
  }

  get hasErrors(): boolean {
    // Walk the tree to check for any error nodes.
    // Lezer error nodes can appear anywhere in the tree, not just at the root.
    const cursor = this.tree.topNode.cursor();
    do {
      if (cursor.type.isError) return true;
    } while (cursor.next());
    return false;
  }

  dispose(): void {
    this.disposed = true;
    // Lezer trees are garbage collected — no explicit cleanup needed
    this.rootNode = null;
  }
}

/**
 * Compute the complement of a set of sorted, non-overlapping ranges within [0, length).
 * Returns the gaps — the ranges NOT covered by the input.
 */
function complementRanges(
  preserved: Array<{ from: number; to: number }>,
  length: number,
): Array<{ startIndex: number; endIndex: number }> {
  const result: Array<{ startIndex: number; endIndex: number }> = [];
  let cursor = 0;

  // Sort by start position (fragments should already be sorted, but be safe)
  const sorted = [...preserved].sort((a, b) => a.from - b.from);

  for (const frag of sorted) {
    if (frag.from > cursor) {
      result.push({ startIndex: cursor, endIndex: frag.from });
    }
    cursor = Math.max(cursor, frag.to);
  }

  if (cursor < length) {
    result.push({ startIndex: cursor, endIndex: length });
  }

  return result;
}
