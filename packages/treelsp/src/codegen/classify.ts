/**
 * Shared classification utilities for grammar analysis
 * Used by both Tree-sitter highlights codegen and TextMate grammar codegen
 */

import type { RuleDefinition, RuleFn, RuleBuilder } from '../definition/index.js';
import { createBuilderProxy } from '../definition/grammar.js';

/**
 * Internal representation of rule nodes (shared across codegen modules)
 */
export type RuleNode =
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
 * Builder that captures rule structure for analysis
 */
export class RuleNodeBuilder<T extends string> {
  _proxy: RuleBuilder<T> | null = null;
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

  prec: ((level: number, rule: RuleDefinition<T>) => RuleNode) & {
    left: (level: number, rule: RuleDefinition<T>) => RuleNode;
    right: (level: number, rule: RuleDefinition<T>) => RuleNode;
    dynamic: (level: number, rule: RuleDefinition<T>) => RuleNode;
  } = Object.assign(
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

  token: ((pattern: string | RegExp) => RuleNode) & {
    immediate: (rule: RuleDefinition<T>) => RuleNode;
  } = Object.assign(
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

  normalize(rule: RuleDefinition<T>): RuleNode {
    if (typeof rule === 'string') return { type: 'string', value: rule };
    if (rule instanceof RegExp) return { type: 'regex', value: rule };
    if (typeof rule === 'function') {
      const r = this._proxy ?? (this as unknown as RuleBuilder<T>);
      return rule(r) as unknown as RuleNode;
    }
    return rule as unknown as RuleNode;
  }
}

export const BRACKETS: Set<string> = new Set(['(', ')', '{', '}', '[', ']']);
export const DELIMITERS: Set<string> = new Set([';', ',', '.', ':']);

/**
 * Collect all string literals from a RuleNode tree
 */
export function collectStrings(node: RuleNode, out: Set<string>): void {
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
export function isTokenRule(node: RuleNode): boolean {
  return node.type === 'token';
}

/**
 * Classify a token rule by its name (heuristic)
 */
export function classifyTokenRule(ruleName: string): string | null {
  const lower = ruleName.toLowerCase();
  if (lower.includes('comment')) return 'comment';
  if (lower.includes('string')) return 'string';
  if (lower.includes('number') || lower.includes('integer') || lower.includes('float')) return 'number';
  if (lower.includes('bool')) return 'boolean';
  return null;
}

/**
 * Build all rules from a grammar definition into RuleNode trees
 */
export function buildRuleNodes<T extends string>(
  grammar: Record<string, RuleFn<T>>,
): { builder: RuleNodeBuilder<T>; rules: Record<string, RuleNode> } {
  const rawBuilder = new RuleNodeBuilder<T>();
  const builder = createBuilderProxy<T>(rawBuilder);
  const rules: Record<string, RuleNode> = {};
  for (const [name, ruleFn] of Object.entries(grammar)) {
    const raw: unknown = ruleFn(builder);
    rules[name] = raw as RuleNode;
  }
  return { builder: rawBuilder, rules };
}

/**
 * Classify all string literals from grammar rules into categories
 */
export function classifyStrings(
  rules: Record<string, RuleNode>,
  lspKeywords?: Record<string, unknown>,
): {
  keywords: string[];
  operators: string[];
  brackets: string[];
  delimiters: string[];
} {
  const allStrings = new Set<string>();
  for (const ruleNode of Object.values(rules)) {
    collectStrings(ruleNode, allStrings);
  }

  const keywords: string[] = [];
  const operators: string[] = [];
  const brackets: string[] = [];
  const delimiters: string[] = [];

  for (const str of allStrings) {
    if (lspKeywords && str in lspKeywords) {
      keywords.push(str);
    } else if (/^[a-zA-Z_]+$/.test(str)) {
      keywords.push(str);
    } else if (BRACKETS.has(str)) {
      brackets.push(str);
    } else if (DELIMITERS.has(str)) {
      delimiters.push(str);
    } else {
      operators.push(str);
    }
  }

  keywords.sort();
  operators.sort();
  brackets.sort();
  delimiters.sort();

  return { keywords, operators, brackets, delimiters };
}
