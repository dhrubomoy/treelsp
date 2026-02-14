/**
 * ASTNode wrapper
 * Provides friendly API over Tree-sitter SyntaxNode
 */

import type { SyntaxNode, Point } from 'web-tree-sitter';

/**
 * LSP-compatible position (0-based line and character)
 */
export interface Position {
  line: number;
  character: number;
}

/**
 * Source text provider for lazy text access
 * Avoids copying text from SyntaxNode which can be slow
 */
export type SourceProvider = () => string;

/**
 * AST node wrapper providing a friendly API over Tree-sitter's SyntaxNode
 *
 * This class matches the usage patterns from DESIGN.md:
 * - node.field('name') - access named fields
 * - node.fields('params') - access repeated fields
 * - node.field('type')?.text - optional chaining
 * - node.hasChild('export') - check field existence
 */
export class ASTNode {
  /**
   * Wrapped Tree-sitter SyntaxNode
   * Kept private to force API usage
   */
  private readonly syntaxNode: SyntaxNode;

  /**
   * Source text provider (optional - for efficient text access)
   * If not provided, uses syntaxNode.text which is slower
   */
  private readonly sourceProvider?: SourceProvider;

  constructor(syntaxNode: SyntaxNode, sourceProvider?: SourceProvider) {
    this.syntaxNode = syntaxNode;
    this.sourceProvider = sourceProvider;
  }

  /**
   * Internal accessor for other runtime modules
   * Not exported to user code
   */
  get [Symbol.for('treelsp.syntaxNode')](): SyntaxNode {
    return this.syntaxNode;
  }

  // ========== Field Access (Primary API) ==========

  /**
   * Get single child by field name
   * Returns null if field doesn't exist or has no value
   *
   * @example
   * ```typescript
   * const name = node.field('name');
   * if (name) {
   *   console.log(name.text);
   * }
   * ```
   */
  field(name: string): ASTNode | null {
    const child = this.syntaxNode.childForFieldName(name);
    if (!child) {
      return null;
    }
    return new ASTNode(child, this.sourceProvider);
  }

  /**
   * Get all children for a field (handles repeated fields)
   * Returns empty array if field doesn't exist
   *
   * @example
   * ```typescript
   * const params = node.fields('params');
   * for (const param of params) {
   *   console.log(param.field('name')?.text);
   * }
   * ```
   */
  fields(name: string): ASTNode[] {
    const children = this.syntaxNode.childrenForFieldName(name);
    return children.map(child => new ASTNode(child, this.sourceProvider));
  }

  /**
   * Alias for field() - matches Tree-sitter API
   * Provided for users familiar with Tree-sitter
   */
  childForFieldName(name: string): ASTNode | null {
    return this.field(name);
  }

  /**
   * Check if node has a child with given field name
   *
   * @example
   * ```typescript
   * const visibility = node.hasChild('export') ? 'public' : 'private';
   * ```
   */
  hasChild(name: string): boolean {
    return this.syntaxNode.childForFieldName(name) !== null;
  }

  // ========== Properties ==========

  /**
   * Node type from grammar (e.g., 'variable_decl', 'identifier')
   */
  get type(): string {
    return this.syntaxNode.type;
  }

  /**
   * Source text for this node
   * Uses sourceProvider if available for better performance
   */
  get text(): string {
    if (this.sourceProvider) {
      const source = this.sourceProvider();
      return source.slice(this.syntaxNode.startIndex, this.syntaxNode.endIndex);
    }
    return this.syntaxNode.text;
  }

  /**
   * Is this an error node? (parsing failed)
   */
  get isError(): boolean {
    return this.syntaxNode.isError || this.syntaxNode.hasError;
  }

  /**
   * Is this a missing node? (expected but not found)
   */
  get isMissing(): boolean {
    return this.syntaxNode.isMissing;
  }

  /**
   * Is this a named node? (appears in the grammar)
   */
  get isNamed(): boolean {
    return this.syntaxNode.isNamed;
  }

  // ========== Navigation ==========

