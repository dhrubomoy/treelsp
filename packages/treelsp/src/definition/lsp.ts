/**
 * LSP definition layer
 * Describes editor behavior - hover, completion, symbols, signature help
 */

/**
 * LSP completion kinds (subset of LSP CompletionItemKind)
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
 * LSP symbol kinds (subset of LSP SymbolKind)
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
 * LspContext - provided to LSP handlers
 */
export interface LspContext {
  resolve(node: any): any;
  typeOf(node: any): any;
  scopeOf(node: any): any;
  document: any;
  workspace: any;
}

/**
 * Hover handler
 */
export type HoverHandler = (node: any, ctx: LspContext) => string | null | undefined;

/**
 * Completion item
 */
export interface CompletionItem {
  label: string;
  kind?: CompletionKind;
  detail?: string;
  documentation?: string;
  insertText?: string;
}

/**
 * Completion handler
 */
export type CompletionHandler = (node: any, ctx: LspContext) => CompletionItem[] | {
  items: CompletionItem[];
  replace?: boolean; // Don't merge with scope-based defaults
};

/**
 * Symbol descriptor
 */
export interface SymbolDescriptor {
  kind: SymbolKind;
  label: string | ((node: any) => string);
  detail?: string | ((node: any) => string);
}

/**
 * Signature parameter
 */
export interface SignatureParameter {
  label: string;
  documentation?: string;
}

/**
 * Signature help descriptor
 */
export interface SignatureDescriptor {
  trigger: string[];
  label: string | ((node: any) => string);
  params: (node: any) => SignatureParameter[];
  activeParam: (node: any, index: number) => number;
}

/**
 * Standard LSP semantic token types
 */
export type SemanticTokenType =
  | 'namespace' | 'type' | 'class' | 'enum' | 'interface' | 'struct'
  | 'typeParameter' | 'parameter' | 'variable' | 'property' | 'enumMember'
  | 'event' | 'function' | 'method' | 'macro' | 'keyword' | 'modifier'
  | 'comment' | 'string' | 'number' | 'regexp' | 'operator' | 'decorator';

/**
 * Standard LSP semantic token modifiers
 */
export type SemanticTokenModifier =
  | 'declaration' | 'definition' | 'readonly' | 'static' | 'deprecated'
  | 'abstract' | 'async' | 'modification' | 'documentation' | 'defaultLibrary';

/**
 * Detailed semantic token descriptor with type and modifiers
 */
export interface SemanticTokenDescriptor {
  type?: SemanticTokenType;
  modifiers?: SemanticTokenModifier[];
}

/**
 * LSP rule definition
 */
export interface LspRule {
  completionKind?: CompletionKind;
  symbol?: SymbolDescriptor;
  hover?: HoverHandler;
  complete?: CompletionHandler;
  signature?: SignatureDescriptor;
  semanticToken?: SemanticTokenType | SemanticTokenDescriptor;
}

/**
 * Keyword descriptor
 */
export interface KeywordDescriptor {
  detail?: string;
  documentation?: string;
}

/**
 * LSP definition - maps rule names to LSP descriptors
 */
export type LspDefinition<T extends string = string> = {
  [K in T]?: LspRule;
} & {
  $keywords?: Record<string, KeywordDescriptor>;
  $unresolved?: (node: any, ctx: LspContext) => string;
};
