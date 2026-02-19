/**
 * Semantic tokens provider
 * Classifies AST nodes into LSP semantic token types for syntax highlighting
 */

import type { ASTNode } from '../parser/node.js';
import type { DocumentState } from '../parser/tree.js';
import type { DocumentScope } from '../scope/resolver.js';
import type { SemanticDefinition } from '../../definition/semantic.js';
import type { LspDefinition, LspRule, CompletionKind } from '../../definition/lsp.js';

/**
 * Standard LSP semantic token types
 * Index in this array = tokenType value in the encoded data
 */
export const SEMANTIC_TOKEN_TYPES = [
  'namespace',     // 0
  'type',          // 1
  'class',         // 2
  'enum',          // 3
  'interface',     // 4
  'struct',        // 5
  'typeParameter', // 6
  'parameter',     // 7
  'variable',      // 8
  'property',      // 9
  'enumMember',    // 10
  'event',         // 11
  'function',      // 12
  'method',        // 13
  'macro',         // 14
  'keyword',       // 15
  'modifier',      // 16
  'comment',       // 17
  'string',        // 18
  'number',        // 19
  'regexp',        // 20
  'operator',      // 21
  'decorator',     // 22
] as const;

/**
 * Standard LSP semantic token modifiers
 * Encoded as bit flags: modifier at index N has value 2^N
 */
export const SEMANTIC_TOKEN_MODIFIERS = [
  'declaration',    // bit 0
  'definition',     // bit 1
  'readonly',       // bit 2
  'static',         // bit 3
  'deprecated',     // bit 4
  'abstract',       // bit 5
  'async',          // bit 6
  'modification',   // bit 7
  'documentation',  // bit 8
  'defaultLibrary', // bit 9
] as const;

/** Index lookup for token types */
const TOKEN_TYPE_INDEX: Record<string, number> = {};
for (let i = 0; i < SEMANTIC_TOKEN_TYPES.length; i++) {
  TOKEN_TYPE_INDEX[SEMANTIC_TOKEN_TYPES[i]!] = i;
}

/** Mapping from CompletionKind to semantic token type name */
const COMPLETION_KIND_TO_TOKEN_TYPE: Partial<Record<CompletionKind, string>> = {
  Variable: 'variable',
  Function: 'function',
  Method: 'method',
  Class: 'class',
  Interface: 'interface',
  Module: 'namespace',
  Enum: 'enum',
  Constant: 'variable',
  Property: 'property',
  Field: 'property',
  Constructor: 'function',
};

/** Index lookup for modifier names → bit position */
const MODIFIER_BIT: Record<string, number> = {};
for (let i = 0; i < SEMANTIC_TOKEN_MODIFIERS.length; i++) {
  MODIFIER_BIT[SEMANTIC_TOKEN_MODIFIERS[i]!] = i;
}

/**
 * Resolve token type index and modifier bitmask from an LspRule.
 * `semanticToken` takes precedence over `completionKind`.
 */
function resolveTokenInfo(lspRule: LspRule | undefined): { typeIndex: number; modifiers: number } {
  const defaultTypeIndex = TOKEN_TYPE_INDEX['variable']!;
  if (!lspRule) return { typeIndex: defaultTypeIndex, modifiers: 0 };

  const st = lspRule.semanticToken;

  let typeName: string | undefined;
  let modifiers = 0;

  if (typeof st === 'string') {
    // String shorthand — token type only
    typeName = st;
  } else if (st !== undefined) {
    // Object form — type and/or modifiers
    typeName = st.type;
    if (st.modifiers) {
      for (const mod of st.modifiers) {
        const bit = MODIFIER_BIT[mod];
        if (bit !== undefined) {
          modifiers |= 1 << bit;
        }
      }
    }
  }

  // If semanticToken didn't set a type, fall back to completionKind mapping
  if (!typeName) {
    const kind = lspRule.completionKind;
    typeName = kind ? (COMPLETION_KIND_TO_TOKEN_TYPE[kind] ?? 'variable') : 'variable';
  }

  const typeIndex = TOKEN_TYPE_INDEX[typeName] ?? defaultTypeIndex;
  return { typeIndex, modifiers };
}

const BRACKETS = new Set(['(', ')', '{', '}', '[', ']']);
const DELIMITERS = new Set([';', ',', '.', ':']);

/**
 * Result of semantic tokens computation
 */
export interface SemanticTokensResult {
  data: number[];
}

/**
 * A single token before delta encoding
 */
interface RawToken {
  line: number;
  character: number;
  length: number;
  tokenType: number;
  modifiers: number;
}

/**
 * Classify a named token rule by its name (heuristic)
 */
function classifyTokenRuleName(ruleName: string): string | null {
  const lower = ruleName.toLowerCase();
  if (lower.includes('comment')) return 'comment';
  if (lower.includes('string')) return 'string';
  if (lower.includes('number') || lower.includes('integer') || lower.includes('float')) return 'number';
  if (lower.includes('bool')) return 'boolean';
  return null;
}

/**
 * Compute semantic tokens for a full document
 *
 * Walks the AST and classifies each leaf node into an LSP semantic token type.
 * Uses the semantic and LSP definitions to determine token types for
 * declarations and references. Falls back to heuristics for other tokens.
 */