  /**
   * Parent node (null for root)
   */
  get parent(): ASTNode | null {
    const parentNode = this.syntaxNode.parent;
    if (!parentNode) {
      return null;
    }
    return new ASTNode(parentNode, this.sourceProvider);
  }

  /**
   * All children (including unnamed nodes like punctuation)
   */
  get children(): ASTNode[] {
    return this.syntaxNode.children.map(
      child => new ASTNode(child, this.sourceProvider)
    );
  }

  /**
   * Named children only (grammar rules, not literals)
   */
  get namedChildren(): ASTNode[] {
    return this.syntaxNode.namedChildren.map(
      child => new ASTNode(child, this.sourceProvider)
    );
  }

  /**
   * Get child by index
   */
  child(index: number): ASTNode | null {
    const child = this.syntaxNode.child(index);
    if (!child) {
      return null;
    }
    return new ASTNode(child, this.sourceProvider);
  }

  /**
   * Get named child by index
   */
  namedChild(index: number): ASTNode | null {
    const child = this.syntaxNode.namedChild(index);
    if (!child) {
      return null;
    }
    return new ASTNode(child, this.sourceProvider);
  }

  /**
   * Number of children
   */
  get childCount(): number {
    return this.syntaxNode.childCount;
  }

  /**
   * Number of named children
   */
  get namedChildCount(): number {
    return this.syntaxNode.namedChildCount;
  }

  // ========== Position (LSP Format) ==========

  /**
   * Convert Tree-sitter Point to LSP Position
   */
  private toPosition(point: Point): Position {
    return {
      line: point.row,
      character: point.column,
    };
  }

  /**
   * Start position (LSP format: 0-based line and character)
   */
  get startPosition(): Position {
    return this.toPosition(this.syntaxNode.startPosition);
  }

  /**
   * End position (LSP format: 0-based line and character)
   */
  get endPosition(): Position {
    return this.toPosition(this.syntaxNode.endPosition);
  }

  /**
   * Start byte offset in source
   */
  get startIndex(): number {
    return this.syntaxNode.startIndex;
  }

  /**
   * End byte offset in source
   */
  get endIndex(): number {
    return this.syntaxNode.endIndex;
  }

  // ========== Tree Walking (Advanced) ==========

  /**
   * Find smallest descendant at byte offset
   */
  descendantForIndex(startIndex: number, endIndex?: number): ASTNode {
    const node = endIndex !== undefined
      ? this.syntaxNode.descendantForIndex(startIndex, endIndex)
      : this.syntaxNode.descendantForIndex(startIndex);
    return new ASTNode(node, this.sourceProvider);
  }

  /**
   * Find smallest descendant at position
   */
  descendantForPosition(startPosition: Position, endPosition?: Position): ASTNode {
    const start: Point = { row: startPosition.line, column: startPosition.character };
    const node = endPosition
      ? this.syntaxNode.descendantForPosition(
          start,
          { row: endPosition.line, column: endPosition.character }
        )
      : this.syntaxNode.descendantForPosition(start);
    return new ASTNode(node, this.sourceProvider);
  }

  /**
   * Get all descendants of specific type(s)
   *
   * @example
   * ```typescript
   * const vars = root.descendantsOfType('variable_decl');
   * const allRefs = root.descendantsOfType(['identifier', 'name_ref']);
   * ```
   */
  descendantsOfType(
    types: string | string[],
    startPosition?: Position,
    endPosition?: Position
  ): ASTNode[] {
    const start = startPosition
      ? { row: startPosition.line, column: startPosition.character }
      : undefined;
    const end = endPosition
      ? { row: endPosition.line, column: endPosition.character }
      : undefined;

    const nodes = this.syntaxNode.descendantsOfType(types, start, end);
    return nodes.map(node => new ASTNode(node, this.sourceProvider));
  }

  // ========== Debugging ==========

  /**
   * String representation (for debugging)
   */
  toString(): string {
    return this.syntaxNode.toString();
  }

  /**
   * Get S-expression representation of the syntax tree
   */
  toSExpression(): string {
    return this.syntaxNode.toString();
  }
}
