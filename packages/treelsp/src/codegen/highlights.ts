/**
 * Highlights codegen
 * Generates Tree-sitter highlights.scm from language definition
 */

import type { LanguageDefinition, RuleDefinition, RuleFn, RuleBuilder, SemanticRule } from '../definition/index.js';
import type { CompletionKind } from '../definition/lsp.js';

/**
 * Internal representation of rule nodes (shared with grammar.ts)
 */
type RuleNode =
  | { type: 'string'; value: string }
  | { type: 'regex'; value: RegExp }
  | { type: 'seq'; rules: RuleNode[] }
  | { type: 'choice'; rules: RuleNode[] }
  | { type: 'optional'; rule: RuleNode }
  | { type: 'repeat'; rule: RuleNode }
  | { type: 'repeat1'; rule: RuleNode }
  | { type: 'field'; name: string; rule: RuleNode }
  | { type: 'prec'; level: number; rule: RuleNode }
  | { type: 'prec.left'; level: number; rule: RuleNode }
  | { type: 'prec.right'; level: number; rule: RuleNode }
  | { type: 'prec.dynamic'; level: number; rule: RuleNode }
  | { type: 'token'; pattern: string | RegExp }
  | { type: 'token.immediate'; rule: RuleNode }
  | { type: 'alias'; rule: RuleNode; name: string }
  | { type: 'rule'; name: string };

/**
 * Builder that captures rule structure for highlights analysis
 */
class HighlightsBuilder<T extends string> {
  seq(...rules: RuleDefinition<T>[]): RuleNode {
    return { type: 'seq', rules: rules.map(r => this.normalize(r)) };
  }

  choice(...rules: RuleDefinition<T>[]): RuleNode {
    return { type: 'choice', rules: rules.map(r => this.normalize(r)) };
  }

  optional(rule: RuleDefinition<T>): RuleNode {
    return { type: 'optional', rule: this.normalize(rule) };
  }

  repeat(rule: RuleDefinition<T>): RuleNode {
    return { type: 'repeat', rule: this.normalize(rule) };
  }

  repeat1(rule: RuleDefinition<T>): RuleNode {
    return { type: 'repeat1', rule: this.normalize(rule) };
  }

  field(name: string, rule: RuleDefinition<T>): RuleNode {
    return { type: 'field', name, rule: this.normalize(rule) };
  }

  prec = Object.assign(
    (level: number, rule: RuleDefinition<T>): RuleNode => ({
      type: 'prec', level, rule: this.normalize(rule),
    }),
    {
      left: (level: number, rule: RuleDefinition<T>): RuleNode => ({
        type: 'prec.left', level, rule: this.normalize(rule),
      }),
      right: (level: number, rule: RuleDefinition<T>): RuleNode => ({
        type: 'prec.right', level, rule: this.normalize(rule),
      }),
      dynamic: (level: number, rule: RuleDefinition<T>): RuleNode => ({
        type: 'prec.dynamic', level, rule: this.normalize(rule),
      }),
    }
  );

  token = Object.assign(
    (pattern: string | RegExp): RuleNode => ({ type: 'token', pattern }),
    {
      immediate: (rule: RuleDefinition<T>): RuleNode => ({
        type: 'token.immediate', rule: this.normalize(rule),
      }),
    }
  );

  alias(rule: RuleDefinition<T>, name: string): RuleNode {
    return { type: 'alias', rule: this.normalize(rule), name };
  }

  rule(name: T): RuleNode {
    return { type: 'rule', name };
  }

  private normalize(rule: RuleDefinition<T>): RuleNode {
    if (typeof rule === 'string') return { type: 'string', value: rule };
    if (rule instanceof RegExp) return { type: 'regex', value: rule };
    if (typeof rule === 'function') {
      return rule(this as unknown as RuleBuilder<T>) as unknown as RuleNode;
    }
    return rule as unknown as RuleNode;
  }
}

