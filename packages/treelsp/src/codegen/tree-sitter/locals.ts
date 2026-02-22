/**
 * Locals codegen
 * Generates Tree-sitter locals.scm from language definition
 */

import type { LanguageDefinition, RuleDefinition, RuleFn, RuleBuilder, SemanticRule } from '../../definition/index.js';
import { createBuilderProxy } from '../../definition/grammar.js';

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
 * Builder that captures rule structure for locals analysis
 */
class LocalsBuilder<T extends string> {
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
      const r = this._proxy ?? (this as unknown as RuleBuilder<T>);
      return rule(r) as unknown as RuleNode;
    }
    return rule as unknown as RuleNode;
  }
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
 * Check if a rule is a leaf token (defined as r.token(...))
 */
function isTokenRule(node: RuleNode): boolean {
  return node.type === 'token';
}

/**
 * Generate Tree-sitter locals.scm from language definition
 */
export function generateLocals<T extends string>(
  definition: LanguageDefinition<T>
): string {
  const builder = createBuilderProxy<T>(new LocalsBuilder<T>());

  // Build all rules
  const rules: Record<string, RuleNode> = {};
  for (const [name, ruleFn] of Object.entries(definition.grammar)) {
    rules[name] = (ruleFn as RuleFn<T>)(builder) as unknown as RuleNode;
  }

  const semantic: Record<string, SemanticRule | undefined> = definition.semantic ?? {};

  // 1. Scope entries — rules with scope defined
  const scopeEntries: string[] = [];
  for (const [ruleName, semanticRule] of Object.entries(semantic)) {
    if (semanticRule?.scope) {
      scopeEntries.push(`(${ruleName}) @local.scope`);
    }
  }

  // 2. Definition entries — rules with declares
  const definitionEntries: string[] = [];
  for (const [ruleName, semanticRule] of Object.entries(semantic)) {
    if (!semanticRule?.declares) continue;
    const fieldName = semanticRule.declares.field;

    // Find the child rule name for the field
    const ruleNode = rules[ruleName];
    if (!ruleNode) continue;
    const childRuleName = findFieldRuleName(ruleNode, fieldName);
    if (childRuleName) {
      definitionEntries.push(`(${ruleName} ${fieldName}: (${childRuleName}) @local.definition)`);
    }
  }

  // 3. Reference entries — rules with references
  // For leaf token rules, emit bare pattern; for compound rules, emit with field
  const referenceEntries: string[] = [];
  for (const [ruleName, semanticRule] of Object.entries(semantic)) {
    if (!semanticRule?.references) continue;

    const ruleNode = rules[ruleName];
    if (!ruleNode) continue;

    if (isTokenRule(ruleNode)) {
      // Leaf token (like identifier) — emit bare pattern
      referenceEntries.push(`(${ruleName}) @local.reference`);
    } else {
      // Compound rule — emit with field
      const fieldName = semanticRule.references.field;
      const childRuleName = findFieldRuleName(ruleNode, fieldName);
      if (childRuleName) {
        referenceEntries.push(`(${ruleName} ${fieldName}: (${childRuleName}) @local.reference)`);
      } else {
        // Fallback: emit bare pattern
        referenceEntries.push(`(${ruleName}) @local.reference`);
      }
    }
  }

  // Build output
  const sections: string[] = [];

  sections.push(`; Scope queries for ${definition.name}`);
  sections.push('; Generated by treelsp — do not edit');

  if (scopeEntries.length > 0) {
    sections.push('');
    sections.push('; Scopes');
    for (const entry of scopeEntries) {
      sections.push(entry);
    }
  }

  if (definitionEntries.length > 0) {
    sections.push('');
    sections.push('; Definitions');
    for (const entry of definitionEntries) {
      sections.push(entry);
    }
  }

  if (referenceEntries.length > 0) {
    sections.push('');
    sections.push('; References');
    for (const entry of referenceEntries) {
      sections.push(entry);
    }
  }

  sections.push('');
  return sections.join('\n');
}
