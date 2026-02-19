/**
 * Parser metadata codegen
 * Generates field map and node name mappings for Lezer runtime
 */

import type { LanguageDefinition, RuleDefinition, RuleFn, RuleBuilder } from '../../definition/index.js';
import { toPascalCase } from './grammar.js';

/**
 * Internal representation of rule nodes
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

class MetadataBuilder<T extends string> {
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

/**
 * Field access descriptor for runtime
 */
export interface FieldDescriptor {
  /** PascalCase node type of the child */
  childType: string;
  /** Occurrence index (0 = first child of this type, 1 = second, etc.) */
  occurrence: number;
}

/**
 * Parser metadata for Lezer runtime
 */
export interface ParserMeta {
  /** Maps PascalCase Lezer node names to original snake_case names */
  nodeNameMap: Record<string, string>;

  /** Maps original snake_case name to PascalCase Lezer name */
  reverseNameMap: Record<string, string>;

  /**
   * Field map: for each rule, maps field names to child access info.
   * Keys are original snake_case rule names.
   */
  fieldMap: Record<string, Record<string, FieldDescriptor>>;

  /** Set of rule names that are token rules (PascalCase) */
  tokenRules: string[];
}

/**
 * Find the rule name referenced inside a field node's child
 */
function findChildRuleName(node: RuleNode): string | null {
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
      return findChildRuleName(node.rule);
    case 'alias':
      return node.name;
    default:
      return null;
  }
}

/**
 * Extract field descriptors from a rule node.
 * Tracks occurrence counts for fields that reference the same child type.
 */
function extractFields(
  node: RuleNode,
  fields: Record<string, FieldDescriptor>,
  occurrenceCounts: Map<string, number>,
): void {
  switch (node.type) {
    case 'field': {
      const childName = findChildRuleName(node.rule);
      if (childName) {
        const childPascal = toPascalCase(childName);
        const count = occurrenceCounts.get(childPascal) ?? 0;
        fields[node.name] = {
          childType: childPascal,
          occurrence: count,
        };
        occurrenceCounts.set(childPascal, count + 1);
      }
      break;
    }
    case 'seq':
      for (const child of node.rules) {
        extractFields(child, fields, occurrenceCounts);
      }
      break;
    case 'choice':
      // For choice, each alternative starts occurrence counting fresh
      // but we take the max occurrence from all alternatives
      for (const child of node.rules) {
        const altFields: Record<string, FieldDescriptor> = {};
        const altCounts = new Map<string, number>();
        extractFields(child, altFields, altCounts);
        // Merge: keep the field descriptor from the first alternative that defines it
        for (const [fieldName, desc] of Object.entries(altFields)) {
          if (!(fieldName in fields)) {
            fields[fieldName] = desc;
          }
        }
        // Merge occurrence counts: take the max
        for (const [type, count] of altCounts) {
          const existing = occurrenceCounts.get(type) ?? 0;
          if (count > existing) {
            occurrenceCounts.set(type, count);
          }
        }
      }
      break;
    case 'optional':
    case 'repeat':
    case 'repeat1':
    case 'token.immediate':
      extractFields(node.rule, fields, occurrenceCounts);
      break;
    case 'prec':
    case 'prec.left':
    case 'prec.right':
    case 'prec.dynamic':
      extractFields(node.rule, fields, occurrenceCounts);
      break;
    case 'alias':
      extractFields(node.rule, fields, occurrenceCounts);
      break;
    // string, regex, token, rule — no fields to extract
  }
}

/**
 * Generate parser metadata from a language definition
 */
export function generateParserMeta<T extends string>(
  definition: LanguageDefinition<T>
): ParserMeta {
  const builder = new MetadataBuilder<T>();

  // Build all rules
  const rules: Record<string, RuleNode> = {};
  for (const [name, ruleFn] of Object.entries(definition.grammar)) {
    rules[name] = (ruleFn as RuleFn<T>)(builder as unknown as RuleBuilder<T>) as unknown as RuleNode;
  }

  // Build node name maps
  const nodeNameMap: Record<string, string> = {};
  const reverseNameMap: Record<string, string> = {};
  const tokenRuleNames: string[] = [];

  for (const name of Object.keys(rules)) {
    const pascal = toPascalCase(name);
    nodeNameMap[pascal] = name;
    reverseNameMap[name] = pascal;

    if (rules[name]!.type === 'token') {
      tokenRuleNames.push(pascal);
    }
  }

  // Build field map
  const fieldMap: Record<string, Record<string, FieldDescriptor>> = {};
  for (const [name, ruleNode] of Object.entries(rules)) {
    const fields: Record<string, FieldDescriptor> = {};
    const occurrenceCounts = new Map<string, number>();
    extractFields(ruleNode, fields, occurrenceCounts);
    if (Object.keys(fields).length > 0) {
      fieldMap[name] = fields;
    }
  }

  return {
    nodeNameMap,
    reverseNameMap,
    fieldMap,
    tokenRules: tokenRuleNames,
  };
}