/** Mapping from CompletionKind to highlight capture name */
const COMPLETION_KIND_TO_CAPTURE: Partial<Record<CompletionKind, string>> = {
  Variable: 'variable',
  Function: 'function',
  Method: 'function.method',
  Class: 'type',
  Interface: 'type',
  Module: 'module',
  Enum: 'type',
  Constant: 'constant',
  Property: 'property',
  Field: 'property',
  Constructor: 'constructor',
};

const BRACKETS = new Set(['(', ')', '{', '}', '[', ']']);
const DELIMITERS = new Set([';', ',', '.', ':']);

/**
 * Collect all string literals from a RuleNode tree
 */
function collectStrings(node: RuleNode, out: Set<string>): void {
  switch (node.type) {
    case 'string':
      out.add(node.value);
      break;
    case 'seq':
    case 'choice':
      for (const child of node.rules) {
        collectStrings(child, out);
      }
      break;
    case 'optional':
    case 'repeat':
    case 'repeat1':
    case 'token.immediate':
      collectStrings(node.rule, out);
      break;
    case 'field':
      collectStrings(node.rule, out);
      break;
    case 'prec':
    case 'prec.left':
    case 'prec.right':
    case 'prec.dynamic':
      collectStrings(node.rule, out);
      break;
    case 'alias':
      collectStrings(node.rule, out);
      break;
    // token, regex, rule — no string literals to extract
  }
}

/**
 * Check if a rule is a token rule (top-level token())
 */
function isTokenRule(node: RuleNode): boolean {
  return node.type === 'token';
}

/**
 * Find the rule name referenced inside a field node
 * Walks through prec/optional wrappers to find the rule reference
 */
function findFieldChildRule(node: RuleNode): string | null {
  switch (node.type) {
    case 'rule':
      return node.name;
    case 'optional':
    case 'repeat':
    case 'repeat1':
    case 'prec':
    case 'prec.left':
    case 'prec.right':
    case 'prec.dynamic':
    case 'token.immediate':
      return findFieldChildRule(node.rule);
    case 'alias':
      return node.name;
    default:
      return null;
  }
}

/**
 * Find the child rule name for a specific field in a rule's RuleNode tree
 */
function findFieldRuleName(node: RuleNode, fieldName: string): string | null {
  switch (node.type) {
    case 'field':
      if (node.name === fieldName) {
        return findFieldChildRule(node.rule);
      }
      return null;
    case 'seq':
    case 'choice':
      for (const child of node.rules) {
        const result = findFieldRuleName(child, fieldName);
        if (result) return result;
      }
      return null;
    case 'optional':
    case 'repeat':
    case 'repeat1':
    case 'token.immediate':
      return findFieldRuleName(node.rule, fieldName);
    case 'prec':
    case 'prec.left':
    case 'prec.right':
    case 'prec.dynamic':
      return findFieldRuleName(node.rule, fieldName);
    case 'alias':
      return findFieldRuleName(node.rule, fieldName);
    default:
      return null;
  }
}

/**
 * Classify a token rule by its name
 */
function classifyTokenRule(ruleName: string): string | null {
  const lower = ruleName.toLowerCase();
  if (lower.includes('comment')) return 'comment';
  if (lower.includes('string')) return 'string';
  if (lower.includes('number') || lower.includes('integer') || lower.includes('float')) return 'number';
  if (lower.includes('bool')) return 'boolean';
  return null;
}

/**
 * Generate Tree-sitter highlights.scm from language definition
 */
