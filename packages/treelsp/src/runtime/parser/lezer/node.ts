/**
 * Lezer ASTNode implementation
 * Provides the ASTNode interface over Lezer's SyntaxNode
 */

import type { SyntaxNode, TreeCursor } from '@lezer/common';
import type { ASTNode, Position, SourceProvider } from '../ast-node.js';
import type { ParserMeta, FieldDescriptor } from '../../../codegen/lezer/field-map.js';

/**
 * Lezer implementation of ASTNode
 *
 * Key differences from Tree-sitter:
 * - Field access uses a generated field map (Lezer has no native field names)
 * - Node IDs are synthetic (computed from position + type)
 * - Named/unnamed distinction uses the nodeNameMap from metadata
 * - PascalCase Lezer names are mapped back to snake_case
 */
export class LezerASTNode implements ASTNode {
  private readonly syntaxNode: SyntaxNode;
  private readonly sourceProvider: SourceProvider;
  private readonly meta: ParserMeta;

  constructor(syntaxNode: SyntaxNode, sourceProvider: SourceProvider, meta: ParserMeta) {
    this.syntaxNode = syntaxNode;
    this.sourceProvider = sourceProvider;
    this.meta = meta;
  }

  // ========== Field Access (Primary API) ==========

  field(name: string): ASTNode | null {
    const originalType = this.type;
    const fieldDef = this.meta.fieldMap[originalType]?.[name];
    if (!fieldDef) return null;
    return this.getChildByDescriptor(fieldDef);
  }

  fields(name: string): ASTNode[] {
    const originalType = this.type;
    const fieldDef = this.meta.fieldMap[originalType]?.[name];
    if (!fieldDef) return [];
    const child = this.getChildByDescriptor(fieldDef);
    return child ? [child] : [];
  }

  childForFieldName(name: string): ASTNode | null {
    return this.field(name);
  }

  hasChild(name: string): boolean {
    return this.field(name) !== null;
  }

  private getChildByDescriptor(desc: FieldDescriptor): ASTNode | null {
    // Find the Nth child of the given type
    let occurrence = 0;
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return null;

    do {
      if (cursor.name === desc.childType) {
        if (occurrence === desc.occurrence) {
          return new LezerASTNode(cursor.node, this.sourceProvider, this.meta);
        }
        occurrence++;
      }
    } while (cursor.nextSibling());

    return null;
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
    const name = this.syntaxNode.type.name;
    return name in this.meta.nodeNameMap;
  }

  // ========== Navigation ==========

  get parent(): ASTNode | null {
    const parent = this.syntaxNode.parent;
    if (!parent) return null;
    return new LezerASTNode(parent, this.sourceProvider, this.meta);
  }

  get children(): ASTNode[] {
    const kids: ASTNode[] = [];
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return kids;
    do {
      kids.push(new LezerASTNode(cursor.node, this.sourceProvider, this.meta));
    } while (cursor.nextSibling());
    return kids;
  }

  get namedChildren(): ASTNode[] {
    const kids: ASTNode[] = [];
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return kids;
    do {
      const name = cursor.type.name;
      if (name in this.meta.nodeNameMap) {
        kids.push(new LezerASTNode(cursor.node, this.sourceProvider, this.meta));
      }
    } while (cursor.nextSibling());
    return kids;
  }

  child(index: number): ASTNode | null {
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return null;
    let i = 0;
    do {
      if (i === index) {
        return new LezerASTNode(cursor.node, this.sourceProvider, this.meta);
      }
      i++;
    } while (cursor.nextSibling());
    return null;
  }

  namedChild(index: number): ASTNode | null {
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return null;
    let i = 0;
    do {
      if (cursor.type.name in this.meta.nodeNameMap) {
        if (i === index) {
          return new LezerASTNode(cursor.node, this.sourceProvider, this.meta);
        }
        i++;
      }
    } while (cursor.nextSibling());
    return null;
  }

  get childCount(): number {
    let count = 0;
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return 0;
    do { count++; } while (cursor.nextSibling());
    return count;
  }

  get namedChildCount(): number {
    let count = 0;
    const cursor = this.syntaxNode.cursor();
    if (!cursor.firstChild()) return 0;
    do {
      if (cursor.type.name in this.meta.nodeNameMap) count++;
    } while (cursor.nextSibling());
    return count;
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

  descendantForIndex(startIndex: number, endIndex?: number): ASTNode {
    const end = endIndex ?? startIndex;
    const node = this.syntaxNode.resolveInner(startIndex, end > startIndex ? 1 : 0);
    return new LezerASTNode(node, this.sourceProvider, this.meta);
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
      if (c.from >= startOffset && c.to <= endOffset && lezerTypes.has(c.type.name)) {
        results.push(new LezerASTNode(c.node, this.sourceProvider, this.meta));
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
