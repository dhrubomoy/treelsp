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
 * Field access descriptor for runtime.
 * Each field is backed by a wrapper node in the Lezer grammar.
 */
export interface FieldDescriptor {
  /** PascalCase wrapper node type name (e.g., "FunctionDecl__name") */
  wrapperType: string;
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
   * Field map: for each rule, maps field names to wrapper node types.
   * Keys are original snake_case rule names.
   */
  fieldMap: Record<string, Record<string, FieldDescriptor>>;

  /** Set of rule names that are token rules (PascalCase) */
  tokenRules: string[];

  /** All wrapper node type names (for transparent unwrapping at runtime) */
  wrapperNodes: string[];
}

/**
 * Extract field names from a rule node.
 * For each field encountered, records a wrapper-based FieldDescriptor.
 */
function extractFields(
  parentPascal: string,
  node: RuleNode,
  fields: Record<string, FieldDescriptor>,
  wrapperNames: Set<string>,
): void {
  switch (node.type) {
    case 'field': {
      const wrapperType = `${parentPascal}__${node.name}`;
      fields[node.name] = { wrapperType };
      wrapperNames.add(wrapperType);
      break;
    }
    case 'seq':
      for (const child of node.rules) {
        extractFields(parentPascal, child, fields, wrapperNames);
      }
      break;
    case 'choice':
      for (const child of node.rules) {
        extractFields(parentPascal, child, fields, wrapperNames);
      }
      break;
    case 'optional':
    case 'repeat':
    case 'repeat1':
    case 'token.immediate':
      extractFields(parentPascal, node.rule, fields, wrapperNames);
      break;
    case 'prec':
    case 'prec.left':
    case 'prec.right':
    case 'prec.dynamic':
      extractFields(parentPascal, node.rule, fields, wrapperNames);
      break;
    case 'alias':
      extractFields(parentPascal, node.rule, fields, wrapperNames);
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

  // Build field map with wrapper-based descriptors
  const fieldMap: Record<string, Record<string, FieldDescriptor>> = {};
  const wrapperNames = new Set<string>();
  for (const [name, ruleNode] of Object.entries(rules)) {
    const parentPascal = toPascalCase(name);
    const fields: Record<string, FieldDescriptor> = {};
    extractFields(parentPascal, ruleNode, fields, wrapperNames);
    if (Object.keys(fields).length > 0) {
      fieldMap[name] = fields;
    }
  }

  return {
    nodeNameMap,
    reverseNameMap,
    fieldMap,
    tokenRules: tokenRuleNames,
    wrapperNodes: [...wrapperNames],
  };
}