export function generateHighlights<T extends string>(
  definition: LanguageDefinition<T>
): string {
  const builder = new HighlightsBuilder<T>();

  // Build all rules
  const rules: Record<string, RuleNode> = {};
  for (const [name, ruleFn] of Object.entries(definition.grammar)) {
    rules[name] = (ruleFn as RuleFn<T>)(builder as unknown as RuleBuilder<T>) as unknown as RuleNode;
  }

  const semantic: Record<string, SemanticRule | undefined> = definition.semantic ?? {};
  const lsp = definition.lsp;
  const keywords = lsp?.$keywords;

  // 1. Collect all string literals from all rules
  const allStrings = new Set<string>();
  for (const ruleNode of Object.values(rules)) {
    collectStrings(ruleNode, allStrings);
  }

  // 2. Classify strings
  const keywordStrings: string[] = [];
  const operatorStrings: string[] = [];
  const bracketStrings: string[] = [];
  const delimiterStrings: string[] = [];

  for (const str of allStrings) {
    if (keywords && str in keywords) {
      keywordStrings.push(str);
    } else if (/^[a-zA-Z_]+$/.test(str)) {
      keywordStrings.push(str);
    } else if (BRACKETS.has(str)) {
      bracketStrings.push(str);
    } else if (DELIMITERS.has(str)) {
      delimiterStrings.push(str);
    } else {
      operatorStrings.push(str);
    }
  }

  // Sort for deterministic output
  keywordStrings.sort();
  operatorStrings.sort();
  bracketStrings.sort();
  delimiterStrings.sort();

  // 3. Declaration name captures
  const declarationCaptures: string[] = [];
  for (const [ruleName, semanticRule] of Object.entries(semantic)) {
    if (!semanticRule?.declares) continue;
    const fieldName = semanticRule.declares.field;

    // Find what rule the field wraps
    const ruleNode = rules[ruleName];
    if (!ruleNode) continue;
    const childRuleName = findFieldRuleName(ruleNode, fieldName);
    if (!childRuleName) continue;

    // Determine highlight capture from LSP completionKind
    let capture = 'variable'; // default
    const lspRule = lsp?.[ruleName as T];
    if (lspRule?.completionKind) {
      capture = COMPLETION_KIND_TO_CAPTURE[lspRule.completionKind] ?? 'variable';
    }

    declarationCaptures.push(`(${ruleName} ${fieldName}: (${childRuleName}) @${capture})`);
  }

  // 4. Token rule captures (number, string, comment, etc.)
  const literalCaptures: string[] = [];
  const identifierCaptures: string[] = [];
  for (const [ruleName, ruleNode] of Object.entries(rules)) {
    if (!isTokenRule(ruleNode)) continue;

    const tokenClass = classifyTokenRule(ruleName);
    if (tokenClass) {
      literalCaptures.push(`(${ruleName}) @${tokenClass}`);
    } else if (ruleName === definition.word) {
      // The word rule (identifier) goes last as fallback
      identifierCaptures.push(`(${ruleName}) @variable`);
    } else {
      // Other token rules without classification — check if it has semantic references
      const semRule = semantic[ruleName as T];
      if (semRule?.references) {
        identifierCaptures.push(`(${ruleName}) @variable`);
      }
    }
  }

  // 5. Build output
  const sections: string[] = [];

  sections.push(`; Syntax highlighting for ${definition.name}`);
  sections.push('; Generated by treelsp — do not edit');

  if (keywordStrings.length > 0) {
    sections.push('');
    sections.push('; Keywords');
    for (const kw of keywordStrings) {
      sections.push(`${JSON.stringify(kw)} @keyword`);
    }
  }

  if (operatorStrings.length > 0) {
    sections.push('');
    sections.push('; Operators');
    for (const op of operatorStrings) {
      sections.push(`${JSON.stringify(op)} @operator`);
    }
  }

  if (bracketStrings.length > 0) {
    sections.push('');
    sections.push('; Brackets');
    for (const br of bracketStrings) {
      sections.push(`${JSON.stringify(br)} @punctuation.bracket`);
    }
  }

  if (delimiterStrings.length > 0) {
    sections.push('');
    sections.push('; Delimiters');
    for (const dl of delimiterStrings) {
      sections.push(`${JSON.stringify(dl)} @punctuation.delimiter`);
    }
  }

  if (declarationCaptures.length > 0) {
    sections.push('');
    sections.push('; Declarations');
    for (const cap of declarationCaptures) {
      sections.push(cap);
    }
  }

  if (literalCaptures.length > 0) {
    sections.push('');
    sections.push('; Literals');
    for (const cap of literalCaptures) {
      sections.push(cap);
    }
  }

  if (identifierCaptures.length > 0) {
    sections.push('');
    sections.push('; Identifiers');
    for (const cap of identifierCaptures) {
      sections.push(cap);
    }
  }

  sections.push('');
  return sections.join('\n');
}
