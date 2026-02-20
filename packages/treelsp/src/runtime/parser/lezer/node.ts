/**
 * Lezer ASTNode implementation
 * Provides the ASTNode interface over Lezer's SyntaxNode
 *
 * Wrapper nodes (generated for field() support) are transparent:
 * they never appear in children, namedChildren, parent, or other navigation.
 * Field access finds the unique wrapper child and returns its inner content.
 */

import type { SyntaxNode, TreeCursor } from '@lezer/common';
import type { ASTNode, Position, SourceProvider } from '../ast-node.js';
import type { ParserMeta } from '../../../codegen/lezer/field-map.js';

/**
 * Lezer implementation of ASTNode
 *
 * Key differences from Tree-sitter:
 * - Field access uses wrapper nodes in the grammar (Lezer has no native field names)
 * - Wrapper nodes are transparent — all navigation methods skip them
 * - Node IDs are synthetic (computed from position + type)
 * - Named/unnamed distinction uses the nodeNameMap from metadata
 * - PascalCase Lezer names are mapped back to snake_case
 */
export class LezerASTNode implements ASTNode {
  private readonly syntaxNode: SyntaxNode;
  private readonly sourceProvider: SourceProvider;
  private readonly meta: ParserMeta;
  private readonly wrapperNodeSet: Set<string>;

  constructor(
    syntaxNode: SyntaxNode,
    sourceProvider: SourceProvider,
    meta: ParserMeta,
    wrapperNodeSet: Set<string>,
  ) {
    this.syntaxNode = syntaxNode;
    this.sourceProvider = sourceProvider;
    this.meta = meta;
    this.wrapperNodeSet = wrapperNodeSet;
  }

  /** Check if a Lezer type name is a wrapper node */
  private isWrapper(typeName: string): boolean {
    return this.wrapperNodeSet.has(typeName);
  }

  /** Create an ASTNode, forwarding all context */
  private wrap(node: SyntaxNode): LezerASTNode {
    return new LezerASTNode(node, this.sourceProvider, this.meta, this.wrapperNodeSet);
  }

  // ========== Field Access (Primary API) ==========

  field(name: string): ASTNode | null {
    const originalType = this.type;
    const fieldDef = this.meta.fieldMap[originalType]?.[name];
    if (!fieldDef) return null;

    // Find the wrapper child by its unique type name
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return null;
    do {
      if (cursor.name === fieldDef.wrapperType) {
        const wrapperNode = cursor.node;
        // Return the wrapper's first child (the actual content)
        const innerCursor = wrapperNode.cursor();
        if (innerCursor.firstChild()) {
          return this.wrap(innerCursor.node);
        }
        // Wrapper has no children (e.g., wraps a string literal) — return wrapper itself
        return this.wrap(wrapperNode);
      }
    } while (cursor.nextSibling());
    return null;
  }

  fields(name: string): ASTNode[] {
    const originalType = this.type;
    const fieldDef = this.meta.fieldMap[originalType]?.[name];
    if (!fieldDef) return [];

    // Find ALL wrapper children matching the wrapper type
    const results: ASTNode[] = [];
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return results;
    do {
      if (cursor.name === fieldDef.wrapperType) {
        const wrapperNode = cursor.node;
        const innerCursor = wrapperNode.cursor();
        if (innerCursor.firstChild()) {
          results.push(this.wrap(innerCursor.node));
        } else {
          results.push(this.wrap(wrapperNode));
        }
      }
    } while (cursor.nextSibling());
    return results;
  }

  childForFieldName(name: string): ASTNode | null {
    return this.field(name);
  }

  hasChild(name: string): boolean {
    return this.field(name) !== null;
  }

  // ========== Identity ==========

  get id(): number {
    // Synthetic stable ID computed from position and type
    // Unique within a single parse tree
    return this.syntaxNode.from * 100003 + this.syntaxNode.to * 101 + this.syntaxNode.type.id;
  }

  get type(): string {
    const lezerName = this.syntaxNode.type.name;
    // Map PascalCase Lezer names back to snake_case
    return this.meta.nodeNameMap[lezerName] ?? lezerName;
  }

  get text(): string {
    const source = this.sourceProvider();
    return source.slice(this.syntaxNode.from, this.syntaxNode.to);
  }

  // ========== Classification ==========

  get isError(): boolean {
    return this.syntaxNode.type.isError;
  }

  get isMissing(): boolean {
    // Lezer doesn't have "missing" nodes like tree-sitter
    // A zero-width error node is the closest equivalent
    return this.syntaxNode.type.isError && this.syntaxNode.from === this.syntaxNode.to;
  }

  get isNamed(): boolean {
    // A node is "named" if its Lezer type name appears in the nodeNameMap
    // (i.e., it corresponds to a grammar rule or token definition)
    // Wrapper nodes are NOT named — they are transparent
    const name = this.syntaxNode.type.name;
    if (this.isWrapper(name)) return false;
    return name in this.meta.nodeNameMap;
  }

  // ========== Navigation ==========

  get parent(): ASTNode | null {
    // Skip wrapper parents — they are transparent
    let parent = this.syntaxNode.parent;
    while (parent && this.isWrapper(parent.type.name)) {
      parent = parent.parent;
    }
    if (!parent) return null;
    return this.wrap(parent);
  }

