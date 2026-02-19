/**
 * ASTNode interface
 *
 * Abstract syntax tree node contract that all parser backends must implement.
 * LSP handlers, scope resolution, and all other runtime modules depend only
 * on this interface — never on a specific parser backend.
 */

/**
 * LSP-compatible position (0-based line and character)
 */
export interface Position {
  line: number;
  character: number;
}

/**
 * Source text provider for lazy text access
 */
export type SourceProvider = () => string;

/**
 * Abstract AST node interface
 *
 * Usage patterns:
 * - node.field('name') — access named fields
 * - node.fields('params') — access repeated fields
 * - node.field('type')?.text — optional chaining
 * - node.hasChild('export') — check field existence
 */
export interface ASTNode {
  // ========== Field Access (Primary API) ==========

  /** Get single child by field name. Returns null if not found. */
  field(name: string): ASTNode | null;

  /** Get all children for a field (handles repeated fields). */
  fields(name: string): ASTNode[];

  /** Alias for field() — matches Tree-sitter API naming. */
  childForFieldName(name: string): ASTNode | null;

  /** Check if node has a child with given field name. */
  hasChild(name: string): boolean;

  // ========== Identity ==========

  /**
   * Stable node identity.
   * Safe to use as Map key — same tree node always returns same id.
   */
  readonly id: number;

  /** Node type from grammar (e.g., 'variable_decl', 'identifier'). */
  readonly type: string;

  /** Source text for this node. */
  readonly text: string;

  // ========== Classification ==========

  /** Is this an error node? (parsing failed) */
  readonly isError: boolean;

  /** Is this a missing node? (expected but not found) */
  readonly isMissing: boolean;

  /** Is this a named node? (appears in the grammar) */
  readonly isNamed: boolean;

  // ========== Navigation ==========

  /** Parent node (null for root). */
  readonly parent: ASTNode | null;

  /** All children (including unnamed nodes like punctuation). */
  readonly children: ASTNode[];

  /** Named children only (grammar rules, not literals). */
  readonly namedChildren: ASTNode[];

  /** Get child by index. */
  child(index: number): ASTNode | null;

  /** Get named child by index. */
  namedChild(index: number): ASTNode | null;

  /** Number of children. */
  readonly childCount: number;

  /** Number of named children. */
  readonly namedChildCount: number;

  // ========== Position (LSP Format) ==========

  /** Start position (0-based line and character). */
  readonly startPosition: Position;

  /** End position (0-based line and character). */
  readonly endPosition: Position;

  /** Start byte offset in source. */
  readonly startIndex: number;

  /** End byte offset in source. */
  readonly endIndex: number;

  // ========== Tree Walking ==========

  /** Find smallest descendant at byte offset. */
  descendantForIndex(startIndex: number, endIndex?: number): ASTNode;

  /** Find smallest descendant at position. */
  descendantForPosition(startPosition: Position, endPosition?: Position): ASTNode;

  /** Get all descendants of specific type(s). */
  descendantsOfType(
    types: string | string[],
    startPosition?: Position,
    endPosition?: Position,
  ): ASTNode[];

  // ========== Debugging ==========

  /** String representation. */
  toString(): string;

  /** S-expression representation of the syntax tree. */
  toSExpression(): string;
}