export function provideSemanticTokensFull(
  document: DocumentState,
  docScope: DocumentScope,
  semantic: SemanticDefinition,
  lsp?: LspDefinition,
): SemanticTokensResult {
  const tokens: RawToken[] = [];

  // Build maps for declaration and reference node IDs → token type + modifiers
  // Declaration nodes get the completionKind/semanticToken of their declaring rule
  const declNodeTokenInfo = new Map<number, { typeIndex: number; modifiers: number }>();
  const refNodeTokenInfo = new Map<number, { typeIndex: number; modifiers: number }>();

  for (const decl of docScope.declarations) {
    const lspRule = lsp?.[decl.declaredBy];
    const info = resolveTokenInfo(lspRule);
    declNodeTokenInfo.set(decl.node.id, info);
  }

  for (const ref of docScope.references) {
    if (ref.resolved) {
      const lspRule = lsp?.[ref.resolved.declaredBy];
      const info = resolveTokenInfo(lspRule);
      refNodeTokenInfo.set(ref.node.id, info);
    }
  }

  // Walk the tree depth-first, visiting all children (including anonymous)
  walkForTokens(document.root, tokens, declNodeTokenInfo, refNodeTokenInfo, semantic);

  // Sort by position (line, then character)
  tokens.sort((a, b) => a.line - b.line || a.character - b.character);

  // Delta-encode
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const token of tokens) {
    const deltaLine = token.line - prevLine;
    const deltaChar = deltaLine === 0 ? token.character - prevChar : token.character;
    data.push(deltaLine, deltaChar, token.length, token.tokenType, token.modifiers);
    prevLine = token.line;
    prevChar = token.character;
  }

  return { data };
}

/** Token info stored in node maps */
interface TokenInfo {
  typeIndex: number;
  modifiers: number;
}

/**
 * Walk the AST to collect semantic tokens
 */
function walkForTokens(
  node: ASTNode,
  tokens: RawToken[],
  declNodeTokenInfo: Map<number, TokenInfo>,
  refNodeTokenInfo: Map<number, TokenInfo>,
  semantic: SemanticDefinition,
): void {
  // Check if this is a leaf node (no children at all)
  if (node.childCount === 0) {
    const token = classifyLeaf(node, declNodeTokenInfo, refNodeTokenInfo, semantic);
    if (token) {
      tokens.push(token);
    }
    return;
  }

  // For named nodes with semantic declares, check if the name field child
  // should be classified. The scope resolver already tracked these in declarations.
  // We handle this via the declNodeTokenInfo map on leaf nodes.

  // Recurse into all children (including anonymous)
  for (const child of node.children) {
    walkForTokens(child, tokens, declNodeTokenInfo, refNodeTokenInfo, semantic);
  }
}

/**
 * Classify a leaf node into a semantic token
 */
function classifyLeaf(
  node: ASTNode,
  declNodeTokenInfo: Map<number, TokenInfo>,
  refNodeTokenInfo: Map<number, TokenInfo>,
  semantic: SemanticDefinition,
): RawToken | null {
  const start = node.startPosition;
  const length = node.endIndex - node.startIndex;
  if (length <= 0) return null;

  // 1. Check if it's a declaration name
  const declInfo = declNodeTokenInfo.get(node.id);
  if (declInfo !== undefined) {
    return {
      line: start.line,
      character: start.character,
      length,
      tokenType: declInfo.typeIndex,
      modifiers: declInfo.modifiers | 1, // OR in bit 0 = 'declaration'
    };
  }

  // 2. Check if it's a reference
  const refInfo = refNodeTokenInfo.get(node.id);
  if (refInfo !== undefined) {
    return {
      line: start.line,
      character: start.character,
      length,
      tokenType: refInfo.typeIndex,
      modifiers: refInfo.modifiers,
    };
  }

  // 3. Anonymous nodes (keywords, operators, punctuation)
  if (!node.isNamed) {
    const text = node.text;
    if (/^[a-zA-Z_]+$/.test(text)) {
      // Alphabetic → keyword
      return {
        line: start.line,
        character: start.character,
        length,
        tokenType: TOKEN_TYPE_INDEX['keyword']!,
        modifiers: 0,
      };
    }
    if (BRACKETS.has(text) || DELIMITERS.has(text)) {
      // Punctuation — don't emit semantic tokens for these,
      // they're too noisy and VS Code themes handle them via TextMate
      return null;
    }
    // Operators
    return {
      line: start.line,
      character: start.character,
      length,
      tokenType: TOKEN_TYPE_INDEX['operator']!,
      modifiers: 0,
    };
  }

  // 4. Named leaf tokens — classify by rule name
  const tokenClass = classifyTokenRuleName(node.type);
  if (tokenClass) {
    const typeIndex = TOKEN_TYPE_INDEX[tokenClass];
    if (typeIndex !== undefined) {
      return {
        line: start.line,
        character: start.character,
        length,
        tokenType: typeIndex,
        modifiers: 0,
      };
    }
  }

  // 5. Named leaf with semantic references (unresolved) — still a variable
  const semRule = semantic[node.type];
  if (semRule?.references) {
    return {
      line: start.line,
      character: start.character,
      length,
      tokenType: TOKEN_TYPE_INDEX['variable']!,
      modifiers: 0,
    };
  }

  // 6. Unknown leaf — skip
  return null;
}
