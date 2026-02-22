/**
 * AST types codegen
 * Generates typed AST node interfaces from grammar definition
 */

import type { LanguageDefinition, RuleDefinition, RuleBuilder } from '../definition/index.js';
import { createBuilderProxy } from '../definition/grammar.js';

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
 * Field information extracted from a rule
 */
interface FieldInfo {
  name: string;
  ruleTypes: string[];
  optional: boolean;
  repeated: boolean;
}

/**
 * Builder that captures rule structure for type analysis
 */
class TypeAnalysisBuilder<T extends string> {
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
 * Extract field information from a RuleNode tree
 */
function extractFields(node: RuleNode, inOptional = false, inRepeat = false): FieldInfo[] {
  const fields: FieldInfo[] = [];

  switch (node.type) {
    case 'field': {
      const ruleTypes = extractRuleTypes(node.rule);
      fields.push({
        name: node.name,
        ruleTypes,
        optional: inOptional,
        repeated: inRepeat,
      });
      break;
    }
    case 'seq':
      for (const child of node.rules) {
        fields.push(...extractFields(child, inOptional, inRepeat));
      }
      break;
    case 'choice':
      // In a choice, fields from branches are optional
      for (const child of node.rules) {
        fields.push(...extractFields(child, true, inRepeat));
      }
      break;
    case 'optional':
      fields.push(...extractFields(node.rule, true, inRepeat));
      break;
    case 'repeat':
      fields.push(...extractFields(node.rule, inOptional, true));
      break;
    case 'repeat1':
      fields.push(...extractFields(node.rule, inOptional, true));
      break;
    case 'prec':
    case 'prec.left':
    case 'prec.right':
    case 'prec.dynamic':
      fields.push(...extractFields(node.rule, inOptional, inRepeat));
      break;
    case 'token.immediate':
      fields.push(...extractFields(node.rule, inOptional, inRepeat));
      break;
    case 'alias':
      fields.push(...extractFields(node.rule, inOptional, inRepeat));
      break;
    // string, regex, token, rule: no fields to extract
  }

  return fields;
}

/**
 * Extract rule type references from a node
 */
function extractRuleTypes(node: RuleNode): string[] {
  switch (node.type) {
    case 'rule':
      return [node.name];
    case 'choice':
      return node.rules.flatMap(r => extractRuleTypes(r));
    case 'optional':
    case 'repeat':
    case 'repeat1':
      return extractRuleTypes(node.rule);
    case 'prec':
    case 'prec.left':
    case 'prec.right':
    case 'prec.dynamic':
      return extractRuleTypes(node.rule);
    case 'seq':
      return node.rules.flatMap(r => extractRuleTypes(r));
    case 'token.immediate':
      return extractRuleTypes(node.rule);
    case 'alias':
      return [node.name];
    default:
      return [];
  }
}

/**
 * Convert rule name to PascalCase interface name
 */
function toPascalCase(name: string): string {
  return name
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Merge field infos with the same name
 */
function mergeFields(fields: FieldInfo[]): FieldInfo[] {
  const merged = new Map<string, FieldInfo>();

  for (const field of fields) {
    const existing = merged.get(field.name);
    if (existing) {
      const allTypes = new Set([...existing.ruleTypes, ...field.ruleTypes]);
      existing.ruleTypes = [...allTypes];
      existing.optional = existing.optional || field.optional;
      existing.repeated = existing.repeated || field.repeated;
    } else {
      merged.set(field.name, { ...field });
    }
  }

  return [...merged.values()];
}

/**
 * Generate TypeScript type string for a field
 */
function fieldTypeString<T extends string>(field: FieldInfo, ruleNames: T[]): string {
  const types = field.ruleTypes.length > 0
    ? field.ruleTypes
      .map(t => ruleNames.includes(t as T) ? `${toPascalCase(t)}Node` : 'ASTNode')
    : ['ASTNode'];

  const uniqueTypes = [...new Set(types)];
  let typeStr = uniqueTypes.length === 1 && uniqueTypes[0] !== undefined
    ? uniqueTypes[0]
    : uniqueTypes.join(' | ');

  if (field.repeated) {
    typeStr = uniqueTypes.length > 1 ? `(${typeStr})[]` : `${typeStr}[]`;
  }

  if (field.optional) {
    typeStr = `${typeStr} | null`;
  }

  return typeStr;
}

/**
 * Generate TypeScript AST type definitions
 */
export function generateAstTypes<T extends string>(
  definition: LanguageDefinition<T>
): string {
  const builder = createBuilderProxy<T>(new TypeAnalysisBuilder<T>());
  const grammar = definition.grammar;
  const ruleNames = Object.keys(grammar) as T[];

  const lines: string[] = [];

  // Header
  lines.push(`/**`);
  lines.push(` * AST types for ${definition.name}`);
  lines.push(` * Generated by treelsp — do not edit`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import type { ASTNode } from 'treelsp/runtime';`);
  lines.push(``);

  // Generate interface for each rule
  for (const ruleName of ruleNames) {
    const ruleFn = grammar[ruleName];
    if (!ruleFn) continue;
    const ruleNode = ruleFn(builder) as unknown as RuleNode;
    const fields = mergeFields(extractFields(ruleNode));

    const interfaceName = `${toPascalCase(ruleName)}Node`;

    lines.push(`export interface ${interfaceName} extends ASTNode {`);
    lines.push(`  readonly type: '${ruleName}';`);

    for (const field of fields) {
      const fType = fieldTypeString(field, ruleNames);
      lines.push(`  field(name: '${field.name}'): ${fType};`);
    }

    lines.push(`}`);
    lines.push(``);
  }

  // Generate union type
  const allInterfaces = ruleNames.map(n => `${toPascalCase(n)}Node`);
  lines.push(`export type ${toPascalCase(definition.name)}Node =`);
  for (let i = 0; i < allInterfaces.length; i++) {
    const iface = allInterfaces[i];
    if (iface === undefined) continue;
    const isLast = i === allInterfaces.length - 1;
    lines.push(`  | ${iface}${isLast ? ';' : ''}`);
  }
  lines.push(``);

  // Type guard helper
  lines.push(`/** Type guard for checking node type */`);
  lines.push(`export function isNodeType<K extends ${toPascalCase(definition.name)}Node['type']>(`);
  lines.push(`  node: ASTNode,`);
  lines.push(`  type: K`);
  lines.push(`): node is Extract<${toPascalCase(definition.name)}Node, { type: K }> {`);
  lines.push(`  return node.type === type;`);
  lines.push(`}`);
  lines.push(``);

  return lines.join('\n');
}
