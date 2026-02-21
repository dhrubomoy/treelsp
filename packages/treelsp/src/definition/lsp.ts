/**
 * LSP definition layer
 * Describes editor behavior — hover, completion, symbols, signature help, semantic tokens
 */

/**
 * Completion item icon in the editor autocomplete menu.
 * Maps to LSP `CompletionItemKind`. Used in `completionKind` on semantic
 * declarations and in custom `CompletionItem.kind`.
 */
export type CompletionKind =
  | 'Text'
  | 'Method'
  | 'Function'
  | 'Constructor'
  | 'Field'
  | 'Variable'
  | 'Class'
  | 'Interface'
  | 'Module'
  | 'Property'
  | 'Enum'
  | 'Keyword'
  | 'Snippet'
  | 'Constant';

/**
 * Symbol icon in the editor outline and breadcrumbs.
 * Maps to LSP `SymbolKind`. Used in `SymbolDescriptor.kind`.
 */
export type SymbolKind =
  | 'File'
  | 'Module'
  | 'Namespace'
  | 'Package'
  | 'Class'
  | 'Method'
  | 'Property'
  | 'Field'
  | 'Constructor'
  | 'Enum'
  | 'Interface'
  | 'Function'
  | 'Variable'
  | 'Constant'
  | 'String'
  | 'Number'
  | 'Boolean'
  | 'Array';

/**
 * Context object passed to LSP handler functions (hover, completion, etc.).
 * Provides access to scope resolution and the current document/workspace.
 */
export interface LspContext {
  /** Resolve a reference node to its declaration node, or `null` if unresolved */
  resolve(node: any): any;
  /** Get the scope that contains a node */
  scopeOf(node: any): any;
  /** The current document state */
  document: any;
  /** The workspace for cross-file lookups */
  workspace: any;
}

/**
 * Custom hover handler. Return a markdown string to show on hover, or `null` to skip.
 */
export type HoverHandler = (node: any, ctx: LspContext) => string | null | undefined;

/**
 * A single item in the completion list.
 */
export interface CompletionItem {
  /** Display text shown in the completion menu */
  label: string;
  /** Icon kind (e.g., `'Variable'`, `'Function'`) */
  kind?: CompletionKind;
  /** Short description shown next to the label */
  detail?: string;
  /** Longer documentation shown in the detail panel */
  documentation?: string;
  /** Text to insert when selected (defaults to `label`) */
  insertText?: string;
}

/**
 * Custom completion handler. Return an array of items, or an object with
 * `replace: true` to suppress the default scope-based completions.
 */
export type CompletionHandler = (node: any, ctx: LspContext) => CompletionItem[] | {
  items: CompletionItem[];
  replace?: boolean; // Don't merge with scope-based defaults
};

/**
 * Describes how a rule appears in the document outline (Cmd+Shift+O).
 *
 * @example
 * ```ts
 * lsp: {
 *   function_def: {
 *     symbol: { kind: 'Function', label: node => node.field('name')?.text ?? '?' },
 *   },
 * }
 * ```
 */
export interface SymbolDescriptor {
  /** Symbol icon kind in the outline */
  kind: SymbolKind;
  /** Display name — a string or a function that extracts it from the AST node */
  label: string | ((node: any) => string);
  /** Optional detail text shown after the label */
  detail?: string | ((node: any) => string);
}

/**
 * A single parameter in a signature help tooltip.
 */
export interface SignatureParameter {
  /** Parameter label (e.g., `"x: number"`) */
  label: string;
  /** Optional documentation for this parameter */
  documentation?: string;
}

/**
 * Describes signature help for a callable construct (function calls, etc.).
 *
 * @example
 * ```ts
 * lsp: {
 *   call_expr: {
 *     signature: {
 *       trigger: ['(', ','],
 *       label: node => `${node.field('name')?.text}(...)`,
 *       params: node => [{ label: 'arg1' }, { label: 'arg2' }],
 *       activeParam: (node, index) => index,
 *     },
 *   },
 * }
 * ```
 */
export interface SignatureDescriptor {
  /** Characters that trigger signature help (e.g., `['(', ',']`) */
  trigger: string[];
  /** Signature label shown in the tooltip */
  label: string | ((node: any) => string);
  /** Function that returns the parameter list for this call */
  params: (node: any) => SignatureParameter[];
  /** Function that returns the active (highlighted) parameter index */
  activeParam: (node: any, index: number) => number;
}

/**
 * Standard LSP semantic token types for syntax highlighting.
 * Used in `LspRule.semanticToken` to override the default token classification.
 */
export type SemanticTokenType =
  | 'namespace' | 'type' | 'class' | 'enum' | 'interface' | 'struct'
  | 'typeParameter' | 'parameter' | 'variable' | 'property' | 'enumMember'
  | 'event' | 'function' | 'method' | 'macro' | 'keyword' | 'modifier'
  | 'comment' | 'string' | 'number' | 'regexp' | 'operator' | 'decorator';

/**
 * Semantic token modifiers that refine a token type (e.g., declaration vs reference).
 */
export type SemanticTokenModifier =
  | 'declaration' | 'definition' | 'readonly' | 'static' | 'deprecated'
  | 'abstract' | 'async' | 'modification' | 'documentation' | 'defaultLibrary';

/**
 * Detailed semantic token descriptor with explicit type and modifiers.
 * Use this form when you need modifiers; use a plain `SemanticTokenType` string for simple cases.
 */
export interface SemanticTokenDescriptor {
  type?: SemanticTokenType;
  modifiers?: SemanticTokenModifier[];
}

/**
 * Editor features for a single grammar rule.
 *
 * @example
 * ```ts
 * lsp: {
 *   variable_decl: {
 *     completionKind: 'Variable',
 *     symbol: { kind: 'Variable', label: node => node.field('name')?.text ?? '?' },
 *     hover: (node, ctx) => `Variable: ${node.field('name')?.text}`,
 *   },
 * }
 * ```
 */
export interface LspRule {
  /** Icon for this declaration in autocomplete (auto-generates completions from scope) */
  completionKind?: CompletionKind;
  /** Document outline entry for this rule */
  symbol?: SymbolDescriptor;
  /** Custom hover tooltip */
  hover?: HoverHandler;
  /** Custom completion items */
  complete?: CompletionHandler;
  /** Characters that trigger completion for this rule */
  completionTrigger?: string[];
  /** Signature help for callable constructs */
  signature?: SignatureDescriptor;
  /** Override semantic token classification for this rule */
  semanticToken?: SemanticTokenType | SemanticTokenDescriptor;
}

/**
 * Metadata for keyword completion items.
 */
export interface KeywordDescriptor {
  /** Short description shown next to the keyword */
  detail?: string;
  /** Longer documentation for the keyword */
  documentation?: string;
}

/**
 * Maps grammar rule names to their editor features (hover, completion, symbols, etc.).
 *
 * Special keys:
 * - `$keywords` — Metadata for keyword completions (extracted from string literals in the grammar)
 * - `$unresolved` — Custom error message when a reference cannot be resolved
 */
export type LspDefinition<T extends string = string> = {
  [K in T]?: LspRule;
} & {
  $keywords?: Record<string, KeywordDescriptor>;
  $unresolved?: (node: any, ctx: LspContext) => string;
};