  get children(): ASTNode[] {
    const kids: ASTNode[] = [];
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return kids;
    do {
      if (this.isWrapper(cursor.name)) {
        // Splice in the wrapper's children instead of the wrapper itself
        const wrapperNode = cursor.node;
        const innerCursor = wrapperNode.cursor();
        if (innerCursor.firstChild()) {
          do {
            kids.push(this.wrap(innerCursor.node));
          } while (innerCursor.nextSibling());
        }
      } else {
        kids.push(this.wrap(cursor.node));
      }
    } while (cursor.nextSibling());
    return kids;
  }

  get namedChildren(): ASTNode[] {
    const kids: ASTNode[] = [];
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return kids;
    do {
      if (this.isWrapper(cursor.name)) {
        // Splice in the wrapper's named children
        const wrapperNode = cursor.node;
        const innerCursor = wrapperNode.cursor();
        if (innerCursor.firstChild()) {
          do {
            if (innerCursor.type.name in this.meta.nodeNameMap) {
              kids.push(this.wrap(innerCursor.node));
            }
          } while (innerCursor.nextSibling());
        }
      } else if (cursor.type.name in this.meta.nodeNameMap) {
        kids.push(this.wrap(cursor.node));
      }
    } while (cursor.nextSibling());
    return kids;
  }

  child(index: number): ASTNode | null {
    return this.children[index] ?? null;
  }

  namedChild(index: number): ASTNode | null {
    return this.namedChildren[index] ?? null;
  }

  get childCount(): number {
    return this.children.length;
  }

  get namedChildCount(): number {
    return this.namedChildren.length;
  }

  // ========== Position (LSP Format) ==========

  private offsetToPosition(offset: number): Position {
    const source = this.sourceProvider();
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset && i < source.length; i++) {
      if (source.charCodeAt(i) === 10) { // '\n'
        line++;
        character = 0;
      } else {
        character++;
      }
    }
    return { line, character };
  }

  get startPosition(): Position {
    return this.offsetToPosition(this.syntaxNode.from);
  }

  get endPosition(): Position {
    return this.offsetToPosition(this.syntaxNode.to);
  }

  get startIndex(): number {
    return this.syntaxNode.from;
  }

  get endIndex(): number {
    return this.syntaxNode.to;
  }

  // ========== Tree Walking ==========

  descendantForIndex(startIndex: number, _endIndex?: number): ASTNode {
    // Always use side=1 so resolveInner enters child nodes at their left boundary.
    // Lezer's side=0 stays at the parent when pos coincides with a child's start,
    // whereas tree-sitter's descendant_for_index always returns the deepest node.
    let node = this.syntaxNode.resolveInner(startIndex, 1);
    // If we landed on a wrapper node, descend into its inner content
    while (this.isWrapper(node.type.name)) {
      const child = node.firstChild;
      if (child) {
        node = child;
      } else {
        break; // Empty wrapper — stay here
      }
    }
    return this.wrap(node);
  }

  descendantForPosition(startPosition: Position, endPosition?: Position): ASTNode {
    const source = this.sourceProvider();
    const startOffset = this.positionToOffset(source, startPosition);
    const endOffset = endPosition ? this.positionToOffset(source, endPosition) : startOffset;
    return this.descendantForIndex(startOffset, endOffset);
  }

  descendantsOfType(
    types: string | string[],
    startPosition?: Position,
    endPosition?: Position,
  ): ASTNode[] {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    // Convert types to their PascalCase equivalents for Lezer matching
    const lezerTypes = new Set<string>();
    for (const t of typeSet) {
      const pascal = this.meta.reverseNameMap[t];
      if (pascal) lezerTypes.add(pascal);
      lezerTypes.add(t); // Also try the raw name
    }

    const source = this.sourceProvider();
    const startOffset = startPosition ? this.positionToOffset(source, startPosition) : this.syntaxNode.from;
    const endOffset = endPosition ? this.positionToOffset(source, endPosition) : this.syntaxNode.to;

    const results: ASTNode[] = [];
    const cursor = this.syntaxNode.cursor();
    walkCursor(cursor, (c) => {
      // Wrapper nodes are never returned — but we still descend into them
      if (c.from >= startOffset && c.to <= endOffset && lezerTypes.has(c.type.name)) {
        results.push(this.wrap(c.node));
      }
    });

    return results;
  }

  private positionToOffset(source: string, pos: Position): number {
    let line = 0;
    let i = 0;
    while (line < pos.line && i < source.length) {
      if (source.charCodeAt(i) === 10) line++;
      i++;
    }
    return i + pos.character;
  }

  // ========== Debugging ==========

  toString(): string {
    return `${this.type} [${this.startIndex}..${this.endIndex}]`;
  }

  toSExpression(): string {
    return buildSExpression(this);
  }
}

/**
 * Walk a cursor depth-first, calling the callback for each node
 */
function walkCursor(cursor: TreeCursor, callback: (cursor: TreeCursor) => void): void {
  callback(cursor);
  if (cursor.firstChild()) {
    do {
      walkCursor(cursor, callback);
    } while (cursor.nextSibling());
    cursor.parent();
  }
}

/**
 * Build an S-expression representation
 */
function buildSExpression(node: ASTNode): string {
  if (node.childCount === 0) {
    return `(${node.type})`;
  }
  const childExprs = node.namedChildren.map(c => buildSExpression(c)).join(' ');
  if (childExprs) {
    return `(${node.type} ${childExprs})`;
  }
  return `(${node.type})`;
}
